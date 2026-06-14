const fs = require('fs');
const path = require('path');

// Lightweight JSON-file persistence. This is a single-account tool: one set of
// Google OAuth tokens at a time, plus the most recent run's report for retrieval.
const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveTokens(tokens) {
  ensureDirs();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  return readJson(TOKENS_FILE);
}

function clearTokens() {
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
}

function saveReport(id, report) {
  ensureDirs();
  fs.writeFileSync(path.join(REPORTS_DIR, `${id}.json`), JSON.stringify(report, null, 2));
}

function loadReport(id) {
  return readJson(path.join(REPORTS_DIR, `${id}.json`));
}

module.exports = { saveTokens, loadTokens, clearTokens, saveReport, loadReport };
