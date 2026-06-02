# WNBA Under Model

A full-stack WNBA player performance under model for Railway. It tracks player game-log patterns for points, rebounds, assists, and PRA, writes daily value-under picks to PostgreSQL, and serves a clean React dashboard.

The UI shows the model's rhythm feature as `Energy Index`; the underlying calculation is intentionally not described in product copy.

## Stack

- Node.js + Express API
- PostgreSQL
- Vite + React dashboard
- Railway-ready `railway.toml`
- `node-cron` daily model job at 10am ET
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
BALLDONTLIE_API_KEY=
BALLDONTLIE_BASE_URL=https://api.balldontlie.io/wnba/v1
WNBA_SEASON=2026
WNBA_SEASON_START=2026-05-15
ENABLE_MOCK_DATA=true
CRON_ENABLED=true
AUTO_BOOTSTRAP=true
PORT=3000
```

No paid API key is required for WNBA schedule, roster, boxscore, or result data when `DATA_PROVIDER=espn`.

Real prop lines require a line source. Set `PROP_PROVIDER=propline` and add a free `PROPLINE_API_KEY` to use PropLine when WNBA props are available for your key/sport feed. Without a prop-line key, the app still runs automatically using generated model lines and marks those picks with source `Model`.

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

## Model Inputs

Each generated pick uses:

- Internal rhythm score
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
- A 10am ET cron job generates daily picks.
- A 1:30am ET cron job grades recent completed picks.
- A 2pm ET cron job runs a second short result sync for late stat updates.

If you prefer separate Railway cron services, set `CRON_ENABLED=false` on the web service and configure cron services to execute:

```bash
npm run run:daily
npm run run:results
```

## Notes

This app produces analytical signals, not financial advice. Use real sportsbook lines and prices before any production wagering workflow.
