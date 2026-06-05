import { config } from "./config.js";
import { normalizeName } from "./propLines.js";

const TAG_SCORES = [
  { pattern: /out|doubtful/i, score: 1, tag: "major availability risk" },
  { pattern: /minutes?\s*limit|restriction|limited|return/i, score: 0.85, tag: "minutes limit" },
  { pattern: /illness|sick|virus|non-covid|non covid/i, score: 0.8, tag: "illness tag" },
  { pattern: /questionable|game[- ]?time|gtd/i, score: 0.7, tag: "questionable tag" },
  { pattern: /undisclosed|unspecified|not specified|non[- ]?specified|personal/i, score: 0.65, tag: "undisclosed tag" },
  { pattern: /probable|available/i, score: 0.25, tag: "minor availability watch" }
];

export function buildAvailabilityMap(date) {
  const rows = parseAvailabilityRows();
  const map = new Map();
  for (const row of rows) {
    const rowDate = row.date || row.game_date;
    if (rowDate && rowDate !== date) continue;
    const player = normalizeName(row.player || row.player_name || row.name || "");
    if (!player) continue;
    map.set(player, normalizeAvailability(row));
  }
  return map;
}

export function availabilityForPlayer(map, player) {
  const key = normalizeName(`${player.first_name} ${player.last_name}`);
  return map.get(key) || normalizeAvailability({});
}

function parseAvailabilityRows() {
  try {
    const parsed = JSON.parse(config.availabilityReportJson || "[]");
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.reports)) return parsed.reports;
    return Object.entries(parsed).map(([player, value]) => typeof value === "string" ? { player, note: value } : { player, ...value });
  } catch (error) {
    console.error("Availability report JSON parse failed", error.message);
    return [];
  }
}

function normalizeAvailability(row) {
  const text = [row.status, row.tag, row.designation, row.note, row.reason].filter(Boolean).join(" ");
  const matched = TAG_SCORES.filter(({ pattern }) => pattern.test(text));
  const score = matched.length ? Math.max(...matched.map((item) => item.score)) : Number(row.availability_risk_score || row.score || 0);
  const tags = [...new Set([
    ...matched.map((item) => item.tag),
    ...(Array.isArray(row.tags) ? row.tags : [])
  ])];

  return {
    availability_risk: Number(Math.max(0, Math.min(1, score || 0)).toFixed(4)),
    availability_status: row.status || row.designation || null,
    availability_note: row.note || row.reason || null,
    availability_tags: tags
  };
}
