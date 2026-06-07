# WNBA Under Model

A full-stack WNBA player performance under model for Railway. It tracks player game-log patterns for points, rebounds, assists, and PRA, writes daily value-under picks to PostgreSQL, and serves a clean React dashboard.

The UI shows the model's rhythm feature as `Energy Index`; the underlying calculation is intentionally not described in product copy.
The internal `fatigue_cycle_score` is an inferred performance-cycle feature only. It does not store, confirm, or expose player medical information. Each player gets an individualized performance-cycle offset inferred from her own historical down-game patterns; the model stores the inferred offset, confidence, and sample size so the signal can be audited later. High-medium scores are treated as a possible down-game shoulder window so the model can catch one-off underperformance setups before the absolute cycle peak.

## Stack

- Node.js + Express API
- PostgreSQL
- Vite + React dashboard
- Railway-ready `railway.toml`
- `node-cron` model refreshes through the WNBA betting day
- Free ESPN WNBA data integration by default, with optional Balldontlie fallback
- Optional PropLine player-prop integration for real sportsbook/DFS lines

## Environment Variables

Create `.env` in the Railway service or locally in `server/.env`.

```bash
DATABASE_URL=postgresql://...
DATA_PROVIDER=espn
PROP_PROVIDER=generated
PROPLINE_API_KEY=
PROPLINE_SPORT_KEY=basketball_wnba
THE_ODDS_API_KEY=
THE_ODDS_API_SPORT_KEY=basketball_wnba
THE_ODDS_API_REGIONS=us
SHARP_API_KEY=
SHARP_API_LEAGUE=wnba
SHARP_API_SPORTBOOKS=draftkings,fanduel
SHARP_API_LIMIT=200
SHARP_API_MAX_PAGES=8
SHARP_API_CACHE_TTL_MS=60000
SHARP_API_RESERVE_REQUESTS=2
BALLDONTLIE_API_KEY=
BALLDONTLIE_BASE_URL=https://api.balldontlie.io/wnba/v1
WNBA_SEASON=2026
WNBA_SEASON_START=2026-05-15
ENABLE_MOCK_DATA=true
CRON_ENABLED=true
AUTO_BOOTSTRAP=true
UNIT_SIZE_DOLLARS=10
ASSUMED_JUICE=-115
MODEL_LEARNING_ENABLED=false
MODEL_LEARNING_MIN_SAMPLES=1000
SHADOW_OPTIMIZED_MIN_SCORE=118
REAL_LINE_PICKS_ONLY=false
PREGAME_REFRESH_WINDOW_MINUTES=75
PREGAME_FULL_REFRESH_EVERY_MINUTES=30
AVAILABILITY_REPORT_JSON=[]
PORT=3000
```

No paid API key is required for WNBA schedule, roster, boxscore, or result data when `DATA_PROVIDER=espn`.

Real prop lines require a line source. Set `PROP_PROVIDER=all` and add free `PROPLINE_API_KEY`, `THE_ODDS_API_KEY`, and/or `SHARP_API_KEY` values. The app tries PropLine first, then The Odds API, then SharpAPI to fill remaining gaps. SharpAPI requests are intentionally narrow: pregame only, DraftKings/FanDuel by default, and only points/rebounds/assists/PRA markets. They also use a short cache and reserve part of the minute bucket so manual refreshes do not hit the free-plan rate limit. The prediction board stores the full value-under signal universe, including rows that do not yet have a market line. Real sportsbook lines are used as market-tracking anchors so the system can grade whether the under signal beat an actual available number. The first real line observed for a player/stat/date is the anchored line for grading, while later refreshes are stored as line-movement snapshots. A real line does not need to match the generated estimate; line fit is stored only as diagnostic data for later analysis.

Public availability reports can be added through `AVAILABILITY_REPORT_JSON`. These are treated as underperformance-risk inputs, not medical-cycle labels.

```json
[
  {
    "date": "2026-06-05",
    "player": "Example Player",
    "status": "questionable",
    "note": "illness"
  }
]
```

## Local Setup

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

On startup, the app migrates the database, refreshes tracked data, grades recent results when live data is available, and generates today's picks. You can still run `npm run seed` or `npm run run:daily` for development checks, but they are not required for normal deployment.

For live local frontend development:

```bash
npm run dev
```

The API runs on port `3000`; Vite will print its own local URL.

## API

### `GET /picks/today`

Returns today's flagged value unders.

Optional query:

```text
?date=2026-06-02
```

### `GET /picks/history`

Returns all prior picks and a flat-unit record summary.

The history summary assumes a flat average bet size configured by `UNIT_SIZE_DOLLARS`, defaulting to `$10`, and default juice configured by `ASSUMED_JUICE`, defaulting to `-115`.

### `GET /players/:id/trend`

Returns one player's pick history and upcoming schedule.

### `POST /results`

Marks pick outcomes as hit, miss, or push.

```json
{
  "results": [
    {
      "player_id": 1,
      "game_date": "2026-06-02",
      "points": 14,
      "rebounds": 6,
      "assists": 3
    }
  ]
}
```

### `POST /admin/run-daily`

Manually runs the daily model for the supplied date or today's ET date.

```json
{ "date": "2026-06-02" }
```

### `POST /admin/backfill-season-logs`

Backfills historical ESPN box-score logs for individualized performance-cycle offset calibration. Current roster/team mappings are preserved while older game logs are imported.

```json
{
  "season": 2025,
  "start_date": "2025-05-16",
  "end_date": "2025-10-10"
}
```

Local script equivalent:

```bash
node server/scripts/backfillSeason.js 2025 2025-05-16 2025-10-10
```

## Model Inputs

Each generated pick uses:

- Internal rhythm score
- Public availability-risk tags such as illness, questionable, undisclosed, or minutes limit
- Days rest
- 7-day rolling minutes average
- Back-to-back flag
- Opponent defensive rating
- Player historical under hit rate at the generated line

Players with confidence above `65` are flagged as value unders.

## Adding Players To Track

With the ESPN provider, tracked players refresh automatically on startup. To force a local refresh:

```bash
npm run seed
```

That refreshes teams and players and preserves existing tracked dates when already present.

To manually add a player, insert a row into `players` with:

- `external_id`
- `first_name`
- `last_name`
- `position`
- `team_id`
- `first_tracked_game_date`
- `active=true`

Then load historical logs into `player_game_logs` or let the app build picks from whatever history is available.

## Railway Deployment

1. Push this repo to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add the Railway PostgreSQL plugin.
4. Set the environment variables above. Railway will provide `DATABASE_URL`. For no-paid-key operation, keep `DATA_PROVIDER=espn`.
5. Deploy. Railway uses `npm start`, which serves the API and built dashboard.

The service runs on its own:

- Startup automation refreshes rosters/logs, grades recent results, and generates current-day picks.
- Startup automation keeps feature/outcome data ready for later analysis.
- Model refreshes run at 10am, noon, 3pm, 5pm, 7pm, and 9pm ET to catch later prop-line availability. The model evaluates and stores all value-under candidates. Real-line picks are the market-tracked subset used to measure performance against sportsbook numbers, not the source of the prediction. Refreshes only pull prop lines for games that have not tipped yet, so live/in-game line movement does not rewrite the anchored bet line.
- Pregame checks run every 15 minutes from 10am-11pm ET. They refresh the full card around 75, 45, and 20 minutes before tip, and also perform a throttled full line check every `PREGAME_FULL_REFRESH_EVERY_MINUTES` while games are still upcoming, so new real-line picks can be added if lines appear later.
- Result sync runs every 30 minutes from 10pm-5:59am ET, then hourly from 6am-2pm ET, so completed games keep getting retried until stats are available and picks settle.
- The app also grades recent results on startup through `AUTO_BOOTSTRAP=true`, which helps after deploys or service restarts.

If you prefer separate Railway cron services, set `CRON_ENABLED=false` on the web service and configure cron services to execute:

```bash
npm run run:daily
npm run run:results
npm run run:train
```

## Learning Loop

Every pick stores its feature snapshot and final outcome. Adaptive scoring is disabled by default because early samples are noisy. With `MODEL_LEARNING_ENABLED=false`, future pick scores use the fixed baseline model and are marked `Fixed`; the settled data is still stored so the learned model can be evaluated later. To enable adaptive scoring intentionally, set `MODEL_LEARNING_ENABLED=true` and keep `MODEL_LEARNING_MIN_SAMPLES` high enough for the sample size you trust.

Each pick also stores short reason chips and a formula breakdown. Reason chips include percentage shares of the weighted signal contribution, while the tooltip exposes the formula summary and factor shares without exposing internal cycle math.

## Notes

This app produces analytical signals, not financial advice. Use real sportsbook lines and prices before any production wagering workflow.
