import { config } from "./config.js";
import { fetchGamesByDate, fetchPlayers, fetchPlayerStats, fetchTeams } from "./balldontlie.js";
import { fetchEspnGamesByDate, fetchEspnPlayerStatsByDate, fetchEspnPlayers, fetchEspnTeams } from "./espn.js";
import { fetchPropLinesForGames, linesForPlayer } from "./propLines.js";
import { trainModelWeights } from "./training.js";
import { fatigueCycleScore } from "./model.js";
import {
  deletePicksForDate,
  getActivePlayers,
  getModelWeights,
  getOpponentForPlayer,
  getPlayerByExternalId,
  getPlayerLogs,
  getTodayGames,
  insertGameLog,
  markResults,
  savePicks,
  upsertGame,
  upsertPlayer,
  upsertTeam,
  voidMissingResults
} from "./repository.js";
import { buildPickFeatures, dateOnly } from "./model.js";
import { buildMockLogs } from "./mockData.js";

const pregameRefreshes = new Set();

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
      team_external_id: row.team ? String(row.team.id) : null,
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
  const lineMap = await fetchPropLinesForGames(games);
  const weightsByStat = config.modelLearningEnabled ? await getModelWeights() : {};
  await deletePicksForDate(date);
  let picksCount = 0;
  let valueCount = 0;

  for (const player of players) {
    const matchup = await getOpponentForPlayer(player, games);
    if (!matchup) continue;

    const logs = await getPlayerLogs(player.id);
    const picks = buildPickFeatures(player, logs, date, matchup.opponent?.defensive_rating || 100, linesForPlayer(lineMap, player), weightsByStat);
    await savePicks(player.id, matchup.game.id, date, picks);
    picksCount += picks.length;
    valueCount += picks.filter((pick) => pick.is_value_under).length;
  }

  return { date, games: games.length, picks: picksCount, value_unders: valueCount };
}

export async function runPregameModelRefresh(now = new Date()) {
  const date = isoDate(now);
  await syncGames(date);
  const games = await getTodayGames(date);
  const upcoming = games.filter((game) => {
    if (!game.start_time) return false;
    const minutesUntilTip = (new Date(game.start_time).getTime() - now.getTime()) / 60000;
    return minutesUntilTip > 0 && minutesUntilTip <= config.pregameRefreshWindowMinutes;
  });

  const dueGames = upcoming.filter((game) => {
    const key = `${date}:${game.external_id}`;
    return !pregameRefreshes.has(key);
  });

  if (!dueGames.length) {
    return {
      date,
      checked_games: games.length,
      due_games: 0,
      refreshed: false
    };
  }

  for (const game of dueGames) {
    pregameRefreshes.add(`${date}:${game.external_id}`);
  }

  const refresh = await runDailyModel(date);
  return {
    date,
    checked_games: games.length,
    due_games: dueGames.length,
    refreshed: true,
    games: dueGames.map((game) => ({
      id: game.external_id,
      start_time: game.start_time,
      matchup: `${game.away_abbreviation || game.away_team} @ ${game.home_abbreviation || game.home_team}`
    })),
    refresh
  };
}

export function clearPregameRefreshMemory() {
  pregameRefreshes.clear();
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
