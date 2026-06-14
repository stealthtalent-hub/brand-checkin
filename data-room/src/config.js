require('dotenv').config();

const PORT = parseInt(process.env.PORT || '4000', 10);
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const config = {
  port: PORT,
  appBaseUrl: APP_BASE_URL,

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${APP_BASE_URL}/auth/google/callback`,
    // Full Drive access is needed to read and copy the user's existing files;
    // Docs access lets us generate professionally formatted index documents.
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.REPORT_FROM || process.env.SMTP_USER
  }
};

function assertConfigured() {
  const missing = [];
  if (!config.google.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!config.google.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
  return missing;
}

module.exports = { config, assertConfigured };
