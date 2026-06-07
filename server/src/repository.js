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
    `INSERT INTO games (external_id, game_date, home_team_id, away_team_id, season, status, start_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (external_id) DO UPDATE SET
       game_date = EXCLUDED.game_date,
       home_team_id = EXCLUDED.home_team_id,
       away_team_id = EXCLUDED.away_team_id,
       season = EXCLUDED.season,
       status = EXCLUDED.status,
       start_time = COALESCE(EXCLUDED.start_time, games.start_time),
       updated_at = now()
     RETURNING *`,
    [game.external_id, game.date, homeRows[0]?.id || null, awayRows[0]?.id || null, game.season, game.status, game.start_time || null]
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

export async function updatePlayerFirstTrackedDatesFromLogs() {
  const { rows } = await query(`
    WITH first_logs AS (
      SELECT player_id, MIN(game_date) AS first_game_date
      FROM player_game_logs
      GROUP BY player_id
    )
    UPDATE players
    SET first_tracked_game_date = first_logs.first_game_date
    FROM first_logs
    WHERE players.id = first_logs.player_id
      AND (players.first_tracked_game_date IS NULL OR players.first_tracked_game_date > first_logs.first_game_date)
    RETURNING players.id, players.first_name, players.last_name, players.first_tracked_game_date
  `);
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

export async function getOpeningLineAnchors(gameDate) {
  const { rows } = await query(`
    SELECT DISTINCT ON (player_id, stat_type)
      player_id, stat_type, observed_line, estimated_line, real_line, line_gap,
      line_source, bookmaker, odds_price, created_at
    FROM line_snapshots
    WHERE game_date = $1
      AND real_line IS NOT NULL
    ORDER BY player_id, stat_type, created_at ASC
  `, [gameDate]);

  const anchors = new Map();
  for (const row of rows) {
    if (!anchors.has(row.player_id)) anchors.set(row.player_id, {});
    anchors.get(row.player_id)[row.stat_type] = row;
  }
  return anchors;
}

export async function savePicks(playerId, gameId, gameDate, picks) {
  await withClient(async (client) => {
    for (const pick of picks) {
      await client.query(
        `INSERT INTO picks (
          player_id, game_id, game_date, stat_type, line, confidence_score, fatigue_cycle_score,
          fatigue_cycle_day, fatigue_cycle_offset, fatigue_cycle_confidence, fatigue_cycle_sample_size,
          cycle_window, energy_band, opponent_def_rating, availability_risk, availability_status, availability_note, availability_tags,
          recent_minutes_avg, days_rest, back_to_back,
          under_hit_rate, rest_risk, load_risk, opponent_risk, b2b_risk, model_version,
          reasons, factor_breakdown, formula_summary, line_source, bookmaker, odds_price,
          estimated_line, real_line, line_gap, line_match_quality, line_alerts,
          bettable_status, watchlist_reason, risk_tags,
          optimized_score, optimized_rank, optimized_card, optimized_profile, optimized_reasons,
          is_value_under
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb, $29::jsonb, $30, $31, $32, $33, $34, $35, $36, $37, $38::jsonb, $39, $40, $41::jsonb, $42, $43, $44, $45, $46::jsonb, $47)
         ON CONFLICT (player_id, game_date, stat_type, line) DO UPDATE SET
           game_id = EXCLUDED.game_id,
           confidence_score = EXCLUDED.confidence_score,
           fatigue_cycle_score = EXCLUDED.fatigue_cycle_score,
           fatigue_cycle_day = EXCLUDED.fatigue_cycle_day,
           fatigue_cycle_offset = EXCLUDED.fatigue_cycle_offset,
           fatigue_cycle_confidence = EXCLUDED.fatigue_cycle_confidence,
           fatigue_cycle_sample_size = EXCLUDED.fatigue_cycle_sample_size,
           cycle_window = EXCLUDED.cycle_window,
           energy_band = EXCLUDED.energy_band,
           opponent_def_rating = EXCLUDED.opponent_def_rating,
           availability_risk = EXCLUDED.availability_risk,
           availability_status = EXCLUDED.availability_status,
           availability_note = EXCLUDED.availability_note,
           availability_tags = EXCLUDED.availability_tags,
           recent_minutes_avg = EXCLUDED.recent_minutes_avg,
           days_rest = EXCLUDED.days_rest,
           back_to_back = EXCLUDED.back_to_back,
           under_hit_rate = EXCLUDED.under_hit_rate,
           rest_risk = EXCLUDED.rest_risk,
           load_risk = EXCLUDED.load_risk,
           opponent_risk = EXCLUDED.opponent_risk,
           b2b_risk = EXCLUDED.b2b_risk,
           model_version = EXCLUDED.model_version,
           reasons = EXCLUDED.reasons,
           factor_breakdown = EXCLUDED.factor_breakdown,
           formula_summary = EXCLUDED.formula_summary,
           line_source = EXCLUDED.line_source,
           bookmaker = EXCLUDED.bookmaker,
           odds_price = EXCLUDED.odds_price,
           estimated_line = EXCLUDED.estimated_line,
           real_line = EXCLUDED.real_line,
           line_gap = EXCLUDED.line_gap,
           line_match_quality = EXCLUDED.line_match_quality,
           line_alerts = EXCLUDED.line_alerts,
           bettable_status = EXCLUDED.bettable_status,
           watchlist_reason = EXCLUDED.watchlist_reason,
           risk_tags = EXCLUDED.risk_tags,
           optimized_score = EXCLUDED.optimized_score,
           optimized_rank = EXCLUDED.optimized_rank,
           optimized_card = EXCLUDED.optimized_card,
           optimized_profile = EXCLUDED.optimized_profile,
           optimized_reasons = EXCLUDED.optimized_reasons,
           is_value_under = EXCLUDED.is_value_under`,
        [
          playerId,
          gameId,
          gameDate,
          pick.stat_type,
          pick.line,
          pick.confidence_score,
          pick.fatigue_cycle_score,
          pick.fatigue_cycle_day ?? null,
          pick.fatigue_cycle_offset ?? null,
          pick.fatigue_cycle_confidence ?? null,
          pick.fatigue_cycle_sample_size ?? null,
          pick.cycle_window || null,
          pick.energy_band,
          pick.opponent_def_rating,
          pick.availability_risk ?? 0,
          pick.availability_status || null,
          pick.availability_note || null,
          JSON.stringify(pick.availability_tags || []),
          pick.recent_minutes_avg,
          pick.days_rest,
          pick.back_to_back,
          pick.under_hit_rate,
          pick.rest_risk,
          pick.load_risk,
          pick.opponent_risk,
          pick.b2b_risk,
          pick.model_version || "fixed_v1",
          JSON.stringify(pick.reasons || []),
          JSON.stringify(pick.factor_breakdown || []),
          pick.formula_summary || null,
          pick.line_source || "generated",
          pick.bookmaker || null,
          pick.odds_price ?? null,
          pick.estimated_line ?? null,
          pick.real_line ?? null,
          pick.line_gap ?? null,
          pick.line_match_quality || "model_only",
          JSON.stringify(pick.line_alerts || []),
          pick.bettable_status || "research",
          pick.watchlist_reason || null,
          JSON.stringify(pick.risk_tags || []),
          pick.optimized_score ?? null,
          pick.optimized_rank ?? null,
          Boolean(pick.optimized_card),
          pick.optimized_profile || null,
          JSON.stringify(pick.optimized_reasons || []),
          pick.is_value_under
        ]
      );
      await client.query(
        `INSERT INTO line_snapshots (
          player_id, game_id, game_date, stat_type, observed_line, estimated_line, real_line,
          line_gap, line_source, bookmaker, odds_price, confidence_score, is_value_under
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          playerId,
          gameId,
          gameDate,
          pick.stat_type,
          pick.snapshot_line ?? pick.line,
          pick.estimated_line ?? null,
          pick.snapshot_real_line ?? pick.real_line ?? null,
          pick.snapshot_line_gap ?? pick.line_gap ?? null,
          pick.snapshot_line_source || pick.line_source || "generated",
          pick.snapshot_bookmaker || pick.bookmaker || null,
          pick.snapshot_odds_price ?? pick.odds_price ?? null,
          pick.confidence_score,
          pick.is_value_under
        ]
      );
    }
  });
}

export async function setTrackedBet(pickId, tracked, stake = null) {
  const { rows } = await query(`
    UPDATE picks
    SET tracked_bet = $2,
      tracked_stake = CASE WHEN $2 THEN COALESCE($3::numeric, tracked_stake, 10) ELSE NULL END,
      tracked_at = CASE WHEN $2 THEN now() ELSE NULL END
    WHERE id = $1
    RETURNING *
  `, [pickId, Boolean(tracked), stake]);
  return rows[0];
}

export async function lineSnapshotsForPick(pickId) {
  const { rows: pickRows } = await query("SELECT player_id, game_date, stat_type FROM picks WHERE id = $1", [pickId]);
  const pick = pickRows[0];
  if (!pick) return [];
  const { rows } = await query(`
    SELECT *
    FROM line_snapshots
    WHERE player_id = $1 AND game_date = $2 AND stat_type = $3
    ORDER BY created_at ASC
  `, [pick.player_id, pick.game_date, pick.stat_type]);
  return rows;
}

export async function getModelWeights() {
  const { rows } = await query("SELECT * FROM model_weights");
  return Object.fromEntries(rows.map((row) => [row.stat_type, row]));
}

export async function getSettledTrainingPicks() {
  const { rows } = await query(`
    SELECT *
    FROM picks
    WHERE outcome IN ('hit', 'miss')
      AND rest_risk IS NOT NULL
      AND load_risk IS NOT NULL
      AND opponent_risk IS NOT NULL
      AND b2b_risk IS NOT NULL
    ORDER BY game_date ASC, id ASC
  `);
  return rows;
}

export async function saveModelWeights(statType, weights) {
  await query(`
    INSERT INTO model_weights (
      stat_type, intercept, fatigue_cycle_weight, rest_weight, load_weight,
      b2b_weight, opponent_weight, under_hit_rate_weight, sample_size,
      validation_log_loss, trained_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    ON CONFLICT (stat_type) DO UPDATE SET
      intercept = EXCLUDED.intercept,
      fatigue_cycle_weight = EXCLUDED.fatigue_cycle_weight,
      rest_weight = EXCLUDED.rest_weight,
      load_weight = EXCLUDED.load_weight,
      b2b_weight = EXCLUDED.b2b_weight,
      opponent_weight = EXCLUDED.opponent_weight,
      under_hit_rate_weight = EXCLUDED.under_hit_rate_weight,
      sample_size = EXCLUDED.sample_size,
      validation_log_loss = EXCLUDED.validation_log_loss,
      trained_at = now()
  `, [
    statType,
    weights.intercept,
    weights.fatigue_cycle_weight,
    weights.rest_weight,
    weights.load_weight,
    weights.b2b_weight,
    weights.opponent_weight,
    weights.under_hit_rate_weight,
    weights.sample_size,
    weights.validation_log_loss
  ]);
}

export async function deletePicksForDate(gameDate) {
  await query("DELETE FROM picks WHERE game_date = $1 AND outcome IS NULL AND tracked_bet = false", [gameDate]);
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
        END,
        closing_line = COALESCE((
          SELECT observed_line
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ), closing_line),
        closing_real_line = (
          SELECT real_line
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ),
        closing_line_gap = (
          SELECT line_gap
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ),
        closing_line_source = (
          SELECT line_source
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ),
        closing_bookmaker = (
          SELECT bookmaker
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ),
        closing_odds_price = (
          SELECT odds_price
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        ),
        closing_line_checked_at = (
          SELECT created_at
          FROM line_snapshots
          WHERE line_snapshots.player_id = picks.player_id
            AND line_snapshots.game_date = picks.game_date
            AND line_snapshots.stat_type = picks.stat_type
          ORDER BY created_at DESC
          LIMIT 1
        )
      WHERE player_id = $1 AND game_date = $2
      RETURNING *
    `, [result.player_id, result.game_date, result.points, result.rebounds, result.assists]);
    updated.push(...rows);
  }
  return updated;
}

export async function voidMissingResults(gameDate, gameExternalIds, playerIdsWithStats) {
  if (!gameExternalIds.length || !playerIdsWithStats.length) return [];

  const { rows } = await query(`
    UPDATE picks
    SET outcome = 'void',
      result_value = NULL,
      closing_line = COALESCE((
        SELECT observed_line
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ), closing_line),
      closing_real_line = (
        SELECT real_line
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ),
      closing_line_gap = (
        SELECT line_gap
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ),
      closing_line_source = (
        SELECT line_source
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ),
      closing_bookmaker = (
        SELECT bookmaker
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ),
      closing_odds_price = (
        SELECT odds_price
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      ),
      closing_line_checked_at = (
        SELECT created_at
        FROM line_snapshots
        WHERE line_snapshots.player_id = picks.player_id
          AND line_snapshots.game_date = picks.game_date
          AND line_snapshots.stat_type = picks.stat_type
        ORDER BY created_at DESC
        LIMIT 1
      )
    FROM games
    WHERE picks.game_id = games.id
      AND picks.game_date = $1
      AND picks.outcome IS NULL
      AND games.external_id = ANY($2::text[])
      AND picks.player_id <> ALL($3::int[])
    RETURNING picks.*
  `, [gameDate, gameExternalIds, playerIdsWithStats]);

  return rows;
}
