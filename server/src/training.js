import { getSettledTrainingPicks, saveModelWeights } from "./repository.js";

const FEATURES = [
  "fatigue_cycle_score",
  "rest_risk",
  "load_risk",
  "b2b_risk",
  "opponent_risk",
  "under_hit_rate"
];

const MIN_SAMPLES = 40;
const LEARNING_RATE = 0.08;
const L2 = 0.015;
const EPOCHS = 500;

export async function trainModelWeights() {
  const picks = await getSettledTrainingPicks();
  const byStat = groupBy(picks, (pick) => pick.stat_type);
  const results = [];

  for (const [statType, rows] of byStat.entries()) {
    if (rows.length < MIN_SAMPLES) {
      results.push({ stat_type: statType, sample_size: rows.length, trained: false });
      continue;
    }

    const trainingRows = rows.map(toTrainingRow);
    const weights = fitLogistic(trainingRows);
    await saveModelWeights(statType, {
      intercept: weights[0],
      fatigue_cycle_weight: weights[1],
      rest_weight: weights[2],
      load_weight: weights[3],
      b2b_weight: weights[4],
      opponent_weight: weights[5],
      under_hit_rate_weight: weights[6],
      sample_size: rows.length,
      validation_log_loss: logLoss(trainingRows, weights)
    });

    results.push({ stat_type: statType, sample_size: rows.length, trained: true });
  }

  return results;
}

function fitLogistic(rows) {
  const weights = [-1.55, 1.65, 0.95, 0.7, 0.55, 0.45, 1.35];

  for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
    const gradients = new Array(weights.length).fill(0);

    for (const row of rows) {
      const prediction = sigmoid(dot(weights, row.x));
      const error = prediction - row.y;
      for (let i = 0; i < gradients.length; i += 1) {
        gradients[i] += error * row.x[i];
      }
    }

    for (let i = 0; i < weights.length; i += 1) {
      const penalty = i === 0 ? 0 : L2 * weights[i];
      weights[i] -= LEARNING_RATE * ((gradients[i] / rows.length) + penalty);
    }
  }

  return weights.map((weight) => Number(weight.toFixed(6)));
}

function toTrainingRow(pick) {
  return {
    x: [1, ...FEATURES.map((feature) => Number(pick[feature] ?? 0))],
    y: pick.outcome === "hit" ? 1 : 0
  };
}

function logLoss(rows, weights) {
  const epsilon = 1e-8;
  const total = rows.reduce((sum, row) => {
    const prediction = Math.min(1 - epsilon, Math.max(epsilon, sigmoid(dot(weights, row.x))));
    return sum - row.y * Math.log(prediction) - (1 - row.y) * Math.log(1 - prediction);
  }, 0);
  return Number((total / rows.length).toFixed(6));
}

function dot(weights, features) {
  return weights.reduce((sum, weight, index) => sum + weight * features[index], 0);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}
