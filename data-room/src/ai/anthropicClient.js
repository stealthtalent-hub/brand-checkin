const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');

let client;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

module.exports = { getClient, MODEL: config.anthropic.model };
