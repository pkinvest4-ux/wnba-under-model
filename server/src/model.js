const STAT_KEYS = ["points", "rebounds", "assists", "pra"];
const CYCLE_PERIOD_DAYS = 28;
const LOW_OUTPUT_PEAK_DAY = 21;
const FIXED_WEIGHTS = {
  intercept: -1.35,
  fatigue_cycle_weight: 2.65,
  rest_weight: 0.95,
  load_weight: 0.7,
  b2b_weight: 0.55,
  opponent_weight: 0.45,
  availability_weight: 1.2,
  under_hit_rate_weight: 0.25
};

export function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function fatigueCycleScore(firstTrackedGameDate, gameDate) {
  const days = fatigueCycleDay(firstTrackedGameDate, gameDate);
  return cycleScoreFromDay(days);
}

export function fatigueCycleRisk(score) {
  const value = Number(score || 0);
  return Number(Math.min(1, value >= 0.58 ? value + 0.18 : value).toFixed(4));
}

export function fatigueCycleDay(firstTrackedGameDate, gameDate) {
  const start = new Date(`${dateOnly(firstTrackedGameDate)}T12:00:00Z`);
  const game = new Date(`${dateOnly(gameDate)}T12:00:00Z`);
  const days = Math.max(0, Math.round((game - start) / 86400000));
  return days % CYCLE_PERIOD_DAYS;
}

export function cycleScoreFromDay(day) {
  return Number(((Math.cos((2 * Math.PI * (Number(day || 0) - LOW_OUTPUT_PEAK_DAY)) / CYCLE_PERIOD_DAYS) + 1) / 2).toFixed(4));
}

export function inferFatigueCycleOffset(logs = [], firstTrackedGameDate = null) {
  return inferFatigueCycleProfile(logs, firstTrackedGameDate).offset;
}

export function inferFatigueCycleProfile(logs = [], firstTrackedGameDate = null) {
  const sample = logs.filter((log) => Number(log.minutes || 0) >= 8);
  if (sample.length < 6) return { offset: 0, confidence: 0, sample_size: sample.length };
  const anchorDate = firstTrackedGameDate || sample[sample.length - 1]?.game_date;

  const values = sample.map((log) => statValue(log, "pra"));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance) || 1;

  let bestOffset = 0;
  let bestScore = -Infinity;
  const scores = [];
  for (let offset = 0; offset < CYCLE_PERIOD_DAYS; offset += 1) {
    const score = sample.reduce((total, log, index) => {
      const baseDay = fatigueCycleDay(anchorDate || log.game_date, log.game_date);
      const downMagnitude = Math.max(0, (average - values[index]) / deviation);
      return total + cycleScoreFromDay((baseDay + offset) % CYCLE_PERIOD_DAYS) * downMagnitude;
    }, 0);
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const confidence = Math.max(0, Math.min(1, (bestScore - averageScore) / (sample.length || 1)));
  return {
    offset: bestOffset,
    confidence: Number(confidence.toFixed(4)),
    sample_size: sample.length
  };
}

export function energyBand(score) {
  if (score >= 0.58) return "low";
  if (score >= 0.34) return "medium";
  return "high";
}

export function cycleWindow(score) {
  if (score >= 0.58) return "low_output_window";
  if (score >= 0.34) return "neutral_window";
  return "strong_output_window";
}

export function statValue(log, statType) {
  if (statType === "pra") return Number(log.points || 0) + Number(log.rebounds || 0) + Number(log.assists || 0);
  return Number(log[statType] || 0);
}

export function buildLine(logs, statType) {
  const sample = logs.slice(0, 10);
  if (!sample.length) {
    const defaults = { points: 12.5, rebounds: 4.5, assists: 3.5, pra: 20.5 };
    return defaults[statType];
  }
  const avg = sample.reduce((sum, log) => sum + statValue(log, statType), 0) / sample.length;
  return Math.max(0.5, Math.round(avg * 2) / 2 + 0.5);
}

export function underHitRate(logs, statType, line) {
  if (!logs.length) return 0.5;
  const hits = logs.filter((log) => statValue(log, statType) < line).length;
  return Number((hits / logs.length).toFixed(4));
}

export function normalizedRisks({ days_rest, recent_minutes_avg, back_to_back, opponent_def_rating }) {
  return {
    rest_risk: days_rest <= 1 ? 1 : days_rest === 2 ? 0.55 : 0.2,
    load_risk: Math.min(1, Math.max(0, (Number(recent_minutes_avg || 0) - 24) / 12)),
    opponent_risk: Math.min(1, Math.max(0, (Number(opponent_def_rating || 100) - 96) / 10)),
    b2b_risk: back_to_back ? 1 : 0
  };
}

export function rollingMinutes(logs, gameDate) {
  const cutoff = new Date(`${dateOnly(gameDate)}T12:00:00Z`);
  const weekAgo = new Date(cutoff);
  weekAgo.setUTCDate(cutoff.getUTCDate() - 7);
  const week = logs.filter((log) => {
    const date = new Date(`${dateOnly(log.game_date)}T12:00:00Z`);
    return date < cutoff && date >= weekAgo;
  });
  if (!week.length) return 0;
  return Number((week.reduce((sum, log) => sum + Number(log.minutes || 0), 0) / week.length).toFixed(2));
}

export function scoreUnder({ fatigue_cycle_score, days_rest, recent_minutes_avg, back_to_back, opponent_def_rating, under_hit_rate, availability_risk }) {
  const risks = normalizedRisks({ days_rest, recent_minutes_avg, back_to_back, opponent_def_rating });
  const personal = Number(under_hit_rate ?? 0.5);
  const cycleRisk = fatigueCycleRisk(fatigue_cycle_score);

  const z =
    FIXED_WEIGHTS.intercept +
    FIXED_WEIGHTS.fatigue_cycle_weight * cycleRisk +
    FIXED_WEIGHTS.rest_weight * risks.rest_risk +
    FIXED_WEIGHTS.load_weight * risks.load_risk +
    FIXED_WEIGHTS.b2b_weight * risks.b2b_risk +
    FIXED_WEIGHTS.opponent_weight * risks.opponent_risk +
    FIXED_WEIGHTS.availability_weight * Number(availability_risk || 0) +
    FIXED_WEIGHTS.under_hit_rate_weight * personal;

  return probabilityToScore(sigmoid(z));
}

export function scoreUnderWithWeights(features, weightsByStat, statType) {
  const weights = weightsByStat?.[statType];
  if (!weights) return { confidence_score: scoreUnder(features), model_version: "fixed_v1" };
  const cycleRisk = fatigueCycleRisk(features.fatigue_cycle_score);

  const z =
    Number(weights.intercept) +
    Number(weights.fatigue_cycle_weight) * cycleRisk +
    Number(weights.rest_weight) * Number(features.rest_risk || 0) +
    Number(weights.load_weight) * Number(features.load_risk || 0) +
    Number(weights.b2b_weight) * Number(features.b2b_risk || 0) +
    Number(weights.opponent_weight) * Number(features.opponent_risk || 0) +
    FIXED_WEIGHTS.availability_weight * Number(features.availability_risk || 0) +
    Number(weights.under_hit_rate_weight) * Number(features.under_hit_rate || 0.5);

  return {
    confidence_score: probabilityToScore(sigmoid(z)),
    model_version: `learned_${weights.sample_size || 0}`
  };
}

export function buildPickFeatures(player, logs, gameDate, opponentDefRating, lineOverrides = {}, weightsByStat = {}, availabilityReport = {}) {
  const sortedLogs = logs
    .filter((log) => dateOnly(log.game_date) < dateOnly(gameDate))
    .sort((a, b) => dateOnly(b.game_date).localeCompare(dateOnly(a.game_date)));
  const previous = sortedLogs[0];
  const daysRest = previous
    ? Math.max(0, Math.round((new Date(`${dateOnly(gameDate)}T12:00:00Z`) - new Date(`${dateOnly(previous.game_date)}T12:00:00Z`)) / 86400000) - 1)
    : 3;
  const fatigueCycleProfile = inferFatigueCycleProfile(sortedLogs, player.first_tracked_game_date || gameDate);
  const fatigue_cycle_offset = fatigueCycleProfile.offset;
  const baseCycleDay = fatigueCycleDay(player.first_tracked_game_date || gameDate, gameDate);
  const fatigue_cycle_day = (baseCycleDay + fatigue_cycle_offset) % CYCLE_PERIOD_DAYS;
  const fatigue_cycle_score = cycleScoreFromDay(fatigue_cycle_day);
  const recent_minutes_avg = rollingMinutes(sortedLogs, gameDate);
  const back_to_back = daysRest === 0;

  return STAT_KEYS.map((statType) => {
    const lineOverride = lineOverrides[statType];
    const estimatedLine = buildLine(sortedLogs, statType);
    const realLine = lineOverride?.line == null ? null : Number(lineOverride.line);
    const line = realLine ?? estimatedLine;
    const lineGap = realLine == null ? null : Number((realLine - estimatedLine).toFixed(2));
    const lineMatchQuality = lineQuality(lineGap, realLine);
    const snapshotRealLine = lineOverride?.snapshot_real_line == null ? realLine : Number(lineOverride.snapshot_real_line);
    const snapshotLine = lineOverride?.snapshot_line == null ? line : Number(lineOverride.snapshot_line);
    const snapshotLineGap = snapshotRealLine == null ? null : Number((snapshotRealLine - estimatedLine).toFixed(2));
    const under_hit_rate = underHitRate(sortedLogs, statType, line);
    const baseFeatures = {
      fatigue_cycle_score,
      fatigue_cycle_risk: fatigueCycleRisk(fatigue_cycle_score),
      days_rest: daysRest,
      recent_minutes_avg,
      back_to_back,
      opponent_def_rating: opponentDefRating,
      availability_risk: Number(availabilityReport.availability_risk || 0),
      under_hit_rate
    };
    const risks = normalizedRisks(baseFeatures);
    const allFeatures = { ...baseFeatures, ...risks, line_source: lineOverride?.source || "generated", line_match_quality: lineMatchQuality };
    const { confidence_score, model_version } = scoreUnderWithWeights(allFeatures, weightsByStat, statType);
    const factor_breakdown = factorBreakdown(allFeatures, weightsByStat?.[statType]);
    const reasons = pickReasons(allFeatures, factor_breakdown);
    const risk_tags = riskTags({ confidence_score, sortedLogs, allFeatures, lineMatchQuality, realLine });
    const classification = classifyPick({ confidence_score, lineMatchQuality, realLine, lineGap, risk_tags });

    return {
      stat_type: statType,
      line,
      estimated_line: estimatedLine,
      real_line: realLine,
      line_gap: lineGap,
      line_match_quality: lineMatchQuality,
      line_alerts: lineAlerts({ realLine, lineGap, lineMatchQuality }),
      bettable_status: classification.bettable_status,
      watchlist_reason: classification.watchlist_reason,
      risk_tags,
      confidence_score,
      fatigue_cycle_score,
      fatigue_cycle_day,
      fatigue_cycle_offset,
      fatigue_cycle_confidence: fatigueCycleProfile.confidence,
      fatigue_cycle_sample_size: fatigueCycleProfile.sample_size,
      cycle_window: cycleWindow(fatigue_cycle_score),
      energy_band: energyBand(fatigue_cycle_score),
      opponent_def_rating: opponentDefRating,
      recent_minutes_avg,
      days_rest: daysRest,
      back_to_back,
      availability_risk: Number(availabilityReport.availability_risk || 0),
      availability_status: availabilityReport.availability_status || null,
      availability_note: availabilityReport.availability_note || null,
      availability_tags: availabilityReport.availability_tags || [],
      under_hit_rate,
      ...risks,
      model_version,
      reasons,
      factor_breakdown,
      formula_summary: "confidence = sigmoid(intercept + weighted signal inputs)",
      is_value_under: confidence_score > 65,
      line_source: lineOverride?.source || "generated",
      bookmaker: lineOverride?.bookmaker || null,
      odds_price: lineOverride?.price ?? null,
      snapshot_line: snapshotLine,
      snapshot_real_line: snapshotRealLine,
      snapshot_line_gap: snapshotLineGap,
      snapshot_line_source: lineOverride?.snapshot_source || lineOverride?.source || "generated",
      snapshot_bookmaker: lineOverride?.snapshot_bookmaker || lineOverride?.bookmaker || null,
      snapshot_odds_price: lineOverride?.snapshot_price ?? lineOverride?.price ?? null
    };
  });
}

function lineQuality(lineGap, realLine) {
  if (realLine == null) return "model_only";
  const absGap = Math.abs(Number(lineGap || 0));
  if (absGap <= 0.5) return "near_market";
  if (absGap <= 1) return "close_market";
  return "wide_gap";
}

function lineAlerts({ realLine, lineGap, lineMatchQuality }) {
  if (realLine == null) return ["Model-estimated line"];
  const alerts = ["Real prop line"];
  if (lineMatchQuality === "near_market") alerts.push("Near model line");
  if (lineMatchQuality === "close_market") alerts.push("Close to model line");
  if (lineMatchQuality === "wide_gap") alerts.push(`Market gap ${lineGap > 0 ? "+" : ""}${lineGap}`);
  return alerts;
}

function classifyPick({ confidence_score, realLine }) {
  const hasRealLine = realLine != null;
  const confidence = Number(confidence_score || 0);

  if (hasRealLine && confidence > 65) {
    return { bettable_status: "bettable", watchlist_reason: "Real line with under signal" };
  }
  if (hasRealLine) {
    return { bettable_status: "research", watchlist_reason: "Real line stored, below under threshold" };
  }
  if (!hasRealLine && confidence >= 75) {
    return { bettable_status: "watchlist", watchlist_reason: "Strong model signal waiting on market line" };
  }
  return { bettable_status: "research", watchlist_reason: "Research-only signal" };
}

function riskTags({ confidence_score, sortedLogs, allFeatures, lineMatchQuality, realLine }) {
  const tags = [];
  if (realLine == null) tags.push("Model line only");
  if (lineMatchQuality === "wide_gap") tags.push("Wide market gap");
  if (lineMatchQuality === "near_market" || lineMatchQuality === "close_market") tags.push("Market aligned");
  if (Number(confidence_score || 0) >= 85) tags.push("High confidence");
  if ((sortedLogs || []).length < 5) tags.push("Low sample");
  if (Number(allFeatures.recent_minutes_avg || 0) < 8) tags.push("Minutes uncertainty");
  if (Number(allFeatures.recent_minutes_avg || 0) >= 30) tags.push("Heavy minutes");
  if (Number(allFeatures.days_rest) <= 1) tags.push("Short rest");
  if (allFeatures.back_to_back) tags.push("B2B");
  for (const tag of allFeatures.availability_tags || []) tags.push(tag);
  return [...new Set(tags)].slice(0, 8);
}

export function pickReasons(features, breakdown = []) {
  const reasons = [];

  if (features.back_to_back) {
    reasons.push({ label: "B2B", score: 1 });
  }
  if (Number(features.days_rest) <= 1) {
    reasons.push({ label: "Short rest", score: features.rest_risk });
  }
  if (Number(features.recent_minutes_avg || 0) >= 30) {
    reasons.push({ label: "Heavy minutes", score: features.load_risk });
  }
  if (Number(features.availability_risk || 0) >= 0.55) {
    reasons.push({ label: "Availability watch", score: 1.1 + Number(features.availability_risk || 0) });
  }
  if (Number(features.fatigue_cycle_score || 0) >= 0.58) {
    reasons.push({ label: "Low Energy Index", score: 1.2 + Number(features.fatigue_cycle_score || 0) });
  }
  if (Number(features.opponent_def_rating || 100) >= 101) {
    reasons.push({ label: "Tough matchup", score: features.opponent_risk });
  }
  if (features.line_source && features.line_source !== "generated") {
    reasons.push({ label: "Real line", score: 0.75 });
  }

  const formulaReasons = breakdown
    .filter((item) => item.percent >= 12 && item.label !== "Under history")
    .map((item) => ({ label: `${item.label} ${item.percent}%`, score: item.percent / 100 }));

  return [...formulaReasons, ...reasons]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((reason) => reason.label);
}

export function factorBreakdown(features, learnedWeights) {
  const weights = learnedWeights || FIXED_WEIGHTS;
  const factors = [
    { key: "fatigue_cycle_score", label: "Energy Index", weight: Number(weights.fatigue_cycle_weight), value: Number(features.fatigue_cycle_risk ?? fatigueCycleRisk(features.fatigue_cycle_score)) },
    { key: "rest_risk", label: "Rest", weight: Number(weights.rest_weight), value: Number(features.rest_risk || 0) },
    { key: "load_risk", label: "Minutes", weight: Number(weights.load_weight), value: Number(features.load_risk || 0) },
    { key: "b2b_risk", label: "B2B", weight: Number(weights.b2b_weight), value: Number(features.b2b_risk || 0) },
    { key: "opponent_risk", label: "Matchup", weight: Number(weights.opponent_weight), value: Number(features.opponent_risk || 0) },
    { key: "availability_risk", label: "Availability", weight: Number(weights.availability_weight ?? FIXED_WEIGHTS.availability_weight), value: Number(features.availability_risk || 0) },
    { key: "under_hit_rate", label: "Under history", weight: Number(weights.under_hit_rate_weight), value: Number(features.under_hit_rate || 0.5) }
  ].map((factor) => ({
    ...factor,
    contribution: Math.max(0, factor.weight * factor.value)
  }));

  const total = factors.reduce((sum, factor) => sum + factor.contribution, 0) || 1;
  return factors
    .map((factor) => ({
      key: factor.key,
      label: factor.label,
      value: Number(factor.value.toFixed(4)),
      weight: Number(factor.weight.toFixed(4)),
      contribution: Number(factor.contribution.toFixed(4)),
      percent: Math.round((factor.contribution / total) * 100)
    }))
    .sort((a, b) => b.percent - a.percent);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function probabilityToScore(probability) {
  return Math.max(0, Math.min(100, Math.round(probability * 100)));
}
