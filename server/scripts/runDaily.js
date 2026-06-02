import { migrate } from "../src/db.js";
import { runDailyModel } from "../src/jobs.js";

await migrate();
const result = await runDailyModel(process.argv[2]);
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
process.exit(0);
