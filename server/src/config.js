import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  balldontlieApiKey: process.env.BALLDONTLIE_API_KEY,
  balldontlieBaseUrl: process.env.BALLDONTLIE_BASE_URL || "https://api.balldontlie.io/wnba/v1",
  dataProvider: process.env.DATA_PROVIDER || "espn",
  propProvider: process.env.PROP_PROVIDER || "generated",
  propLineApiKey: process.env.PROPLINE_API_KEY,
  propLineSportKey: process.env.PROPLINE_SPORT_KEY || "basketball_wnba",
  enableMockData: process.env.ENABLE_MOCK_DATA !== "false",
  season: Number(process.env.WNBA_SEASON || new Date().getFullYear()),
  seasonStartDate: process.env.WNBA_SEASON_START || `${new Date().getFullYear()}-05-15`,
  cronEnabled: process.env.CRON_ENABLED !== "false",
  autoBootstrap: process.env.AUTO_BOOTSTRAP !== "false",
  clientDistPath: process.env.CLIENT_DIST_PATH || new URL("../../client/dist", import.meta.url).pathname
};
