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
      energy_band TEXT NOT NULL,
      opponent_def_rating NUMERIC,
      recent_minutes_avg NUMERIC,
      days_rest INTEGER,
      back_to_back BOOLEAN,
      under_hit_rate NUMERIC,
      line_source TEXT DEFAULT 'generated',
      bookmaker TEXT,
      odds_price NUMERIC,
      is_value_under BOOLEAN DEFAULT false,
      result_value NUMERIC,
      outcome TEXT CHECK (outcome IN ('hit', 'miss', 'push')),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(player_id, game_date, stat_type, line)
    );

    CREATE INDEX IF NOT EXISTS idx_picks_game_date ON picks(game_date);
    CREATE INDEX IF NOT EXISTS idx_logs_player_date ON player_game_logs(player_id, game_date DESC);

    ALTER TABLE picks ADD COLUMN IF NOT EXISTS line_source TEXT DEFAULT 'generated';
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS bookmaker TEXT;
    ALTER TABLE picks ADD COLUMN IF NOT EXISTS odds_price NUMERIC;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_status TEXT DEFAULT 'roster';
    ALTER TABLE players ADD COLUMN IF NOT EXISTS last_known_starter BOOLEAN DEFAULT false;
  `);
}
