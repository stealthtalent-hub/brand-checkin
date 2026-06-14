const express = require('express');
const router = express.Router();
const auth = require('../drive/auth');
const store = require('../store');

// Kick off the Google OAuth consent flow.
router.get('/google', (req, res) => {
  res.redirect(auth.getAuthUrl());
});

// OAuth redirect target — exchange the code for tokens and return to the app.
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?auth=denied');
  if (!code) return res.redirect('/?auth=missing_code');
  try {
    await auth.exchangeCodeForTokens(code);
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('OAuth exchange failed:', err.message);
    res.redirect('/?auth=failed');
  }
});

// Disconnect the currently linked Google account.
router.post('/disconnect', (req, res) => {
  store.clearTokens();
  res.json({ ok: true });
});

module.exports = router;
