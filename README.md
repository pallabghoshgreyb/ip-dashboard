# Citadel Award — EV Battery IP Valuation Dashboard

A live dashboard backed by your own Postgres database. Upload the ranking workbook
once through a password-protected admin page, and everyone who visits the dashboard
sees that data automatically — no rebuilding, no redeploying.

## What's inside

```
ip-dashboard/
├── schema.sql              ← run this once to create the database table
├── .env.example            ← copy to .env and fill in your real values
├── package.json            ← backend dependencies
├── server/
│   ├── index.js            ← Express server: API, admin upload page, static hosting
│   ├── db.js                ← Postgres connection pool
│   ├── auth.js              ← password-gate for /admin and /api/upload
│   └── parseExcel.js        ← reads the .xlsx workbook into database rows
└── client/
    ├── src/App.jsx          ← the dashboard itself (React)
    ├── package.json         ← frontend dependencies
    └── dist/                ← pre-built, ready to serve (already built for you)
```

## How it works

1. You open `https://yourdomain.com/admin`, log in, and upload the updated
   `.xlsx` workbook (same sheet layout as before: "US Companies", "33 US Companies",
   "Companies Websites").
2. The server parses it and replaces the data in Postgres (each upload overwrites
   the previous one — no history is kept, per your call).
3. Anyone who visits `https://yourdomain.com/` sees the dashboard built from
   whatever is currently in the database, live.

## One-time setup on your server

**Prerequisites:** Node.js 18+ and access to your Postgres server.

```bash
# 1. Unzip this project on your server, then from inside the folder:
npm install

# 2. Create the database table (run this against your Postgres server)
psql "postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DATABASE" -f schema.sql

# 3. Configure environment variables
cp .env.example .env
nano .env   # fill in DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD

# 4. Start the server
npm start
```

That's it — `client/dist/` is already built, so the server can serve it immediately.
Visit `http://your-server:3000/admin`, log in with the credentials you set in
`.env`, and upload the workbook for the first time.

### If you ever change the frontend

If you (or I, in a future session) modify `client/src/App.jsx`, rebuild it with:

```bash
npm run build:client
```

This regenerates `client/dist/`, which the server serves automatically on next restart.

## Keeping it running

For a real deployment, don't rely on `npm start` staying alive in a terminal.
Use a process manager:

```bash
npm install -g pm2
pm2 start server/index.js --name ip-dashboard
pm2 save
pm2 startup   # follow the printed instructions to survive server reboots
```

## Putting it behind your domain (optional, recommended)

If you're using Nginx as a reverse proxy in front of this app:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then get a free TLS certificate with `certbot --nginx -d yourdomain.com` so both
the public dashboard and the admin login are served over HTTPS — this matters
because Basic Auth credentials are sent in a form easily readable over plain HTTP.

## Security notes

- **Change `ADMIN_PASSWORD`** in `.env` before deploying — don't use the example value.
- **Use HTTPS in production.** Basic Auth alone provides no protection over plain HTTP.
- The upload endpoint only accepts `.xlsx` files and validates the expected sheet names
  before touching the database, but this is not a substitute for keeping the admin
  credentials private.
- `PGSSL=true` in `.env` if your Postgres provider requires SSL connections (most
  managed cloud databases do).
- `npm audit` currently flags one moderate transitive advisory (`uuid`, via the
  `exceljs` package) affecting a code path this app doesn't exercise — `exceljs`
  uses `uuid` for internal ID generation, not with attacker-controlled buffers. Worth
  re-checking with `npm audit` after `npm update` periodically as upstream patches land.

## What happens with a bad upload

- Wrong file type (not `.xlsx`) → rejected with a clear error, nothing is changed.
- Missing or renamed sheets → rejected with a clear error naming which sheet is missing,
  nothing is changed.
- A database hiccup during upload → the transaction rolls back, the previous data
  stays intact, and the server keeps running (this was tested directly: killing
  Postgres mid-upload produces a clean error response, not a crash).

## The data model

Every field shown in the dashboard traces back to a specific column in the workbook —
see `server/parseExcel.js` for the exact mapping, and `schema.sql` for the database
columns. The dashboard reads:

- **Global & US rank, Final Score** — from "US Companies"
- **Patent Portfolio Score and its five build-blocks** — from "US Companies"
- **The five patent quality dimensions** (Technological Impact, Legal Strength,
  Market Coverage, Economic Activity, Strategic Layer) — from "US Companies"
- **Business momentum scores** (Revenue Growth, R&D Intensity, R&D Growth, FDA,
  M&A) — from "US Companies"
- **Revenue, R&D spend, M&A activity, tech domain** — from "33 US Companies"
- **Website, parent company** — from "Companies Websites"

If you add or remove companies in future uploads, everything updates automatically —
the dashboard doesn't hardcode "33" anywhere; it always reflects however many rows
are in the latest upload.

## Known limitation

`TOTAL_GLOBAL` (currently 2,630 — "ranked out of X companies worldwide") is a
manually-set number in `client/src/App.jsx`, because the global company universe
isn't part of the uploaded workbook (only the US subset is). If that global study
size changes significantly, update the constant near the top of `App.jsx` and rebuild.
