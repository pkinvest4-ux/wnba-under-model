import { config } from "./config.js";

const MARKET_TO_STAT = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_points_rebounds_assists: "pra"
};

const SHARP_STAT_TO_STAT = {
  points: "points",
  pts: "points",
  player_points: "points",
  rebounds: "rebounds",
  rebs: "rebounds",
  player_rebounds: "rebounds",
  assists: "assists",
  asts: "assists",
  player_assists: "assists",
  pra: "pra",
  points_rebounds_assists: "pra",
  player_points_rebounds_assists: "pra"
};

export function normalizeName(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function fetchPropLinesForGames(games = []) {
  const merged = new Map();
  const provider = config.propProvider;

  if ((provider === "propline" || provider === "all") && config.propLineApiKey) {
    mergeLineMaps(merged, await fetchPropLineLines(games));
  }

  if ((provider === "the_odds_api" || provider === "all") && config.theOddsApiKey) {
    mergeLineMaps(merged, await fetchTheOddsApiLines(games));
  }

  if ((provider === "sharpapi" || provider === "all") && config.sharpApiKey) {
    mergeLineMaps(merged, await fetchSharpApiLines(games));
  }

  return merged;
}

async function fetchPropLineLines(games = []) {
  if (!config.propLineApiKey) return new Map();

  try {
    const { PropLine } = await import("propline");
    const client = new PropLine(config.propLineApiKey);
    const events = await client.getEvents(config.propLineSportKey);
    const matchedEvents = events.filter((event) => games.some((game) => eventMatchesGame(event, game)));
    const lineMap = new Map();

    for (const event of matchedEvents) {
      const odds = await client.getOdds(config.propLineSportKey, {
        eventId: event.id,
        markets: Object.keys(MARKET_TO_STAT)
      });

      for (const bookmaker of odds.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const statType = MARKET_TO_STAT[market.key];
          if (!statType) continue;

          for (const outcome of market.outcomes || []) {
            if (String(outcome.name).toLowerCase() !== "under" || outcome.point == null) continue;
            const key = `${normalizeName(outcome.description)}:${statType}`;
            if (!lineMap.has(key)) {
              lineMap.set(key, {
                line: Number(outcome.point),
                stat_type: statType,
                bookmaker: bookmaker.key || bookmaker.title || "propline",
                price: outcome.price,
                source: "propline"
              });
            }
          }
        }
      }
    }

    return lineMap;
  } catch (error) {
    console.error("PropLine sync failed; falling back where needed", error.message);
    return new Map();
  }
}

async function fetchTheOddsApiLines(games = []) {
  if (!config.theOddsApiKey) return new Map();

  try {
    const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${config.theOddsApiSportKey}/events`);
    eventsUrl.searchParams.set("apiKey", config.theOddsApiKey);
    const events = await oddsApiRequest(eventsUrl);
    const matchedEvents = events.filter((event) => games.some((game) => eventMatchesGame(event, game)));
    const lineMap = new Map();

    for (const event of matchedEvents) {
      const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${config.theOddsApiSportKey}/events/${event.id}/odds`);
      oddsUrl.searchParams.set("apiKey", config.theOddsApiKey);
      oddsUrl.searchParams.set("regions", config.theOddsApiRegions);
      oddsUrl.searchParams.set("markets", Object.keys(MARKET_TO_STAT).join(","));
      oddsUrl.searchParams.set("oddsFormat", "american");

      const odds = await oddsApiRequest(oddsUrl);
      for (const bookmaker of odds.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const statType = MARKET_TO_STAT[market.key];
          if (!statType) continue;

          for (const outcome of market.outcomes || []) {
            if (String(outcome.name).toLowerCase() !== "under" || outcome.point == null) continue;
            const playerName = outcome.description || outcome.participant || outcome.player || "";
            const key = `${normalizeName(playerName)}:${statType}`;
            if (!lineMap.has(key)) {
              lineMap.set(key, {
                line: Number(outcome.point),
                stat_type: statType,
                bookmaker: bookmaker.key || bookmaker.title || "the_odds_api",
                price: outcome.price,
                source: "the_odds_api"
              });
            }
          }
        }
      }
    }

    return lineMap;
  } catch (error) {
    console.error("The Odds API sync failed; falling back where needed", error.message);
    return new Map();
  }
}

async function fetchSharpApiLines(games = []) {
  if (!config.sharpApiKey) return new Map();

  try {
    const url = new URL(config.sharpApiBaseUrl);
    url.searchParams.set("league", config.sharpApiLeague);
    url.searchParams.set("market", "props");
    url.searchParams.set("limit", String(config.sharpApiLimit));

    const payload = await sharpApiRequest(url);
    const rows = Array.isArray(payload) ? payload : payload.data || payload.odds || payload.results || [];
    const sortedRows = [...rows].sort((a, b) => sharpLinePriority(b) - sharpLinePriority(a));
    const lineMap = new Map();

    for (const row of sortedRows) {
      if (!games.some((game) => sharpEventMatchesGame(row, game))) continue;
      if (String(row.selection_type || row.selection || row.outcome || "").toLowerCase() !== "under") continue;
      if (row.line == null && row.point == null) continue;
      if (row.is_active === false || row.active === false) continue;

      const playerName = row.player_name || row.player || row.participant || row.description || "";
      const statType = sharpStatType(row);
      if (!playerName || !statType) continue;

      const key = `${normalizeName(playerName)}:${statType}`;
      if (!lineMap.has(key)) {
        lineMap.set(key, {
          line: Number(row.line ?? row.point),
          stat_type: statType,
          bookmaker: row.sportsbook || row.sportsbook_name || row.bookmaker || "sharpapi",
          price: row.odds_american ?? row.price ?? row.odds,
          source: "sharpapi",
          is_main_line: row.is_main_line !== false,
          is_alternate_line: row.is_alternate_line === true
        });
      }
    }

    return lineMap;
  } catch (error) {
    console.error("SharpAPI sync failed; falling back where needed", error.message);
    return new Map();
  }
}

export function linesForPlayer(lineMap, player) {
  const playerName = normalizeName(`${player.first_name} ${player.last_name}`);
  return Object.fromEntries(
    ["points", "rebounds", "assists", "pra"]
      .map((statType) => [statType, lineMap.get(`${playerName}:${statType}`)])
      .filter(([, line]) => line)
  );
}

function eventMatchesGame(event, game) {
  const away = normalizeName(event.away_team || event.awayTeam || "");
  const home = normalizeName(event.home_team || event.homeTeam || "");
  return teamMatches(away, game.away_team, game.away_abbreviation) && teamMatches(home, game.home_team, game.home_abbreviation);
}

function sharpEventFromRow(row = {}) {
  return {
    away_team: row.away_team || row.away_team_name || row.awayTeam || row.away_team_abbr || row.away_abbreviation,
    home_team: row.home_team || row.home_team_name || row.homeTeam || row.home_team_abbr || row.home_abbreviation
  };
}

function sharpEventMatchesGame(row = {}, game) {
  const eventTeams = [
    row.away_team || row.away_team_name || row.awayTeam || row.away_team_abbr || row.away_abbreviation || row.away?.name || row.away?.abbreviation,
    row.home_team || row.home_team_name || row.homeTeam || row.home_team_abbr || row.home_abbreviation || row.home?.name || row.home?.abbreviation
  ]
    .map(normalizeName)
    .filter(Boolean);

  if (eventTeams.length < 2) return eventMatchesGame(sharpEventFromRow(row), game);

  return [
    [game.away_team, game.away_abbreviation],
    [game.home_team, game.home_abbreviation]
  ].every((options) =>
    options
      .map(normalizeName)
      .filter(Boolean)
      .some((team) => eventTeams.some((eventTeam) => eventTeam.includes(team) || team.includes(eventTeam)))
  );
}

function sharpStatType(row = {}) {
  const candidates = [row.market_type, row.stat_category, row.market, row.stat_type, row.type]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));

  for (const candidate of candidates) {
    if (SHARP_STAT_TO_STAT[candidate]) return SHARP_STAT_TO_STAT[candidate];
  }

  return undefined;
}

function sharpLinePriority(row = {}) {
  const mainLine = row.is_main_line === false ? 0 : 4;
  const active = row.is_active === false || row.active === false ? 0 : 2;
  const nonAlternate = row.is_alternate_line === true ? 0 : 1;
  return mainLine + active + nonAlternate;
}

function teamMatches(eventTeam, gameTeam, gameAbbreviation) {
  const team = normalizeName(gameTeam || "");
  const abbreviation = normalizeName(gameAbbreviation || "");
  return Boolean(
    eventTeam &&
    (
      (team && (eventTeam.includes(team) || team.includes(eventTeam))) ||
      (abbreviation && (eventTeam === abbreviation || eventTeam.includes(abbreviation)))
    )
  );
}

async function oddsApiRequest(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function sharpApiRequest(url) {
  const response = await fetch(url, {
    headers: {
      "X-API-Key": config.sharpApiKey
    }
  });
  if (!response.ok) throw new Error(`SharpAPI ${response.status}: ${await response.text()}`);
  return response.json();
}

function mergeLineMaps(target, source) {
  for (const [key, value] of source.entries()) {
    if (!target.has(key)) target.set(key, value);
  }
}
