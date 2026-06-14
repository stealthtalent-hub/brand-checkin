const express = require('express');
const path = require('path');
const { config, assertConfigured } = require('./config');

const authRoutes = require('./routes/auth');
const dataRoomRoutes = require('./routes/dataroom');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/auth', authRoutes);
app.use('/api', dataRoomRoutes);

app.get('/healthz', (req, res) => {
  res.json({ ok: true, missingConfig: assertConfigured() });
});

app.listen(config.port, () => {
  const missing = assertConfigured();
  console.log(`Data Room Builder running at ${config.appBaseUrl}`);
  if (missing.length) {
    console.warn(`⚠  Missing configuration: ${missing.join(', ')}. See .env.example.`);
  }
});
