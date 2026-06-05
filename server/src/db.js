import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl?.includes("railway") ? { rejectUnauthorized: false } : undefined
});

export async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      name TEXT NOT NULL,
      city TEXT,
      abbreviation TEXT,
      defensive_rating NUMERIC DEFAULT 100,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      position TEXT,
      team_id INTEGER REFERENCES teams(id),
      first_tracked_game_date DATE,
      roster_status TEXT DEFAULT 'roster',
      last_known_starter BOOLEAN DEFAULT false,
      active BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      game_date DATE NOT NULL,
      home_team_id INTEGER REFERENCES teams(id),
      away_team_id INTEGER REFERENCES teams(id),
      season INTEGER,
      status TEXT DEFAULT 'scheduled',
      start_time TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS player_game_logs (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      game_id INTEGER REFERENCES games(id),
      game_date DATE NOT NULL,
      opponent_team_id INTEGER REFERENCES teams(id),
      home_away TEXT CHECK (home_away IN ('home', 'away')),
      minutes NUMERIC DEFAULT 0,
      points INTEGER DEFAULT 0,
      rebounds INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      days_rest INTEGER DEFAULT 0,
      back_to_back BOOLEAN DEFAULT false,
      fatigue_cycle_score NUMERIC DEFAULT 0,
      UNIQUE(player_id, game_date)
    );

    CREATE TABLE IF NOT EXISTS picks (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      game_id INTEGER REFERENCES games(id),
      game_date DATE NOT NULL,
      stat_type TEXT NOT NULL CHECK (stat_type IN ('points', 'rebounds', 'assists', 'pra')),
      line NUMERIC NOT NULL,
      confidence_score INTEGER NOT NULL,
      fatigue_cycle_score NUMERIC NOT NULL,
      fatigue_cycle_day INTEGER,
      fatigue_cycle_offset INTEGER,
      fatigue_cycle_confidence NUMERIC,
      fatigue_cycle_sample_size INTEGER,
      cycle_window TEXT,
      energy_band TEXT NOT NULL,
      opponent_def_rating NUMERIC,
      availability_risk NUMERIC,
      availability_status TEXT,
      availability_note TEXT,
      availability_tags JSONB DEFAULT '[]'::jsonb,
      recent_minutes_avg NUMERIC,
      days_rest INTEGER,
      back_to_back BOOLEAN,
      under_hit_rate NUMERIC,
      rest_risk NUMERIC,
      load_risk NUMERIC,
      opponent_risk NUMERIC,
      b2b_risk NUMERIC,
      model_version TEXT DEFAULT 'fixed_v1',
      reasons JSONB DEFAULT '[]'::jsonb,
      factor_breakdown JSONB DEFAULT '[]'::jsonb,
      formula_summary TEXT,
      line_source TEXT DEFAULT 'generated',
      bookmaker TEXT,
      odds_price NUMERIC,
      estimated_line NUMERIC,
      real_line NUMERIC,
      line_gap NUMERIC,
      line_match_quality TEXT DEFAULT 'model_only',
      line_alerts JSONB DEFAULT '[]'::jsonb,
      closing_line NUMERIC,
      closing_real_line NUMERIC,
      closing_line_gap NUMERIC,
      closing_line_source TEXT,
      closing_bookmaker TEXT,
      closing_odds_price NUMERIC,
      closing_line_checked_at TIMESTAMPTZ,
      bettable_status TEXT DEFAULT 'research',
      watchlist_reason TEXT,
      risk_tags JSONB DEFAULT '[]'::jsonb,
      tracked_bet BOOLEAN DEFAULT false,
      tracked_stake NUMERIC,
      tracked_at TIMESTAMPTZ,
      is_value_under BOOLEAN DEFAULT false,
      result_value NUMERIC,
      outcome TEXT CHECK (outcome IN ('hit', 'miss', 'push', 'void')),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(player_id, game_date, stat_type, line)
    );

    CREATE INDEX IF NOT EXISTS idx_picks_game_date ON picks(game_date);
    CREATE INDEX IF NOT EXISTS idx_logs_player_date ON player_game_logs(player_id, game_date DESC);

    CREATE TABLE IF NOT EXISTS line_snapshots (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      game_id INTEGER REFERENCES games(id),
      game_date DATE NOT NULL,
      stat_type TEXT NOT NULL CHECK (stat_type IN ('points', 'rebounds', 'assists', 'pra')),
      observed_line NUMERIC NOT NULL,
      estimated_line NUMERIC,
      real_line NUMERIC,
      line_gap NUMERIC,
      line_source TEXT DEFAULT 'generated',
      bookmaker TEXT,
      odds_price NUMERIC,
      confidence_score INTEGER,
      is_value_under BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_line_snapshots_pick ON line_snapshots(player_id, game_date, stat_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS model_weights (
      stat_type TEXT PRIMARY KEY CHECK (stat_type IN ('points', 'rebounds', 'assists', 'pra')),
      intercept NUMERIC NOT NULL,
      fatigue_cycle_weight NUMERIC NOT NULL,
      rest_weight NUMERIC NOT NULL,
      load_weight NUMERIC NOT NULL,
      b2b_weight NUMERIC NOT NULL,
      opponent_weight NUMERIC NOT NULL,
      under_hit_rate_weight NUMERIC NOT NULL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      validation_log_loss NUMERIC,
      trained_at TIMESTAMPTZ DEFAULT now()
    );

    ALTER TABLE picks ADD COLUMN IF NOT EXISTS line_source TEXT DEFAULT 'generated';
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS bookmaker TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS odds_price NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS estimated_line NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS real_line NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS line_gap NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS line_match_quality TEXT DEFAULT 'model_only';
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS line_alerts JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS fatigue_cycle_day INTEGER;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS fatigue_cycle_offset INTEGER;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS fatigue_cycle_confidence NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS fatigue_cycle_sample_size INTEGER;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS cycle_window TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_line NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_real_line NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_line_gap NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_line_source TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_bookmaker TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_odds_price NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_line_checked_at TIMESTAMPTZ;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS bettable_status TEXT DEFAULT 'research';
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS watchlist_reason TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS risk_tags JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS tracked_bet BOOLEAN DEFAULT false;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS tracked_stake NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS tracked_at TIMESTAMPTZ;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS rest_risk NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS load_risk NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS opponent_risk NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS b2b_risk NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS availability_risk NUMERIC;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS availability_status TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS availability_note TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS availability_tags JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS model_version TEXT DEFAULT 'fixed_v1';
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS reasons JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS factor_breakdown JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS formula_summary TEXT;
    ALTER TABLE games ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_status TEXT DEFAULT 'roster';
    ALTER TABLE players ADD COLUMN IF NOT EXISTS last_known_starter BOOLEAN DEFAULT false;
  `);

  await query(`
    ALTER TABLE picks DROP CONSTRAINT IF EXISTS picks_outcome_check;
    ALTER TABLE picks ADD CONSTRAINT picks_outcome_check CHECK (outcome IN ('hit', 'miss', 'push', 'void'));
  `);
}
