const { google } = require('googleapis');
const { config } = require('../config');
const store = require('../store');

function createOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // request a refresh token
    prompt: 'consent', // ensure a refresh token comes back on re-auth
    scope: config.google.scopes
  });
}

async function exchangeCodeForTokens(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  store.saveTokens(tokens);
  return tokens;
}

// Returns an authorized OAuth client using the stored tokens, or null if the
// app has not been connected to a Google account yet. Persists refreshed tokens.
function getAuthorizedClient() {
  const tokens = store.loadTokens();
  if (!tokens) return null;

  const client = createOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    const merged = { ...store.loadTokens(), ...newTokens };
    store.saveTokens(merged);
  });
  return client;
}

async function getConnectedEmail(client) {
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return data.email || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  createOAuthClient,
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthorizedClient,
  getConnectedEmail
};
