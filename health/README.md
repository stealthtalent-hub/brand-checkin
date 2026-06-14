# Vitals — Personal Health App

A private, single-user health app you run yourself and open on your iPhone. It:

- Pulls in your **Apple Health** data every night (pushed from your phone at midnight).
- Lets you **log nutrition by chatting** ("two eggs and avocado toast") or **snapping a photo** — it estimates calories and macros.
- Lets you **log water and body weight** in the same chat (or with quick buttons).
- Gives you a **brutally honest, evidence-based morning briefing** focused on the one thing to fix that day — grounded in real science (AASM, the Physical Activity Guidelines, etc.), not wellness fads.

It lives alongside the existing `brand-checkin` app in this repo and runs as its own small Node + SQLite server.

> Privacy note: everything is stored locally in `health/data/health.db`. The only data that leaves your server is the text/photo you send to the Anthropic API for nutrition estimates and the metric summary used to write your daily briefing. Don't expose this app publicly without auth (it has a passcode, but put it behind HTTPS).

---

## 1. Install & run

From the repo root:

```bash
npm install
cp .env.example .env      # then edit .env (see below)
npm run health
```

It starts on `http://localhost:3100`.

### Configure `.env`

| Variable | What it's for |
|---|---|
| `ANTHROPIC_API_KEY` | Required for chat/photo logging and the morning briefing. Get one at console.anthropic.com. |
| `HEALTH_PASSCODE` | The passcode you type to open the app on your phone. |
| `HEALTH_SECRET` | Long random string used to sign your login cookie. |
| `HEALTH_INGEST_TOKEN` | Long random string your iPhone sends when pushing Apple Health data. |
| `HEALTH_TZ` | Your IANA timezone (e.g. `America/Los_Angeles`) so "today" matches your phone. |
| `HEALTH_PORT` | Port (default `3100`). |
| `HEALTH_MODEL` / `HEALTH_CHAT_MODEL` | Model overrides. Defaults to `claude-opus-4-8`. Set `HEALTH_CHAT_MODEL=claude-sonnet-4-6` if you want faster/cheaper interactive logging. |

Generate good random values with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## 2. Reach it from your iPhone

The app is a PWA (installs to your home screen). You need your phone to reach the server:

- **Easiest:** put it on a small always-on box and use [Tailscale](https://tailscale.com) so your phone can hit `http://<machine>:3100` privately, or
- Host it on a tiny VPS / Fly.io behind HTTPS, or
- For a quick test on the same Wi-Fi, open `http://<your-computer-ip>:3100`.

Then in Safari: open the URL → **Share → Add to Home Screen**. Enter your passcode once; the login persists.

---

## 3. Nightly Apple Health sync (the "pulled at midnight" part)

Apple Health data lives **on your phone** — a server can't pull it directly. Instead your phone **pushes** it on a schedule. The app exposes an ingest endpoint for that:

```
POST  <your-server>/api/health/ingest
Header:  X-Health-Token: <HEALTH_INGEST_TOKEN>
Body:    Health Auto Export JSON
```

### Recommended: the "Health Auto Export — JSON+CSV" app

1. Install **Health Auto Export – JSON+CSV** from the App Store and grant it Health read access.
2. Create an **Automation** → **REST API**.
3. Set:
   - **URL:** `https://<your-server>/api/health/ingest`
   - **Method:** POST, **Format:** JSON
   - **Aggregate:** by day
   - **Headers:** add `X-Health-Token` = your `HEALTH_INGEST_TOKEN`
   - **Schedule:** daily at **12:00 AM**, exporting the **previous day** (and, if offered, recent days so gaps backfill).
4. Pick the metrics you care about: Steps, Active Energy, Exercise Minutes, Sleep Analysis, Resting Heart Rate, Heart Rate Variability, VO2 Max, Body Mass, plus Workouts.

The exact metric names are mapped in `appleHealth.js`; unrecognized metrics are still stored under their own name.

### Alternative: a free iOS Shortcut

If you'd rather not use that app, create a Shortcut that builds a JSON body of Health samples and does a **Get Contents of URL** (POST, with the `X-Health-Token` header) to the same endpoint, then add a **Personal Automation → Time of Day → 12:00 AM** that runs it. The Health Auto Export route is far less fiddly, so it's the recommended path.

You can confirm it's working in the app under **Settings → Apple Health sync**, which shows your exact endpoint and token.

---

## 4. Using it

- **Today** — your morning briefing plus the day's key stats. Tap ↻ to regenerate.
- **Log** — chat what you ate/drank, or tap 📷 for a photo. Quick chips for water; "Log weight" for body weight. Water and weight can also just be typed ("16 oz water", "I weigh 181").
- **Trends** — weight, sleep, steps, and resting heart rate over time.
- **Settings** — sync setup and status.

---

## Files

| File | Purpose |
|---|---|
| `server.js` | Express server, auth, all API routes. |
| `db.js` | SQLite schema + connection + day/timezone helpers. |
| `appleHealth.js` | Parses Health Auto Export payloads into daily metrics. |
| `metrics.js` | Aggregations for the dashboard and the briefing context. |
| `ai.js` | Anthropic calls: nutrition extraction (chat + vision) and the morning briefing. |
| `public/` | The installable PWA front-end. |

## Notes on the science

The briefing is told to use only well-established evidence (randomized trials, large cohorts, major guidelines) and to explicitly ignore wellness-industry claims that aren't supported — detoxes/cleanses, "metabolism boosters," alkaline/celery fads, unjustified megadose supplements, the rigid "8 glasses of water" rule, etc. If you see it repeating something unscientific, tighten the `REVIEW_SYSTEM` prompt in `ai.js`.
