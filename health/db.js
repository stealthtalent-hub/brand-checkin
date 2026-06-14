const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'health.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS apple_health (
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,
  value      REAL,
  unit       TEXT,
  raw        TEXT,
  updated_at TEXT,
  PRIMARY KEY (date, type)
);

CREATE TABLE IF NOT EXISTS workouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  day          TEXT,
  start        TEXT,
  finish       TEXT,
  name         TEXT,
  duration_min REAL,
  energy_kcal  REAL,
  distance_mi  REAL,
  raw          TEXT,
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_workouts_day ON workouts(day);

CREATE TABLE IF NOT EXISTS weight_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT,
  day       TEXT,
  weight_lb REAL,
  note      TEXT,
  source    TEXT
);
CREATE INDEX IF NOT EXISTS idx_weight_day ON weight_logs(day);

CREATE TABLE IF NOT EXISTS water_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT,
  day       TEXT,
  amount_oz REAL
);
CREATE INDEX IF NOT EXISTS idx_water_day ON water_logs(day);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT,
  day         TEXT,
  description TEXT,
  calories    REAL,
  protein_g   REAL,
  carbs_g     REAL,
  fat_g       REAL,
  source      TEXT,
  raw         TEXT
);
CREATE INDEX IF NOT EXISTS idx_nutrition_day ON nutrition_logs(day);

CREATE TABLE IF NOT EXISTS chat_messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT,
  role    TEXT,
  content TEXT,
  meta    TEXT
);

CREATE TABLE IF NOT EXISTS daily_reviews (
  date       TEXT PRIMARY KEY,
  content    TEXT,
  created_at TEXT
);
`);

// ---- Time helpers (timezone-aware "local day") ----
const TZ = process.env.HEALTH_TZ || undefined;

function dayOf(date = new Date()) {
  // en-CA formats as YYYY-MM-DD
  try {
    return new Intl.DateTimeFormat('en-CA', TZ ? { timeZone: TZ } : {}).format(date);
  } catch (e) {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function today() {
  return dayOf(new Date());
}

// upsert one Apple Health daily metric
const upsertMetric = db.prepare(`
  INSERT INTO apple_health (date, type, value, unit, raw, updated_at)
  VALUES (@date, @type, @value, @unit, @raw, @updated_at)
  ON CONFLICT(date, type) DO UPDATE SET
    value = excluded.value,
    unit = excluded.unit,
    raw = excluded.raw,
    updated_at = excluded.updated_at
`);

module.exports = { db, dayOf, today, upsertMetric, TZ };
