import { query, withClient } from "./db.js";

export async function upsertTeam(team) {
  const { rows } = await query(
    `INSERT INTO teams (external_id, name, city, abbreviation, defensive_rating, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (external_id) DO UPDATE SET
       name = EXCLUDED.name,
       city = EXCLUDED.city,
       abbreviation = EXCLUDED.abbreviation,
       defensive_rating = COALESCE(EXCLUDED.defensive_rating, teams.defensive_rating),
       updated_at = now()
     RETURNING *`,
    [team.external_id, team.name, team.city, team.abbreviation, team.defensive_rating ?? 100]
  );
  return rows[0];
}

export async function upsertPlayer(player) {
  const { rows: teamRows } = await query("SELECT id FROM teams WHERE external_id = $1", [player.team_external_id]);
  const teamId = teamRows[0]?.id || null;
  const { rows } = await query(
    `INSERT INTO players (
       external_id, first_name, last_name, position, team_id, first_tracked_game_date,
       roster_status, last_known_starter, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (external_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       position = EXCLUDED.position,
       team_id = COALESCE(EXCLUDED.team_id, players.team_id),
       first_tracked_game_date = COALESCE(players.first_tracked_game_date, EXCLUDED.first_tracked_game_date),
       roster_status = COALESCE(EXCLUDED.roster_status, players.roster_status),
       last_known_starter = CASE
         WHEN EXCLUDED.last_known_starter = true THEN true
         WHEN EXCLUDED.roster_status = 'roster' THEN players.last_known_starter
         ELSE COALESCE(EXCLUDED.last_known_starter, players.last_known_starter)
       END,
       active = true,
       updated_at = now()
     RETURNING *`,
    [
      player.external_id,
      player.first_name,
      player.last_name,
      player.position,
      teamId,
      player.first_tracked_game_date,
      player.roster_status || "roster",
      Boolean(player.last_known_starter)
    ]
  );
  return rows[0];
}

export async function upsertGame(game) {
  const { rows: homeRows } = await query("SELECT id FROM teams WHERE external_id = $1", [game.home_team_external_id]);
  const { rows: awayRows } = await query("SELECT id FROM teams WHERE external_id = $1", [game.away_team_external_id]);
  const { rows } = await query(
    `INSERT INTO games (external_id, game_date, home_team_id, away_team_id, season, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (external_id) DO UPDATE SET
       game_date = EXCLUDED.game_date,
       home_team_id = EXCLUDED.home_team_id,
       away_team_id = EXCLUDED.away_team_id,
       season = EXCLUDED.season,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING *`,
    [game.external_id, game.date, homeRows[0]?.id || null, awayRows[0]?.id || null, game.season, game.status]
  );
  return rows[0];
}

export async function insertGameLog(log) {
  await query(
    `INSERT INTO player_game_logs (
      player_id, game_id, game_date, opponent_team_id, home_away, minutes, points, rebounds,
      assists, days_rest, back_to_back, fatigue_cycle_score
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (player_id, game_date) DO UPDATE SET
       game_id = COALESCE(EXCLUDED.game_id, player_game_logs.game_id),
       opponent_team_id = COALESCE(EXCLUDED.opponent_team_id, player_game_logs.opponent_team_id),
       home_away = COALESCE(EXCLUDED.home_away, player_game_logs.home_away),
       minutes = EXCLUDED.minutes,
       points = EXCLUDED.points,
       rebounds = EXCLUDED.rebounds,
       assists = EXCLUDED.assists,
       days_rest = EXCLUDED.days_rest,
       back_to_back = EXCLUDED.back_to_back,
       fatigue_cycle_score = EXCLUDED.fatigue_cycle_score`,
    [
      log.player_id,
      log.game_id || null,
      log.game_date,
      log.opponent_team_id || null,
      log.home_away || null,
      log.minutes || 0,
      log.points || 0,
      log.rebounds || 0,
      log.assists || 0,
      log.days_rest || 0,
      Boolean(log.back_to_back),
      log.fatigue_cycle_score || 0
    ]
  );
}

export async function getActivePlayers() {
  const { rows } = await query(`
    SELECT p.*, t.abbreviation AS team_abbreviation, t.defensive_rating AS team_defensive_rating
    FROM players p
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.active = true
    ORDER BY p.last_name, p.first_name
  `);
  return rows;
}

export async function getPlayerByExternalId(externalId) {
  const { rows } = await query("SELECT * FROM players WHERE external_id = $1", [externalId]);
  return rows[0];
}

export async function getPlayerLogs(playerId) {
  const { rows } = await query(
    `SELECT * FROM player_game_logs WHERE player_id = $1 ORDER BY game_date DESC`,
    [playerId]
  );
  return rows;
}

export async function getTodayGames(date) {
  const { rows } = await query(`
    SELECT
      g.*,
      ht.abbreviation AS home_abbreviation,
      at.abbreviation AS away_abbreviation,
      CONCAT(ht.city, ' ', ht.name) AS home_team,
      CONCAT(at.city, ' ', at.name) AS away_team
    FROM games g
    LEFT JOIN teams ht ON ht.id = g.home_team_id
    LEFT JOIN teams at ON at.id = g.away_team_id
    WHERE g.game_date = $1
    ORDER BY g.id
  `, [date]);
  return rows;
}

export async function getOpponentForPlayer(player, games) {
  const game = games.find((candidate) => candidate.home_team_id === player.team_id || candidate.away_team_id === player.team_id);
  if (!game) return null;
  const opponentId = game.home_team_id === player.team_id ? game.away_team_id : game.home_team_id;
  const { rows } = await query("SELECT * FROM teams WHERE id = $1", [opponentId]);
  return { game, opponent: rows[0] };
}

export async function savePicks(playerId, gameId, gameDate, picks) {
  await withClient(async (client) => {
    for (const pick of picks) {
      await client.query(
        `INSERT INTO picks (
          player_id, game_id, game_date, stat_type, line, confidence_score, fatigue_cycle_score,
          energy_band, opponent_def_rating, recent_minutes_avg, days_rest, back_to_back,
          under_hit_rate, line_source, bookmaker, odds_price, is_value_under
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (player_id, game_date, stat_type, line) DO UPDATE SET
           game_id = EXCLUDED.game_id,
           confidence_score = EXCLUDED.confidence_score,
           fatigue_cycle_score = EXCLUDED.fatigue_cycle_score,
           energy_band = EXCLUDED.energy_band,
           opponent_def_rating = EXCLUDED.opponent_def_rating,
           recent_minutes_avg = EXCLUDED.recent_minutes_avg,
           days_rest = EXCLUDED.days_rest,
           back_to_back = EXCLUDED.back_to_back,
           under_hit_rate = EXCLUDED.under_hit_rate,
           line_source = EXCLUDED.line_source,
           bookmaker = EXCLUDED.bookmaker,
           odds_price = EXCLUDED.odds_price,
           is_value_under = EXCLUDED.is_value_under`,
        [
          playerId,
          gameId,
          gameDate,
          pick.stat_type,
          pick.line,
          pick.confidence_score,
          pick.fatigue_cycle_score,
          pick.energy_band,
          pick.opponent_def_rating,
          pick.recent_minutes_avg,
          pick.days_rest,
          pick.back_to_back,
          pick.under_hit_rate,
          pick.line_source || "generated",
          pick.bookmaker || null,
          pick.odds_price ?? null,
          pick.is_value_under
        ]
      );
    }
  });
}

export async function deletePicksForDate(gameDate) {
  await query("DELETE FROM picks WHERE game_date = $1 AND outcome IS NULL", [gameDate]);
}

export async function picksForDate(date, onlyValue = true) {
  const { rows } = await query(`
    SELECT
      picks.*,
      p.first_name,
      p.last_name,
      p.last_known_starter,
      p.roster_status,
      t.abbreviation AS team_abbreviation,
      g.status AS game_status
    FROM picks
    JOIN players p ON p.id = picks.player_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN games g ON g.id = picks.game_id
    WHERE picks.game_date = $1
      AND ($2::boolean = false OR picks.is_value_under = true)
    ORDER BY picks.confidence_score DESC, p.last_name
  `, [date, onlyValue]);
  return rows;
}

export async function pickHistory() {
  const { rows } = await query(`
    SELECT
      picks.*,
      p.first_name,
      p.last_name,
      p.last_known_starter,
      p.roster_status,
      t.abbreviation AS team_abbreviation
    FROM picks
    JOIN players p ON p.id = picks.player_id
    LEFT JOIN teams t ON t.id = p.team_id
    ORDER BY picks.game_date DESC, picks.confidence_score DESC
  `);
  return rows;
}

export async function playerTrend(playerId) {
  const { rows: playerRows } = await query(`
    SELECT p.*, t.abbreviation AS team_abbreviation
    FROM players p
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.id = $1
  `, [playerId]);
  const { rows: pickRows } = await query(`
    SELECT * FROM picks
    WHERE player_id = $1
    ORDER BY game_date ASC, stat_type ASC
  `, [playerId]);
  const { rows: scheduleRows } = await query(`
    SELECT g.*
    FROM games g
    JOIN players p ON p.id = $1
    WHERE g.game_date >= CURRENT_DATE
      AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
    ORDER BY g.game_date ASC
    LIMIT 8
  `, [playerId]);
  return { player: playerRows[0], picks: pickRows, upcoming_schedule: scheduleRows };
}

export async function markResults(results) {
  const updated = [];
  for (const result of results) {
    const { rows } = await query(`
      UPDATE picks
      SET result_value = CASE stat_type
          WHEN 'points' THEN $3::numeric
          WHEN 'rebounds' THEN $4::numeric
          WHEN 'assists' THEN $5::numeric
          WHEN 'pra' THEN ($3::numeric + $4::numeric + $5::numeric)
        END,
        outcome = CASE
          WHEN CASE stat_type
              WHEN 'points' THEN $3::numeric
              WHEN 'rebounds' THEN $4::numeric
              WHEN 'assists' THEN $5::numeric
              WHEN 'pra' THEN ($3::numeric + $4::numeric + $5::numeric)
            END < line THEN 'hit'
          WHEN CASE stat_type
              WHEN 'points' THEN $3::numeric
              WHEN 'rebounds' THEN $4::numeric
              WHEN 'assists' THEN $5::numeric
              WHEN 'pra' THEN ($3::numeric + $4::numeric + $5::numeric)
            END = line THEN 'push'
          ELSE 'miss'
        END
      WHERE player_id = $1 AND game_date = $2
      RETURNING *
    `, [result.player_id, result.game_date, result.points, result.rebounds, result.assists]);
    updated.push(...rows);
  }
  return updated;
}
