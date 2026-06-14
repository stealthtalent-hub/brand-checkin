// Load .env from repo root if present.
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) {}

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { db, today, dayOf } = require('./db');
const appleHealth = require('./appleHealth');
const metrics = require('./metrics');
const ai = require('./ai');

const app = express();
const PORT = process.env.HEALTH_PORT || 3100;
const PASSCODE = process.env.HEALTH_PASSCODE || 'change-me';
const SECRET = process.env.HEALTH_SECRET || PASSCODE + '::salt';
const INGEST_TOKEN = process.env.HEALTH_INGEST_TOKEN || '';

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth ----------
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function makeToken() {
  const payload = `v1.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
function validToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
function requireAuth(req, res, next) {
  const token = parseCookies(req).h_session;
  if (validToken(token)) return next();
  res.status(401).json({ error: 'Not authenticated.' });
}

app.post('/api/health/login', (req, res) => {
  const { passcode } = req.body || {};
  if (!passcode || passcode !== PASSCODE) {
    return res.status(401).json({ error: 'Wrong passcode.' });
  }
  const token = makeToken();
  res.setHeader('Set-Cookie',
    `h_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`);
  res.json({ ok: true });
});

app.post('/api/health/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'h_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/health/me', (req, res) => {
  res.json({ authed: validToken(parseCookies(req).h_session) });
});

// ---------- Apple Health ingestion (token auth, called by iPhone automation) ----------
app.post('/api/health/ingest', (req, res) => {
  const provided = req.get('X-Health-Token') || (req.query.token || '');
  if (!INGEST_TOKEN || provided !== INGEST_TOKEN) {
    return res.status(401).json({ error: 'Invalid ingest token.' });
  }
  try {
    const result = appleHealth.ingest(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('ingest error', err);
    res.status(400).json({ error: 'Could not parse Apple Health payload.' });
  }
});

// ---------- Dashboard data ----------
app.get('/api/health/summary', requireAuth, (req, res) => {
  const date = req.query.date || today();
  res.json({ date, ...metrics.dailyStats(date) });
});

app.get('/api/health/trends', requireAuth, (req, res) => {
  res.json({
    weight: metrics.weightSeries(60),
    sleep: metrics.appleSeries('sleep_hours', 14),
    steps: metrics.appleSeries('steps', 14),
    resting_hr: metrics.appleSeries('resting_hr', 14),
  });
});

// ---------- Morning review ----------
app.get('/api/health/review', requireAuth, async (req, res) => {
  const date = req.query.date || today();
  const refresh = req.query.refresh === '1';
  const existing = db.prepare('SELECT content, created_at FROM daily_reviews WHERE date = ?').get(date);
  if (existing && !refresh) {
    return res.json({ date, content: existing.content, created_at: existing.created_at, cached: true });
  }
  try {
    const context = metrics.reviewContext(date);
    const content = await ai.generateReview(context);
    const created_at = new Date().toISOString();
    db.prepare(`
      INSERT INTO daily_reviews (date, content, created_at) VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET content = excluded.content, created_at = excluded.created_at
    `).run(date, content, created_at);
    res.json({ date, content, created_at, cached: false });
  } catch (err) {
    console.error('review error', err);
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'The server has no ANTHROPIC_API_KEY set, so reviews are disabled.' });
    }
    res.status(500).json({ error: 'Could not generate the review.' });
  }
});

// ---------- Chat (nutrition / water / weight logging) ----------
app.get('/api/health/chat-history', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT role, content, meta, ts FROM chat_messages ORDER BY id DESC LIMIT 50').all();
  res.json({ messages: rows.reverse() });
});

app.post('/api/health/chat', requireAuth, async (req, res) => {
  const { message, image, imageType } = req.body || {};
  if (!message && !image) return res.status(400).json({ error: 'Say something or attach a photo.' });

  const ts = new Date().toISOString();
  db.prepare('INSERT INTO chat_messages (ts, role, content, meta) VALUES (?, ?, ?, ?)')
    .run(ts, 'user', message || '[photo]', image ? JSON.stringify({ hadImage: true }) : null);

  try {
    const result = await ai.logFromChat({
      message,
      imageBase64: image || null,
      imageMediaType: imageType || 'image/jpeg',
    });

    const applied = applyLogs(result.logs);

    db.prepare('INSERT INTO chat_messages (ts, role, content, meta) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), 'assistant', result.reply, JSON.stringify({ logs: applied }));

    res.json({ reply: result.reply, logs: applied });
  } catch (err) {
    console.error('chat error', err);
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'The server has no ANTHROPIC_API_KEY set, so chat logging is disabled.' });
    }
    res.status(500).json({ error: 'Something went wrong logging that.' });
  }
});

// Quick actions
app.post('/api/health/water', requireAuth, (req, res) => {
  const oz = Number(req.body && req.body.amount_oz);
  if (!oz || oz <= 0) return res.status(400).json({ error: 'Invalid amount.' });
  const ts = new Date().toISOString();
  db.prepare('INSERT INTO water_logs (ts, day, amount_oz) VALUES (?, ?, ?)').run(ts, today(), oz);
  res.json({ ok: true, total_oz: metrics.dailyStats(today()).water_oz });
});

app.post('/api/health/weight', requireAuth, (req, res) => {
  const lb = Number(req.body && req.body.weight_lb);
  if (!lb || lb <= 0) return res.status(400).json({ error: 'Invalid weight.' });
  const ts = new Date().toISOString();
  db.prepare('INSERT INTO weight_logs (ts, day, weight_lb, note, source) VALUES (?, ?, ?, ?, ?)')
    .run(ts, today(), lb, (req.body.note || '').slice(0, 200), 'manual');
  res.json({ ok: true });
});

// Settings: show the ingest endpoint + token so the user can set up their phone.
app.get('/api/health/config', requireAuth, (req, res) => {
  res.json({
    ingest_path: '/api/health/ingest',
    ingest_token: INGEST_TOKEN || null,
    timezone: process.env.HEALTH_TZ || '(server local)',
    model: ai.MODEL,
    chat_model: ai.CHAT_MODEL,
    api_key_set: !!process.env.ANTHROPIC_API_KEY,
  });
});

function applyLogs(logs) {
  const ts = new Date().toISOString();
  const day = today();
  const applied = [];
  const insNutrition = db.prepare(`
    INSERT INTO nutrition_logs (ts, day, description, calories, protein_g, carbs_g, fat_g, source, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const log of logs || []) {
    if (log.kind === 'food' || log.kind === 'drink') {
      insNutrition.run(ts, day, log.description || 'food',
        num(log.calories), num(log.protein_g), num(log.carbs_g), num(log.fat_g),
        'chat', JSON.stringify(log));
      applied.push({ kind: 'food', description: log.description, calories: num(log.calories), protein_g: num(log.protein_g) });
    } else if (log.kind === 'water') {
      const oz = num(log.water_oz) || 0;
      if (oz > 0) {
        db.prepare('INSERT INTO water_logs (ts, day, amount_oz) VALUES (?, ?, ?)').run(ts, day, oz);
        applied.push({ kind: 'water', description: log.description, water_oz: oz });
      }
    } else if (log.kind === 'weight') {
      const lb = num(log.weight_lb);
      if (lb) {
        db.prepare('INSERT INTO weight_logs (ts, day, weight_lb, note, source) VALUES (?, ?, ?, ?, ?)')
          .run(ts, day, lb, '', 'chat');
        applied.push({ kind: 'weight', description: log.description, weight_lb: lb });
      }
    }
  }
  return applied;
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// SPA fallback for client routes
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Personal Health app running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ! ANTHROPIC_API_KEY not set — chat logging and reviews will be disabled until you add it.');
  }
  if (!process.env.HEALTH_INGEST_TOKEN) {
    console.warn('  ! HEALTH_INGEST_TOKEN not set — Apple Health ingestion is locked. Set it to enable nightly sync.');
  }
});
