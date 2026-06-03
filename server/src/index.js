import path from "path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import cron from "node-cron";
import { z } from "zod";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { bootstrapAutomation, isoDate, reconcileRecentResults, reconcileResultsForDate, runDailyModel, runPregameModelRefresh } from "./jobs.js";
import { dateOnly } from "./model.js";
import { lineSnapshotsForPick, markResults, pickHistory, picksForDate, playerTrend, setTrackedBet } from "./repository.js";

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
    const graded = rows.filter((row) => row.outcome === "hit" || row.outcome === "miss");
    const wins = graded.filter((row) => row.outcome === "hit").length;
    const losses = graded.filter((row) => row.outcome === "miss").length;
    const pushes = rows.filter((row) => row.outcome === "push").length;
    const voids = rows.filter((row) => row.outcome === "void").length;
    const settled = graded.length + pushes + voids;
    const winProfitUnits = Math.abs(config.assumedJuice) >= 100 ? 100 / Math.abs(config.assumedJuice) : Math.abs(config.assumedJuice) / 100;
    const profitUnits = Number((wins * winProfitUnits - losses).toFixed(2));
    const roi = graded.length ? Number(((profitUnits / graded.length) * 100).toFixed(2)) : 0;
    res.json({
      summary: {
        picks: rows.length,
        settled,
        graded_picks: graded.length,
        wins,
        losses,
        pushes,
        voids,
        pending: rows.filter((row) => !row.outcome).length,
        hit_rate: graded.length ? Number(((wins / graded.length) * 100).toFixed(2)) : 0,
        flat_unit_roi: roi,
        unit_size_dollars: config.unitSizeDollars,
        assumed_juice: config.assumedJuice,
        win_profit_units: Number(winProfitUnits.toFixed(4)),
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

app.get("/picks/:id/line-snapshots", async (req, res, next) => {
  try {
    const rows = await lineSnapshotsForPick(Number(req.params.id));
    res.json({
      pick_id: Number(req.params.id),
      snapshots: rows.map((row) => ({
        created_at: row.created_at,
        observed_line: row.observed_line === null ? null : Number(row.observed_line),
        estimated_line: row.estimated_line === null ? null : Number(row.estimated_line),
        real_line: row.real_line === null ? null : Number(row.real_line),
        line_gap: row.line_gap === null ? null : Number(row.line_gap),
        line_source: row.line_source,
        bookmaker: row.bookmaker,
        odds_price: row.odds_price === null ? null : Number(row.odds_price),
        confidence_score: row.confidence_score,
        is_value_under: row.is_value_under
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/picks/:id/tracked-bet", async (req, res, next) => {
  try {
    const pick = await setTrackedBet(Number(req.params.id), req.body?.tracked !== false, req.body?.stake);
    if (!pick) return res.status(404).json({ error: "Pick not found" });
    res.json({ pick: toPickDto(pick) });
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

app.post("/admin/run-pregame-refresh", async (_req, res, next) => {
  try {
    const result = await runPregameModelRefresh();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/admin/reconcile-results", async (req, res, next) => {
  try {
    const date = req.body?.date || isoDate();
    const result = await reconcileResultsForDate(date);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  if (req.path === "/" || !path.extname(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.use(express.static(config.clientDistPath));
app.use((_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
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
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    factor_breakdown: Array.isArray(row.factor_breakdown) ? row.factor_breakdown : [],
    formula_summary: row.formula_summary,
    line_source: row.line_source || "generated",
    bookmaker: row.bookmaker,
    odds_price: row.odds_price === null ? null : Number(row.odds_price),
    estimated_line: row.estimated_line === null ? null : Number(row.estimated_line),
    real_line: row.real_line === null ? null : Number(row.real_line),
    line_gap: row.line_gap === null ? null : Number(row.line_gap),
    line_match_quality: row.line_match_quality || "model_only",
    line_alerts: Array.isArray(row.line_alerts) ? row.line_alerts : [],
    bettable_status: row.bettable_status || "research",
    watchlist_reason: row.watchlist_reason,
    risk_tags: Array.isArray(row.risk_tags) ? row.risk_tags : [],
    tracked_bet: Boolean(row.tracked_bet),
    tracked_stake: row.tracked_stake === null ? null : Number(row.tracked_stake),
    tracked_at: row.tracked_at,
    is_value_under: row.is_value_under,
    result_value: row.result_value === null ? null : Number(row.result_value),
    outcome: row.outcome
  };
}

await migrate();

if (config.cronEnabled) {
  cron.schedule("0 10,12,15,17,19,21 * * *", async () => {
    try {
      const result = await runDailyModel();
      console.log("scheduled model refresh", result);
    } catch (error) {
      console.error("scheduled model refresh failed", error);
    }
  }, { timezone: "America/New_York" });

  cron.schedule("*/15 10-23 * * *", async () => {
    try {
      const result = await runPregameModelRefresh();
      if (result.refreshed) console.log("pregame prop-line refresh", result);
    } catch (error) {
      console.error("pregame prop-line refresh failed", error);
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
