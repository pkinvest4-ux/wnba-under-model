import { config } from "./config.js";

const MARKET_TO_STAT = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
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

function mergeLineMaps(target, source) {
  for (const [key, value] of source.entries()) {
    if (!target.has(key)) target.set(key, value);
  }
}
