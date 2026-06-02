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
  if (config.propProvider !== "propline" || !config.propLineApiKey) return new Map();

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
    console.error("prop line sync failed; falling back to generated lines", error.message);
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
  const gameAway = normalizeName(game.away_abbreviation || game.away_team || "");
  const gameHome = normalizeName(game.home_abbreviation || game.home_team || "");
  return Boolean(away && home && gameAway && gameHome && away.includes(gameAway) && home.includes(gameHome));
}
