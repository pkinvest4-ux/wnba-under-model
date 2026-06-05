import { syncSeasonGameLogsRange } from "../src/jobs.js";

const season = Number(process.argv[2] || new Date().getFullYear() - 1);
const startDate = process.argv[3];
const endDate = process.argv[4];

if (!startDate || !endDate) {
  console.error("Usage: node server/scripts/backfillSeason.js <season> <startDate> <endDate>");
  process.exit(1);
}

const result = await syncSeasonGameLogsRange({
  season,
  startDate,
  endDate,
  preserveCurrentTeams: true
});

console.log(JSON.stringify({ ok: true, result }, null, 2));
