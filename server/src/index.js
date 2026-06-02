import path from "path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import cron from "node-cron";
import { z } from "zod";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { bootstrapAutomation, isoDate, reconcileRecentResults, runDailyModel } from "./jobs.js";
import { dateOnly } from "./model.js";
import { markResults, pickHistory, picksForDate, playerTrend } from "./repository.js";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wnba-under-model" });
});

app.get("/picks/today", async (req, res, next) => {
  try {
    const date = req.query.date || isoDate();
    const rows = await picksForDate(date, true);
    res.json({ date, picks: rows.map(toPickDto) });
  } catch (error) {
    next(error);
  }
});

app.get("/picks/history", async (_req, res, next) => {
  try {
    const rows = await pickHistory();
    const settled = rows.filter((row) => row.outcome && row.outcome !== "push");
    const wins = settled.filter((row) => row.outcome === "hit").length;
    const losses = settled.filter((row) => row.outcome === "miss").length;
    const profitUnits = Number((wins * 0.91 - losses).toFixed(2));
    const roi = settled.length ? Number(((profitUnits / settled.length) * 100).toFixed(2)) : 0;
    res.json({
      summary: {
        picks: rows.length,
        settled: settled.length,
        wins,
        losses,
        pushes: rows.filter((row) => row.outcome === "push").length,
        hit_rate: settled.length ? Number(((wins / settled.length) * 100).toFixed(2)) : 0,
        flat_unit_roi: roi,
        unit_size_dollars: config.unitSizeDollars,
        profit_units: profitUnits,
        estimated_profit_dollars: Number((profitUnits * config.unitSizeDollars).toFixed(2))
      },
      picks: rows.map(toPickDto)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/players/:id/trend", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await playerTrend(id);
    if (!data.player) return res.status(404).json({ error: "Player not found" });
    res.json({
      player: {
        id: data.player.id,
        name: `${data.player.first_name} ${data.player.last_name}`,
        team: data.player.team_abbreviation,
        position: data.player.position
      },
      picks: data.picks.map(toPickDto),
      upcoming_schedule: data.upcoming_schedule.map((game) => ({
        ...game,
        game_date: dateOnly(game.game_date)
      }))
    });
  } catch (error) {
    next(error);
  }
});

const resultSchema = z.object({
  results: z.array(z.object({
    player_id: z.number().int(),
    game_date: z.string(),
    points: z.number(),
    rebounds: z.number(),
    assists: z.number()
  }))
});

app.post("/results", async (req, res, next) => {
  try {
    const parsed = resultSchema.parse(req.body);
    const updated = await markResults(parsed.results);
    res.json({ updated: updated.length, picks: updated.map(toPickDto) });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/run-daily", async (req, res, next) => {
  try {
    const result = await runDailyModel(req.body?.date || isoDate());
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(config.clientDistPath));
app.use((_req, res) => {
  res.sendFile(path.join(config.clientDistPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: error.errors });
  res.status(500).json({ error: error.message || "Internal server error" });
});

function toPickDto(row) {
  return {
    id: row.id,
    player_id: row.player_id,
    player_name: row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
    team: row.team_abbreviation,
    roster_status: row.roster_status,
    starter: Boolean(row.last_known_starter),
    game_date: dateOnly(row.game_date),
    stat_type: row.stat_type,
    line: Number(row.line),
    confidence_score: Number(row.confidence_score),
    energy_index: row.energy_band,
    opponent_def_rating: row.opponent_def_rating === null ? null : Number(row.opponent_def_rating),
    recent_minutes_avg: row.recent_minutes_avg === null ? null : Number(row.recent_minutes_avg),
    days_rest: row.days_rest,
    back_to_back: row.back_to_back,
    under_hit_rate: row.under_hit_rate === null ? null : Number(row.under_hit_rate),
    model_version: row.model_version || "fixed_v1",
    line_source: row.line_source || "generated",
    bookmaker: row.bookmaker,
    odds_price: row.odds_price === null ? null : Number(row.odds_price),
    is_value_under: row.is_value_under,
    result_value: row.result_value === null ? null : Number(row.result_value),
    outcome: row.outcome
  };
}

await migrate();

if (config.cronEnabled) {
  cron.schedule("0 10 * * *", async () => {
    try {
      const result = await runDailyModel();
      console.log("daily model run", result);
    } catch (error) {
      console.error("daily model failed", error);
    }
  }, { timezone: "America/New_York" });

  cron.schedule("30 1 * * *", async () => {
    try {
      const result = await reconcileRecentResults(3);
      console.log("overnight results sync", result);
    } catch (error) {
      console.error("overnight results sync failed", error);
    }
  }, { timezone: "America/New_York" });

  cron.schedule("0 14 * * *", async () => {
    try {
      const result = await reconcileRecentResults(1);
      console.log("afternoon results sync", result);
    } catch (error) {
      console.error("afternoon results sync failed", error);
    }
  }, { timezone: "America/New_York" });
}

app.listen(config.port, () => {
  console.log(`WNBA under model listening on ${config.port}`);
  if (config.autoBootstrap) {
    bootstrapAutomation()
      .then((result) => console.log("startup automation complete", result))
      .catch((error) => console.error("startup automation failed", error));
  }
});
