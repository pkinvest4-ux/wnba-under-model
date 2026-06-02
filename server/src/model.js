const STAT_KEYS = ["points", "rebounds", "assists", "pra"];

export function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function fatigueCycleScore(firstTrackedGameDate, gameDate) {
  const start = new Date(`${dateOnly(firstTrackedGameDate)}T12:00:00Z`);
  const game = new Date(`${dateOnly(gameDate)}T12:00:00Z`);
  const days = Math.max(0, Math.round((game - start) / 86400000));
  return Number(((Math.sin((2 * Math.PI * days) / 28 - Math.PI / 2) + 1) / 2).toFixed(4));
}

export function energyBand(score) {
  if (score >= 0.67) return "low";
  if (score >= 0.34) return "medium";
  return "high";
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

export function scoreUnder({ fatigue_cycle_score, days_rest, recent_minutes_avg, back_to_back, opponent_def_rating, under_hit_rate }) {
  const risks = normalizedRisks({ days_rest, recent_minutes_avg, back_to_back, opponent_def_rating });
  const personal = Number(under_hit_rate ?? 0.5);

  const z =
    -1.55 +
    1.65 * Number(fatigue_cycle_score || 0) +
    0.95 * risks.rest_risk +
    0.7 * risks.load_risk +
    0.55 * risks.b2b_risk +
    0.45 * risks.opponent_risk +
    1.35 * personal;

  return probabilityToScore(sigmoid(z));
}

export function scoreUnderWithWeights(features, weightsByStat, statType) {
  const weights = weightsByStat?.[statType];
  if (!weights) return { confidence_score: scoreUnder(features), model_version: "fixed_v1" };

  const z =
    Number(weights.intercept) +
    Number(weights.fatigue_cycle_weight) * Number(features.fatigue_cycle_score || 0) +
    Number(weights.rest_weight) * Number(features.rest_risk || 0) +
    Number(weights.load_weight) * Number(features.load_risk || 0) +
    Number(weights.b2b_weight) * Number(features.b2b_risk || 0) +
    Number(weights.opponent_weight) * Number(features.opponent_risk || 0) +
    Number(weights.under_hit_rate_weight) * Number(features.under_hit_rate || 0.5);

  return {
    confidence_score: probabilityToScore(sigmoid(z)),
    model_version: `learned_${weights.sample_size || 0}`
  };
}

export function buildPickFeatures(player, logs, gameDate, opponentDefRating, lineOverrides = {}, weightsByStat = {}) {
  const sortedLogs = logs
    .filter((log) => dateOnly(log.game_date) < dateOnly(gameDate))
    .sort((a, b) => dateOnly(b.game_date).localeCompare(dateOnly(a.game_date)));
  const previous = sortedLogs[0];
  const daysRest = previous
    ? Math.max(0, Math.round((new Date(`${dateOnly(gameDate)}T12:00:00Z`) - new Date(`${dateOnly(previous.game_date)}T12:00:00Z`)) / 86400000) - 1)
    : 3;
  const fatigue_cycle_score = fatigueCycleScore(player.first_tracked_game_date || gameDate, gameDate);
  const recent_minutes_avg = rollingMinutes(sortedLogs, gameDate);
  const back_to_back = daysRest === 0;

  return STAT_KEYS.map((statType) => {
    const lineOverride = lineOverrides[statType];
    const line = lineOverride?.line ?? buildLine(sortedLogs, statType);
    const under_hit_rate = underHitRate(sortedLogs, statType, line);
    const baseFeatures = {
      fatigue_cycle_score,
      days_rest: daysRest,
      recent_minutes_avg,
      back_to_back,
      opponent_def_rating: opponentDefRating,
      under_hit_rate
    };
    const risks = normalizedRisks(baseFeatures);
    const { confidence_score, model_version } = scoreUnderWithWeights({ ...baseFeatures, ...risks }, weightsByStat, statType);
    const reasons = pickReasons({ ...baseFeatures, ...risks, line_source: lineOverride?.source || "generated" });

    return {
      stat_type: statType,
      line,
      confidence_score,
      fatigue_cycle_score,
      energy_band: energyBand(fatigue_cycle_score),
      opponent_def_rating: opponentDefRating,
      recent_minutes_avg,
      days_rest: daysRest,
      back_to_back,
      under_hit_rate,
      ...risks,
      model_version,
      reasons,
      is_value_under: confidence_score > 65,
      line_source: lineOverride?.source || "generated",
      bookmaker: lineOverride?.bookmaker || null,
      odds_price: lineOverride?.price ?? null
    };
  });
}

export function pickReasons(features) {
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
  if (Number(features.under_hit_rate || 0) >= 0.62) {
    reasons.push({ label: `${Math.round(Number(features.under_hit_rate) * 100)}% under rate`, score: features.under_hit_rate });
  }
  if (Number(features.fatigue_cycle_score || 0) >= 0.67) {
    reasons.push({ label: "Low Energy Index", score: features.fatigue_cycle_score });
  }
  if (Number(features.opponent_def_rating || 100) >= 101) {
    reasons.push({ label: "Tough matchup", score: features.opponent_risk });
  }
  if (features.line_source && features.line_source !== "generated") {
    reasons.push({ label: "Real line", score: 0.75 });
  }

  return reasons
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((reason) => reason.label);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function probabilityToScore(probability) {
  return Math.max(0, Math.min(100, Math.round(probability * 100)));
}
