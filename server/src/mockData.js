export const mockTeams = [
  { external_id: "1", city: "Las Vegas", name: "Aces", abbreviation: "LVA", defensive_rating: 96.8 },
  { external_id: "2", city: "New York", name: "Liberty", abbreviation: "NYL", defensive_rating: 98.1 },
  { external_id: "3", city: "Minnesota", name: "Lynx", abbreviation: "MIN", defensive_rating: 97.5 },
  { external_id: "4", city: "Seattle", name: "Storm", abbreviation: "SEA", defensive_rating: 101.2 },
  { external_id: "5", city: "Indiana", name: "Fever", abbreviation: "IND", defensive_rating: 103.6 },
  { external_id: "6", city: "Phoenix", name: "Mercury", abbreviation: "PHX", defensive_rating: 102.4 }
];

export const mockPlayers = [
  { external_id: "101", first_name: "A'ja", last_name: "Wilson", position: "F", team_external_id: "1" },
  { external_id: "102", first_name: "Jackie", last_name: "Young", position: "G", team_external_id: "1" },
  { external_id: "201", first_name: "Breanna", last_name: "Stewart", position: "F", team_external_id: "2" },
  { external_id: "202", first_name: "Sabrina", last_name: "Ionescu", position: "G", team_external_id: "2" },
  { external_id: "301", first_name: "Napheesa", last_name: "Collier", position: "F", team_external_id: "3" },
  { external_id: "401", first_name: "Nneka", last_name: "Ogwumike", position: "F", team_external_id: "4" },
  { external_id: "501", first_name: "Caitlin", last_name: "Clark", position: "G", team_external_id: "5" },
  { external_id: "601", first_name: "Alyssa", last_name: "Thomas", position: "F", team_external_id: "6" }
];

export function mockGamesForDate(date, season) {
  return [
    { external_id: `mock-${date}-1`, date, season, home_team_external_id: "1", away_team_external_id: "5", status: "scheduled" },
    { external_id: `mock-${date}-2`, date, season, home_team_external_id: "2", away_team_external_id: "3", status: "scheduled" }
  ];
}

export function buildMockLogs(playerId, startDate, days = 55) {
  const logs = [];
  const start = new Date(`${startDate}T12:00:00Z`);
  for (let i = 0; i < days; i += 3) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const wobble = Math.sin((i / 28) * Math.PI * 2);
    logs.push({
      player_id: playerId,
      game_date: date.toISOString().slice(0, 10),
      minutes: 27 + ((playerId + i) % 9),
      points: Math.max(2, Math.round(13 + (playerId % 8) + wobble * 4 + ((i * playerId) % 5))),
      rebounds: Math.max(0, Math.round(4 + (playerId % 5) + wobble * 1.8)),
      assists: Math.max(0, Math.round(3 + (playerId % 4) - wobble * 1.2)),
      days_rest: i === 0 ? 3 : 2,
      back_to_back: false,
      home_away: i % 2 === 0 ? "home" : "away"
    });
  }
  return logs;
}
