const { db, dayOf, upsertMetric } = require('./db');

// Map Health Auto Export metric names -> our canonical type + aggregation.
// agg: 'sum' (cumulative across the day) or 'avg' (averaged across the day).
const METRIC_MAP = {
  step_count:               { type: 'steps',             agg: 'sum' },
  active_energy:            { type: 'active_energy_kcal', agg: 'sum' },
  basal_energy_burned:      { type: 'basal_energy_kcal',  agg: 'sum' },
  apple_exercise_time:      { type: 'exercise_min',       agg: 'sum' },
  apple_stand_time:         { type: 'stand_min',          agg: 'sum' },
  apple_stand_hour:         { type: 'stand_hours',        agg: 'sum' },
  distance_walking_running: { type: 'distance_mi',        agg: 'sum' },
  flights_climbed:          { type: 'flights',            agg: 'sum' },
  dietary_energy:           { type: 'diet_energy_kcal',   agg: 'sum' },
  resting_heart_rate:       { type: 'resting_hr',         agg: 'avg' },
  heart_rate:               { type: 'heart_rate_avg',     agg: 'avg' },
  walking_heart_rate_average:{ type: 'walking_hr',        agg: 'avg' },
  heart_rate_variability:   { type: 'hrv_ms',             agg: 'avg' },
  respiratory_rate:         { type: 'respiratory_rate',   agg: 'avg' },
  blood_oxygen_saturation:  { type: 'spo2',               agg: 'avg' },
  vo2_max:                  { type: 'vo2_max',            agg: 'avg' },
  body_fat_percentage:      { type: 'body_fat_pct',       agg: 'avg' },
  weight_body_mass:         { type: 'weight_lb',          agg: 'avg' },
  body_mass_index:          { type: 'bmi',               agg: 'avg' },
};

function pickNumber(d) {
  for (const k of ['qty', 'Avg', 'avg', 'value', 'amount']) {
    if (typeof d[k] === 'number') return d[k];
  }
  return null;
}

function dateOf(d) {
  const s = d.date || d.startDate || d.start || '';
  return String(s).slice(0, 10);
}

// Pull asleep hours out of a sleep_analysis data point across HAE format variants.
function sleepHours(d) {
  for (const k of ['asleep', 'totalSleep', 'value', 'qty']) {
    if (typeof d[k] === 'number') return d[k];
  }
  // sum of stages if present
  const stages = ['deep', 'core', 'rem'];
  let sum = 0, found = false;
  for (const k of stages) {
    if (typeof d[k] === 'number') { sum += d[k]; found = true; }
  }
  return found ? sum : null;
}

function ingest(payload) {
  const data = (payload && payload.data) || payload || {};
  const metrics = data.metrics || [];
  const workouts = data.workouts || [];
  const now = new Date().toISOString();

  // accumulate (date,type) -> {sum, count, agg, unit}
  const acc = new Map();
  const bump = (date, type, val, agg, unit) => {
    if (!date || val == null || Number.isNaN(val)) return;
    const key = `${date}|${type}`;
    const cur = acc.get(key) || { date, type, sum: 0, count: 0, agg, unit };
    cur.sum += val;
    cur.count += 1;
    cur.unit = unit || cur.unit;
    acc.set(key, cur);
  };

  let metricPoints = 0;

  for (const m of metrics) {
    const name = (m.name || '').toLowerCase();
    const unit = m.units || m.unit || '';
    const points = m.data || [];

    if (name.includes('sleep')) {
      for (const d of points) {
        const date = dateOf(d);
        const hrs = sleepHours(d);
        if (hrs != null) { bump(date, 'sleep_hours', hrs, 'sum', 'hr'); metricPoints++; }
      }
      continue;
    }

    const map = METRIC_MAP[name];
    for (const d of points) {
      const date = dateOf(d);
      let val = pickNumber(d);
      if (val == null) continue;
      let type = map ? map.type : name;     // unknown metrics stored under raw name
      const agg = map ? map.agg : 'avg';

      // Normalize body weight to pounds if it came in kg.
      if (type === 'weight_lb' && /kg/i.test(unit)) val = val * 2.2046226218;

      bump(date, type, val, agg, type === 'weight_lb' ? 'lb' : unit);
      metricPoints++;
    }
  }

  const writeMetrics = db.transaction(() => {
    for (const v of acc.values()) {
      const value = v.agg === 'avg' ? v.sum / v.count : v.sum;
      upsertMetric.run({
        date: v.date,
        type: v.type,
        value,
        unit: v.unit || '',
        raw: null,
        updated_at: now,
      });
    }
  });
  writeMetrics();

  // Workouts (best-effort; HAE schema varies)
  let workoutCount = 0;
  const insWorkout = db.prepare(`
    INSERT INTO workouts (day, start, finish, name, duration_min, energy_kcal, distance_mi, raw, created_at)
    VALUES (@day, @start, @finish, @name, @duration_min, @energy_kcal, @distance_mi, @raw, @created_at)
  `);
  const writeWorkouts = db.transaction(() => {
    for (const w of workouts) {
      const start = w.start || w.startDate || '';
      const day = String(start).slice(0, 10) || dayOf(new Date());
      let dur = null;
      if (typeof w.duration === 'number') dur = w.duration > 600 ? w.duration / 60 : w.duration; // sec->min heuristic
      const energy = num(w.activeEnergyBurned) ?? num(w.totalEnergyBurned) ?? num(w.activeEnergy) ?? null;
      const distance = num(w.distance) ?? null;
      insWorkout.run({
        day,
        start: String(start),
        finish: String(w.end || w.endDate || ''),
        name: w.name || w.workoutActivityType || w.type || 'Workout',
        duration_min: dur,
        energy_kcal: energy,
        distance_mi: distance,
        raw: JSON.stringify(w).slice(0, 4000),
        created_at: now,
      });
      workoutCount++;
    }
  });
  if (workouts.length) writeWorkouts();

  return { days: new Set([...acc.values()].map(v => v.date)).size, metricPoints, workouts: workoutCount };
}

function num(x) {
  if (typeof x === 'number') return x;
  if (x && typeof x.qty === 'number') return x.qty;
  if (x && typeof x.value === 'number') return x.value;
  return null;
}

module.exports = { ingest, METRIC_MAP };
