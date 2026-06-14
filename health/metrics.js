const { db, dayOf } = require('./db');

// Metrics where we report a daily average over a window; everything else uses average too,
// but cumulative ones (steps/energy/exercise) are summed per-day already by ingestion.
const APPLE_TYPES = [
  'sleep_hours', 'steps', 'exercise_min', 'active_energy_kcal', 'stand_min',
  'resting_hr', 'hrv_ms', 'heart_rate_avg', 'respiratory_rate', 'spo2',
  'vo2_max', 'distance_mi', 'flights', 'body_fat_pct',
];

const getMetric = db.prepare('SELECT value, unit FROM apple_health WHERE date = ? AND type = ?');

function appleForDay(date) {
  const out = {};
  for (const t of APPLE_TYPES) {
    const row = getMetric.get(date, t);
    if (row && row.value != null) out[t] = round(row.value);
  }
  return out;
}

function nutritionForDay(date) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS items,
      COALESCE(SUM(calories), 0)  AS calories,
      COALESCE(SUM(protein_g), 0) AS protein_g,
      COALESCE(SUM(carbs_g), 0)   AS carbs_g,
      COALESCE(SUM(fat_g), 0)     AS fat_g
    FROM nutrition_logs WHERE day = ?
  `).get(date);
  return {
    items: row.items,
    calories: round(row.calories),
    protein_g: round(row.protein_g),
    carbs_g: round(row.carbs_g),
    fat_g: round(row.fat_g),
  };
}

function waterForDay(date) {
  const row = db.prepare('SELECT COALESCE(SUM(amount_oz),0) AS oz FROM water_logs WHERE day = ?').get(date);
  return round(row.oz);
}

function latestWeight(beforeOrOn) {
  const manual = db.prepare(
    'SELECT weight_lb, day FROM weight_logs WHERE day <= ? ORDER BY day DESC, id DESC LIMIT 1'
  ).get(beforeOrOn);
  const apple = db.prepare(
    "SELECT value AS weight_lb, date AS day FROM apple_health WHERE type='weight_lb' AND date <= ? ORDER BY date DESC LIMIT 1"
  ).get(beforeOrOn);
  const candidates = [manual, apple].filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.day < b.day ? 1 : -1));
  return { weight_lb: round(candidates[0].weight_lb), day: candidates[0].day };
}

function foodItemsForDay(date) {
  return db.prepare(
    'SELECT description, calories, protein_g, carbs_g, fat_g FROM nutrition_logs WHERE day = ? ORDER BY id'
  ).all(date);
}

function workoutsForDay(date) {
  return db.prepare(
    'SELECT name, duration_min, energy_kcal, distance_mi FROM workouts WHERE day = ? ORDER BY id'
  ).all(date);
}

function dailyStats(date) {
  return {
    date,
    apple: appleForDay(date),
    nutrition: nutritionForDay(date),
    water_oz: waterForDay(date),
    weight: latestWeight(date),
    workouts: workoutsForDay(date),
  };
}

// average an apple metric over the last N days (excluding the given date)
function appleAvg(type, date, days) {
  const row = db.prepare(`
    SELECT AVG(value) AS v, COUNT(*) AS n FROM apple_health
    WHERE type = ? AND date < ? AND date >= date(?, '-' || ? || ' days')
  `).get(type, date, date, days);
  return row && row.n ? round(row.v) : null;
}

function nutritionAvg(date, days) {
  const row = db.prepare(`
    SELECT AVG(d.cal) AS calories, AVG(d.pro) AS protein_g FROM (
      SELECT day, SUM(calories) AS cal, SUM(protein_g) AS pro
      FROM nutrition_logs
      WHERE day < ? AND day >= date(?, '-' || ? || ' days')
      GROUP BY day
    ) d
  `).get(date, date, days);
  return { calories: round(row.calories), protein_g: round(row.protein_g) };
}

function waterAvg(date, days) {
  const row = db.prepare(`
    SELECT AVG(d.oz) AS oz FROM (
      SELECT day, SUM(amount_oz) AS oz FROM water_logs
      WHERE day < ? AND day >= date(?, '-' || ? || ' days')
      GROUP BY day
    ) d
  `).get(date, date, days);
  return round(row.oz);
}

function weightSeries(days) {
  return db.prepare(`
    SELECT day, AVG(weight_lb) AS weight_lb FROM (
      SELECT day, weight_lb FROM weight_logs
      UNION ALL
      SELECT date AS day, value AS weight_lb FROM apple_health WHERE type='weight_lb'
    )
    WHERE day >= date('now', '-' || ? || ' days')
    GROUP BY day ORDER BY day
  `).all(days).map(r => ({ day: r.day, weight_lb: round(r.weight_lb) }));
}

function appleSeries(type, days) {
  return db.prepare(`
    SELECT date AS day, value FROM apple_health
    WHERE type = ? AND date >= date('now', '-' || ? || ' days')
    ORDER BY date
  `).all(type, days).map(r => ({ day: r.day, value: round(r.value) }));
}

// Compact, structured context handed to the model for the morning review.
function reviewContext(date) {
  const today = dailyStats(date);
  const avg7 = {
    sleep_hours: appleAvg('sleep_hours', date, 7),
    steps: appleAvg('steps', date, 7),
    exercise_min: appleAvg('exercise_min', date, 7),
    active_energy_kcal: appleAvg('active_energy_kcal', date, 7),
    resting_hr: appleAvg('resting_hr', date, 7),
    hrv_ms: appleAvg('hrv_ms', date, 7),
    nutrition: nutritionAvg(date, 7),
    water_oz: waterAvg(date, 7),
  };

  const w = weightSeries(35);
  let weightTrend = null;
  if (w.length >= 2) {
    const first = w[0], last = w[w.length - 1];
    weightTrend = {
      current_lb: last.weight_lb,
      change_lb: round(last.weight_lb - first.weight_lb),
      over_days: daysBetween(first.day, last.day),
    };
  }

  // last 7 days of workouts
  const recentWorkouts = db.prepare(`
    SELECT day, name, duration_min, energy_kcal FROM workouts
    WHERE day >= date(?, '-7 days') ORDER BY day DESC LIMIT 20
  `).all(date);

  return {
    date,
    today: {
      sleep_hours_last_night: today.apple.sleep_hours ?? null,
      steps: today.apple.steps ?? null,
      exercise_min: today.apple.exercise_min ?? null,
      active_energy_kcal: today.apple.active_energy_kcal ?? null,
      resting_hr: today.apple.resting_hr ?? null,
      hrv_ms: today.apple.hrv_ms ?? null,
      vo2_max: today.apple.vo2_max ?? null,
      spo2: today.apple.spo2 ?? null,
      calories_in: today.nutrition.calories,
      protein_g: today.nutrition.protein_g,
      carbs_g: today.nutrition.carbs_g,
      fat_g: today.nutrition.fat_g,
      food_items: foodItemsForDay(date),
      water_oz: today.water_oz,
      weight_lb: today.weight ? today.weight.weight_lb : null,
    },
    averages_last_7_days: avg7,
    weight_trend: weightTrend,
    recent_workouts: recentWorkouts,
    data_completeness: {
      has_apple_health: Object.keys(today.apple).length > 0,
      has_food_log: today.nutrition.items > 0,
      has_weight: !!today.weight,
    },
  };
}

function round(x) {
  if (x == null || Number.isNaN(x)) return null;
  return Math.round(Number(x) * 10) / 10;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

module.exports = {
  dailyStats,
  reviewContext,
  weightSeries,
  appleSeries,
  nutritionAvg,
  waterAvg,
};
