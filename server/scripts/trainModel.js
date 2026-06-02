import { migrate } from "../src/db.js";
import { trainModelWeights } from "../src/training.js";

await migrate();
const result = await trainModelWeights();
console.log(JSON.stringify({ ok: true, result }, null, 2));
process.exit(0);
