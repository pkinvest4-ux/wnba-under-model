import { config } from "./config.js";
import { mockGamesForDate, mockPlayers, mockTeams } from "./mockData.js";

async function request(path, params = {}) {
  if (!config.balldontlieApiKey) {
    throw new Error("BALLDONTLIE_API_KEY is not configured");
  }

  const url = new URL(`${config.balldontlieBaseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(`${key}[]`, item));
      return;
    }
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: { Authorization: config.balldontlieApiKey }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Balldontlie ${response.status}: ${text}`);
  }

  return response.json();
}

async function paged(path, params = {}) {
  const rows = [];
  let cursor;
  do {
    const payload = await request(path, { ...params, cursor, per_page: 100 });
    rows.push(...(payload.data || []));
    cursor = payload.meta?.next_cursor;
  } while (cursor);
  return rows;
}

export async function fetchTeams() {
  if (!config.balldontlieApiKey && config.enableMockData) return mockTeams;
  const rows = await paged("/teams");
  return rows.map((team) => ({
    external_id: String(team.id),
    city: team.city,
    name: team.name || team.full_name,
    abbreviation: team.abbreviation,
    defensive_rating: 100
  }));
}

export async function fetchPlayers() {
  if (!config.balldontlieApiKey && config.enableMockData) return mockPlayers;
  const rows = await paged("/players");
  return rows.map((player) => ({
    external_id: String(player.id),
    first_name: player.first_name,
    last_name: player.last_name,
    position: player.position_abbreviation || player.position,
    team_external_id: player.team ? String(player.team.id) : null
  }));
}

export async function fetchGamesByDate(date, season) {
  if (!config.balldontlieApiKey && config.enableMockData) return mockGamesForDate(date, season);
  const rows = await paged("/games", { dates: [date], season });
  return rows.map((game) => ({
    external_id: String(game.id),
    date: (game.date || "").slice(0, 10),
    season: game.season || season,
    status: game.status || "scheduled",
    home_team_external_id: String(game.home_team?.id || game.home_team_id),
    away_team_external_id: String(game.away_team?.id || game.away_team_id)
  }));
}

export async function fetchPlayerStats(params = {}) {
  if (!config.balldontlieApiKey && config.enableMockData) return [];
  return paged("/player_stats", params);
}
