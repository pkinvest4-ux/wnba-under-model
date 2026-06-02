import { migrate } from "../src/db.js";
import { reconcileRecentResults } from "../src/jobs.js";

await migrate();
const daysBack = Number(process.argv[2] || 3);
const result = await reconcileRecentResults(daysBack);
console.log(JSON.stringify({ ok: true, result }, null, 2));
process.exit(0);
