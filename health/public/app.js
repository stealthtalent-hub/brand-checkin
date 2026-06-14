'use strict';

const $ = (s) => document.querySelector(s);
const api = (path, opts) => fetch('/api/health' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));

let pendingImage = null; // { data, type }

// ---------- Auth / boot ----------
async function boot() {
  const me = await api('/me').then(r => r.json()).catch(() => ({ authed: false }));
  if (me.authed) showApp(); else showLogin();
}

function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  loadToday();
}

$('#login-btn').addEventListener('click', doLogin);
$('#passcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  const passcode = $('#passcode').value;
  const r = await api('/login', { method: 'POST', body: JSON.stringify({ passcode }) });
  if (r.ok) { $('#login-err').textContent = ''; showApp(); }
  else { $('#login-err').textContent = (await r.json().catch(() => ({}))).error || 'Login failed.'; }
}

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  showLogin();
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $('#view-' + view).classList.remove('hidden');
    if (view === 'chat') loadChat();
    if (view === 'trends') loadTrends();
    if (view === 'settings') loadSettings();
  });
});

// ---------- Today ----------
async function loadToday() {
  loadSummary();
  loadReview(false);
}

async function loadSummary() {
  const s = await api('/summary').then(r => r.json()).catch(() => null);
  if (!s) return;
  const a = s.apple || {};
  const n = s.nutrition || {};
  const cards = [];

  cards.push(stat('Sleep', a.sleep_hours != null ? a.sleep_hours : '—', 'hr',
    a.sleep_hours == null ? 'no data' : (a.sleep_hours >= 7 ? 'on target' : 'below 7h'),
    a.sleep_hours == null ? '' : (a.sleep_hours >= 7 ? 'good' : 'warn')));

  cards.push(stat('Steps', a.steps != null ? fmt(a.steps) : '—', '',
    a.steps == null ? 'no data' : '', ''));

  cards.push(stat('Exercise', a.exercise_min != null ? a.exercise_min : '—', 'min',
    a.exercise_min == null ? 'no data' : '', a.exercise_min >= 20 ? 'good' : ''));

  cards.push(stat('Calories in', n.calories ? fmt(n.calories) : '0', 'kcal',
    n.items ? n.items + ' items' : 'nothing logged', ''));

  cards.push(stat('Protein', n.protein_g ? n.protein_g : '0', 'g',
    '', n.protein_g >= 100 ? 'good' : ''));

  cards.push(stat('Water', s.water_oz || 0, 'oz', '', s.water_oz >= 64 ? 'good' : ''));

  cards.push(stat('Resting HR', a.resting_hr != null ? a.resting_hr : '—', 'bpm', '', ''));

  cards.push(stat('Weight', s.weight ? s.weight.weight_lb : '—', 'lb',
    s.weight ? s.weight.day : 'not logged', ''));

  $('#stats-grid').innerHTML = cards.join('');
}

function stat(label, value, unit, sub, cls) {
  return `<div class="stat ${cls || ''}">
    <div class="label">${label}</div>
    <div class="value">${value}${unit ? `<span>${unit}</span>` : ''}</div>
    <div class="sub">${sub || ''}</div>
  </div>`;
}

async function loadReview(refresh) {
  const body = $('#review-body');
  body.innerHTML = refresh ? 'Rethinking…' : 'Loading your briefing…';
  const r = await api('/review' + (refresh ? '?refresh=1' : '')).then(x => x.json()).catch(() => null);
  if (!r) { body.textContent = 'Could not load the briefing.'; return; }
  if (r.error) { body.innerHTML = `<p class="muted">${r.error}</p>`; return; }
  body.innerHTML = mdToHtml(r.content);
}
$('#refresh-review').addEventListener('click', () => loadReview(true));

// ---------- Chat ----------
async function loadChat() {
  const r = await api('/chat-history').then(x => x.json()).catch(() => ({ messages: [] }));
  const log = $('#chat-log');
  log.innerHTML = '';
  if (!r.messages.length) {
    log.innerHTML = `<div class="bubble bot">Tell me what you eat and drink — type it or snap a photo. Say things like “16 oz water”, “I weigh 182”, or “two eggs and toast”.</div>`;
  }
  for (const m of r.messages) {
    const meta = safeJson(m.meta);
    addBubble(m.role === 'user' ? 'user' : 'bot', m.content, meta && meta.logs);
  }
  scrollChat();
}

function addBubble(who, text, logs) {
  const log = $('#chat-log');
  const div = document.createElement('div');
  div.className = 'bubble ' + (who === 'user' ? 'user' : 'bot');
  div.textContent = text;
  if (logs && logs.length) {
    const chips = document.createElement('div');
    chips.className = 'logchips';
    for (const l of logs) chips.appendChild(logChip(l));
    div.appendChild(chips);
  }
  log.appendChild(div);
  scrollChat();
  return div;
}

function logChip(l) {
  const span = document.createElement('span');
  span.className = 'logchip';
  if (l.kind === 'food') span.textContent = `${l.description} · ${Math.round(l.calories || 0)} kcal`;
  else if (l.kind === 'water') span.textContent = `💧 ${l.water_oz} oz`;
  else if (l.kind === 'weight') span.textContent = `⚖ ${l.weight_lb} lb`;
  else span.textContent = l.description || '';
  return span;
}

function scrollChat() { const l = $('#chat-log'); l.scrollTop = l.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-text');
  const text = input.value.trim();
  if (!text && !pendingImage) return;
  input.value = '';
  addBubble('user', text || '📷 photo');
  const pending = addBubble('bot', '…');
  pending.classList.add('pending');

  const body = { message: text };
  if (pendingImage) { body.image = pendingImage.data; body.imageType = pendingImage.type; }
  clearPhoto();

  const r = await api('/chat', { method: 'POST', body: JSON.stringify(body) }).then(x => x.json()).catch(() => null);
  pending.remove();
  if (!r) { addBubble('bot', 'Network error — try again.'); return; }
  if (r.error) { addBubble('bot', r.error); return; }
  addBubble('bot', r.reply, r.logs);
});

$('#photo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { data: String(reader.result).split(',')[1], type: file.type || 'image/jpeg' };
    $('#photo-preview').textContent = '📷 photo attached — add a note or send';
    $('#photo-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});
function clearPhoto() { pendingImage = null; $('#photo').value = ''; $('#photo-preview').classList.add('hidden'); }

document.querySelectorAll('[data-water]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const oz = Number(btn.dataset.water);
    const r = await api('/water', { method: 'POST', body: JSON.stringify({ amount_oz: oz }) }).then(x => x.json());
    toast(`+${oz} oz · ${r.total_oz} oz today`);
  });
});
$('[data-weigh]').addEventListener('click', async () => {
  const v = prompt('Body weight (lb):');
  const lb = Number(v);
  if (!lb) return;
  await api('/weight', { method: 'POST', body: JSON.stringify({ weight_lb: lb }) });
  toast(`Logged ${lb} lb`);
});

// ---------- Trends ----------
async function loadTrends() {
  const t = await api('/trends').then(r => r.json()).catch(() => null);
  if (!t) return;
  if (t.weight.length) $('#weight-now').textContent = t.weight[t.weight.length - 1].weight_lb + ' lb';
  $('#chart-weight').innerHTML = lineChart(t.weight.map(d => d.weight_lb), t.weight.map(d => d.day));
  $('#chart-rhr').innerHTML = lineChart(t.resting_hr.map(d => d.value), t.resting_hr.map(d => d.day));
  $('#chart-sleep').innerHTML = barChart(t.sleep.map(d => d.value), 7, 'h');
  $('#chart-steps').innerHTML = barChart(t.steps.map(d => d.value), null, 'k', v => (v / 1000).toFixed(1));
}

function lineChart(values, labels) {
  const pts = values.filter(v => v != null);
  if (pts.length < 2) return '<div class="muted small">Not enough data yet.</div>';
  const W = 320, H = 110, pad = 8;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = (max - min) || 1;
  const n = values.length;
  const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  let d = '', area = '';
  let started = false, firstX = 0, lastX = 0;
  values.forEach((v, i) => {
    if (v == null) return;
    const cmd = started ? 'L' : 'M';
    d += `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    if (!started) { firstX = x(i); started = true; }
    lastX = x(i);
  });
  area = `M${firstX},${H - pad} ` + d.replace(/^M/, 'L') + `L${lastX},${H - pad} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d39e"/><stop offset="100%" stop-color="#34d39e" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    <text x="${pad}" y="12">${max}</text>
    <text x="${pad}" y="${H - 2}">${min}</text>
  </svg>`;
}

function barChart(values, target, unit, fmtFn) {
  if (!values.length) return '<div class="muted small">No data yet.</div>';
  const max = Math.max(...values, target || 0) || 1;
  return values.map((v, i) => {
    const h = Math.max(2, (v / max) * 80);
    const low = target && v < target;
    const label = fmtFn ? fmtFn(v) : (v % 1 ? v.toFixed(1) : v);
    return `<div class="bar ${low ? 'low' : ''}" style="height:${h}px" title="${v}">
      ${i % 2 === 0 ? `<span class="blab">${label}</span>` : ''}</div>`;
  }).join('');
}

// ---------- Settings ----------
async function loadSettings() {
  const c = await api('/config').then(r => r.json()).catch(() => null);
  if (!c) return;
  const origin = location.origin;
  $('#cfg-endpoint').textContent = origin + c.ingest_path;
  $('#cfg-token').textContent = c.ingest_token || '(not set — see README)';
  $('#cfg-tz').textContent = c.timezone;
  $('#cfg-key').textContent = c.api_key_set ? 'configured ✓' : 'missing — set ANTHROPIC_API_KEY';
  $('#cfg-model').textContent = c.model;
}

// ---------- Utils ----------
function fmt(n) { return Number(n).toLocaleString(); }
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

let toastTimer;
function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1800);
}

// Minimal, safe Markdown -> HTML (escapes first).
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(md || '').split('\n');
  let html = '', inList = false;
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
  for (let line of lines) {
    const t = line.trim();
    if (/^#{1,6}\s/.test(t)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${inline(t.replace(/^#{1,6}\s/, ''))}</h3>`;
    } else if (/^[-*]\s/.test(t)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(t.replace(/^[-*]\s/, ''))}</li>`;
    } else if (t === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(t)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
