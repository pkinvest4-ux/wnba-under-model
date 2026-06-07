import { config } from "./config.js";
import { availabilityForPlayer, buildAvailabilityMap } from "./availability.js";
import { fetchGamesByDate, fetchPlayers, fetchPlayerStats, fetchTeams } from "./balldontlie.js";
import { fetchEspnGamesByDate, fetchEspnPlayerStatsByDate, fetchEspnPlayers, fetchEspnTeams } from "./espn.js";
import { fetchPropLinesForGames, linesForPlayer, normalizeName } from "./propLines.js";
import { trainModelWeights } from "./training.js";
import { applyShadowOptimization, fatigueCycleScore } from "./model.js";
import {
  deletePicksForDate,
  getActivePlayers,
  getModelWeights,
  getOpeningLineAnchors,
  getOpponentForPlayer,
  getPlayerByExternalId,
  getPlayerLogs,
  getTodayGames,
  insertGameLog,
  markResults,
  picksForDate,
  savePicks,
  updatePlayerFirstTrackedDatesFromLogs,
  upsertGame,
  upsertPlayer,
  upsertTeam,
  voidMissingResults
} from "./repository.js";
import { buildPickFeatures, dateOnly } from "./model.js";
import { buildMockLogs } from "./mockData.js";

const pregameRefreshes = new Set();
const fullPregameRefreshes = new Map();
const PREGAME_REFRESH_BUCKETS = [20, 45, 75];

export function isoDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86400000));
}

export async function syncReferenceData() {
  const teams = config.dataProvider === "balldontlie" ? await fetchTeams() : await fetchEspnTeams();
  for (const team of teams) await upsertTeam(team);

  const players = config.dataProvider === "balldontlie" ? await fetchPlayers() : await fetchEspnPlayers(config.season);
  for (const player of players) {
    await upsertPlayer({ ...player, first_tracked_game_date: config.seasonStartDate });
  }

  return { teams: teams.length, players: players.length };
}

export async function seedMockLogs() {
  if (!config.enableMockData) return { logs: 0 };
  const players = await getActivePlayers();
  let logs = 0;
  for (const player of players) {
    for (const log of buildMockLogs(player.id, config.seasonStartDate)) {
      await insertGameLog({
        ...log,
        fatigue_cycle_score: fatigueCycleScore(player.first_tracked_game_date || config.seasonStartDate, log.game_date)
      });
      logs += 1;
    }
  }
  return { logs };
}

export async function syncSeasonGameLogs(season = config.season) {
  const stats = config.dataProvider === "balldontlie"
    ? await fetchPlayerStats({ season })
    : await fetchRecentEspnStats(season, 60);
  return syncGameLogRows(stats, season);
}

export async function syncSeasonGameLogsRange({ season = config.season, startDate, endDate, preserveCurrentTeams = true }) {
  if (!startDate || !endDate) throw new Error("startDate and endDate are required");
  if (config.dataProvider !== "espn") throw new Error("Historical date-range backfill currently uses ESPN data");

  const stats = [];
  for (let offset = 0; offset <= daysBetween(startDate, endDate); offset += 1) {
    const date = addDays(startDate, offset);
    stats.push(...await fetchEspnPlayerStatsByDate(date, season));
  }

  const result = await syncGameLogRows(stats, season, { preserveCurrentTeams });
  const firstTracked = await updatePlayerFirstTrackedDatesFromLogs();
  return { ...result, date_range: { startDate, endDate }, first_tracked_updates: firstTracked.length };
}

async function syncGameLogRows(stats, season, options = {}) {
  const preserveCurrentTeams = Boolean(options.preserveCurrentTeams);
  let logs = 0;

  for (const row of stats) {
    if (!row.player || !row.game) continue;

    if (row.team) {
      await upsertTeam({
        external_id: String(row.team.id),
        city: row.team.city,
        name: row.team.name || row.team.full_name,
        abbreviation: row.team.abbreviation,
        defensive_rating: 100
      });
    }

    const player = await upsertPlayer({
      external_id: String(row.player.id),
      first_name: row.player.first_name,
      last_name: row.player.last_name,
      position: row.player.position_abbreviation || row.player.position,
      team_external_id: preserveCurrentTeams ? null : row.team ? String(row.team.id) : null,
      first_tracked_game_date: (row.game.date || config.seasonStartDate).slice(0, 10),
      roster_status: "roster",
      last_known_starter: Boolean(row.player.starter)
    });

    const homeExternalId = String(row.game.home_team?.id || row.game.home_team_id || "");
    const awayExternalId = String(row.game.away_team?.id || row.game.away_team_id || "");
    const game = await upsertGame({
      external_id: String(row.game.id),
      date: (row.game.date || "").slice(0, 10),
      season: row.game.season || season,
      status: row.game.status || "final",
      home_team_external_id: homeExternalId,
      away_team_external_id: awayExternalId
    });

    const isHome = row.team && homeExternalId === String(row.team.id);
    const opponentExternalId = isHome ? awayExternalId : homeExternalId;
    const opponent = opponentExternalId
      ? await upsertTeam({
          external_id: opponentExternalId,
          city: row.game.home_team?.id === Number(opponentExternalId) ? row.game.home_team?.city : row.game.away_team?.city,
          name: row.game.home_team?.id === Number(opponentExternalId)
            ? row.game.home_team?.name || row.game.home_team?.full_name || "Opponent"
            : row.game.away_team?.name || row.game.away_team?.full_name || "Opponent",
          abbreviation: row.game.home_team?.id === Number(opponentExternalId) ? row.game.home_team?.abbreviation : row.game.away_team?.abbreviation,
          defensive_rating: 100
        })
      : null;

    const gameDate = (row.game.date || "").slice(0, 10);
    const previousLogs = await getPlayerLogs(player.id);
    const previous = previousLogs.find((log) => dateOnly(log.game_date) < gameDate);
    const daysRest = previous
      ? Math.max(0, Math.round((new Date(`${gameDate}T12:00:00Z`) - new Date(`${dateOnly(previous.game_date)}T12:00:00Z`)) / 86400000) - 1)
      : 3;

    await insertGameLog({
      player_id: player.id,
      game_id: game.id,
      game_date: gameDate,
      opponent_team_id: opponent?.id,
      home_away: isHome ? "home" : "away",
      minutes: parseMinutes(row.min ?? row.minutes),
      points: Number(row.pts ?? row.points ?? 0),
      rebounds: Number(row.reb ?? row.rebounds ?? 0),
      assists: Number(row.ast ?? row.assists ?? 0),
      days_rest: daysRest,
      back_to_back: daysRest === 0,
      fatigue_cycle_score: fatigueCycleScore(player.first_tracked_game_date || config.seasonStartDate, gameDate)
    });
    logs += 1;
  }

  return { logs };
}

export async function syncGames(date = isoDate(), season = config.season) {
  const games = config.dataProvider === "balldontlie"
    ? await fetchGamesByDate(date, season)
    : await fetchEspnGamesByDate(date, season);
  for (const game of games) await upsertGame(game);
  return { games: games.length };
}

export async function runDailyModel(date = isoDate()) {
  await syncGames(date);
  const games = await getTodayGames(date);
  if (!games.length) return { date, games: 0, picks: 0, value_unders: 0 };

  const players = await getActivePlayers();
  const openingLineAnchors = await getOpeningLineAnchors(date);
  const availabilityMap = buildAvailabilityMap(date);
  const weightsByStat = config.modelLearningEnabled ? await getModelWeights() : {};
  const playerContexts = [];

  for (const player of players) {
    const matchup = await getOpponentForPlayer(player, games);
    if (!matchup) continue;

    const logs = await getPlayerLogs(player.id);
    const openingOnlyPicks = buildPickFeatures(
      player,
      logs,
      date,
      matchup.opponent?.defensive_rating || 100,
      openingLineAnchors.get(player.id) || {},
      weightsByStat,
      availabilityForPlayer(availabilityMap, player)
    );
    playerContexts.push({ player, matchup, logs, openingOnlyPicks });
  }

  const priorityKeys = playerContexts
    .flatMap(({ player, openingOnlyPicks }) =>
      openingOnlyPicks.map((pick) => ({
        key: `${normalizeName(`${player.first_name} ${player.last_name}`)}:${pick.stat_type}`,
        fatigue_cycle_score: Number(pick.fatigue_cycle_score || 0),
        confidence_score: Number(pick.confidence_score || 0),
        is_value_under: Boolean(pick.is_value_under)
      }))
    )
    .sort((a, b) =>
      Number(b.is_value_under) - Number(a.is_value_under) ||
      b.fatigue_cycle_score - a.fatigue_cycle_score ||
      b.confidence_score - a.confidence_score
    )
    .map((item) => item.key);

  const lineMap = await fetchPropLinesForGames(gamesAcceptingMarketLines(games), { priorityKeys });
  await deletePicksForDate(date);
  let picksCount = 0;
  let valueCount = 0;
  let modelCandidates = 0;
  let realLinePicks = 0;
  const pickRows = [];

  for (const { player, matchup, logs } of playerContexts) {
    const picks = buildPickFeatures(
      player,
      logs,
      date,
      matchup.opponent?.defensive_rating || 100,
      applyOpeningLineAnchors(linesForPlayer(lineMap, player), openingLineAnchors.get(player.id) || {}),
      weightsByStat,
      availabilityForPlayer(availabilityMap, player)
    );
    modelCandidates += picks.length;
    pickRows.push({ playerId: player.id, gameId: matchup.game.id, picks });
  }

  const optimizedPicks = applyShadowOptimization(pickRows.flatMap((row) => row.picks), {
    minScore: config.shadowOptimizedMinScore
  });
  let pickIndex = 0;
  for (const row of pickRows) {
    const cardPicks = optimizedPicks.slice(pickIndex, pickIndex + row.picks.length);
    pickIndex += row.picks.length;
    await savePicks(row.playerId, row.gameId, date, cardPicks);
    picksCount += cardPicks.length;
    realLinePicks += cardPicks.filter((pick) => pick.real_line != null).length;
    valueCount += cardPicks.filter((pick) => pick.is_value_under).length;
  }

  return {
    date,
    games: games.length,
    picks: picksCount,
    value_unders: valueCount,
    real_line_picks: realLinePicks,
    optimized_card_picks: optimizedPicks.filter((pick) => pick.optimized_card).length,
    model_candidates: modelCandidates,
    real_line_only: false,
    real_line_usage: "tracking_and_market_grading"
  };
}

function gamesAcceptingMarketLines(games, now = new Date()) {
  return games.filter((game) => !game.start_time || new Date(game.start_time).getTime() > now.getTime());
}

function applyOpeningLineAnchors(currentLines, openingLines) {
  const anchored = { ...currentLines };
  for (const [statType, opening] of Object.entries(openingLines)) {
    const current = currentLines[statType];
    const openingLine = Number(opening.real_line ?? opening.observed_line);
    anchored[statType] = {
      line: openingLine,
      stat_type: statType,
      source: opening.line_source || current?.source || "opening_line",
      bookmaker: opening.bookmaker || current?.bookmaker || null,
      price: opening.odds_price ?? current?.price ?? null,
      snapshot_line: current?.line == null ? openingLine : Number(current.line),
      snapshot_real_line: current?.line == null ? openingLine : Number(current.line),
      snapshot_source: current?.source || opening.line_source || "opening_line",
      snapshot_bookmaker: current?.bookmaker || opening.bookmaker || null,
      snapshot_price: current?.price ?? opening.odds_price ?? null
    };
  }
  return anchored;
}

export async function runPregameModelRefresh(now = new Date()) {
  const date = isoDate(now);
  await syncGames(date);
  const games = await getTodayGames(date);
  const activeUpcoming = games.map((game) => {
    if (!game.start_time) return false;
    const minutesUntilTip = (new Date(game.start_time).getTime() - now.getTime()) / 60000;
    return minutesUntilTip > 0 ? { ...game, minutes_until_tip: Number(minutesUntilTip.toFixed(1)) } : null;
  }).filter(Boolean);
  const upcoming = games.map((game) => {
    if (!game.start_time) return false;
    const minutesUntilTip = (new Date(game.start_time).getTime() - now.getTime()) / 60000;
    const bucket = PREGAME_REFRESH_BUCKETS.find((windowMinutes) => minutesUntilTip > 0 && minutesUntilTip <= Math.min(windowMinutes, config.pregameRefreshWindowMinutes));
    return bucket ? { ...game, minutes_until_tip: Number(minutesUntilTip.toFixed(1)), refresh_bucket: bucket } : null;
  }).filter(Boolean);

  const dueGames = upcoming.filter((game) => {
    const key = `${date}:${game.external_id}:${game.refresh_bucket}`;
    return !pregameRefreshes.has(key);
  });

  const throttleDue = isFullPregameRefreshDue(date, now);
  const shouldFullRefresh = !dueGames.length && activeUpcoming.length && throttleDue;

  if (!dueGames.length && !shouldFullRefresh) {
    return {
      date,
      checked_games: games.length,
      due_games: 0,
      upcoming_games: activeUpcoming.length,
      next_full_refresh_after_minutes: throttleDue ? 0 : config.pregameFullRefreshEveryMinutes,
      refreshed: false
    };
  }

  for (const game of dueGames) {
    pregameRefreshes.add(`${date}:${game.external_id}:${game.refresh_bucket}`);
  }
  if (shouldFullRefresh) fullPregameRefreshes.set(date, now.getTime());

  const before = await picksForDate(date, true);
  const refresh = await runDailyModel(date);
  const after = await picksForDate(date, true);
  return {
    date,
    checked_games: games.length,
    due_games: dueGames.length,
    upcoming_games: activeUpcoming.length,
    refresh_reason: dueGames.length ? "tip_bucket" : "throttled_full_line_check",
    refreshed: true,
    previous_value_unders: before.length,
    current_value_unders: after.length,
    value_under_delta: after.length - before.length,
    games: (dueGames.length ? dueGames : activeUpcoming).map((game) => ({
      id: game.external_id,
      start_time: game.start_time,
      minutes_until_tip: game.minutes_until_tip,
      refresh_bucket: game.refresh_bucket || null,
      matchup: `${game.away_abbreviation || game.away_team} @ ${game.home_abbreviation || game.home_team}`
    })),
    refresh
  };
}

function isFullPregameRefreshDue(date, now) {
  const lastRefresh = fullPregameRefreshes.get(date) || 0;
  return now.getTime() - lastRefresh >= config.pregameFullRefreshEveryMinutes * 60000;
}

export function clearPregameRefreshMemory() {
  pregameRefreshes.clear();
  fullPregameRefreshes.clear();
}

export async function reconcileResultsForDate(date = addDays(isoDate(), -1)) {
  const stats = config.dataProvider === "balldontlie"
    ? await fetchPlayerStats({ dates: [date] })
    : await fetchEspnPlayerStatsByDate(date, config.season);
  const results = [];
  const playerIdsWithStats = new Set();
  const gameExternalIdsWithStats = new Set();

  for (const row of stats) {
    if (!row.player || !row.game) continue;
    const gameDate = dateOnly(row.game.date || date);
    if (gameDate !== date) continue;

    const player = await getPlayerByExternalId(String(row.player.id));
    if (!player) continue;

    playerIdsWithStats.add(player.id);
    gameExternalIdsWithStats.add(String(row.game.id));
    results.push({
      player_id: player.id,
      game_date: gameDate,
      points: Number(row.pts ?? row.points ?? 0),
      rebounds: Number(row.reb ?? row.rebounds ?? 0),
      assists: Number(row.ast ?? row.assists ?? 0)
    });
  }

  const updated = results.length ? await markResults(results) : [];
  const voided = await voidMissingResults(date, [...gameExternalIdsWithStats], [...playerIdsWithStats]);
  const training = updated.length ? await trainModelWeights() : [];
  return {
    date,
    stat_rows: stats.length,
    matched_players: results.length,
    updated_picks: updated.length,
    voided_picks: voided.length,
    training
  };
}

export async function reconcileRecentResults(daysBack = 3) {
  const summaries = [];
  const today = isoDate();
  for (let offset = daysBack; offset >= 0; offset -= 1) {
    summaries.push(await reconcileResultsForDate(addDays(today, -offset)));
  }
  return summaries;
}

export async function bootstrapAutomation() {
  const reference = await syncReferenceData();
  const hasLiveStats = config.dataProvider === "espn" || Boolean(config.balldontlieApiKey);
  const logs = hasLiveStats ? await syncSeasonGameLogs(config.season) : await seedMockLogs();
  const results = hasLiveStats ? await reconcileRecentResults(3) : [];
  const training = await trainModelWeights();
  const daily = await runDailyModel();
  return { reference, logs, results, training, daily };
}

function parseMinutes(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const text = String(value);
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    return Number((minutes + (seconds || 0) / 60).toFixed(2));
  }
  return Number(text) || 0;
}

async function fetchRecentEspnStats(season, daysBack) {
  const today = isoDate();
  const rows = [];
  for (let offset = daysBack; offset >= 0; offset -= 1) {
    rows.push(...await fetchEspnPlayerStatsByDate(addDays(today, -offset), season));
  }
  return rows;
}
