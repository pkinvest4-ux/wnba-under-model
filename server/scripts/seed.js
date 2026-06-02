import { migrate } from "../src/db.js";
import { config } from "../src/config.js";
import { seedMockLogs, syncReferenceData, syncSeasonGameLogs } from "../src/jobs.js";

await migrate();
const synced = await syncReferenceData();
const logged = config.balldontlieApiKey ? await syncSeasonGameLogs(config.season) : await seedMockLogs();
const seeded = config.balldontlieApiKey ? { mock_logs: 0 } : logged;
console.log(JSON.stringify({ ok: true, ...synced, season_logs: logged.logs || 0, ...seeded }, null, 2));
process.exit(0);
