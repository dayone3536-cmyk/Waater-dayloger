// app.js
// Waater backend — Express. Serves only: circles.html (home), circle.html, auth.html.

const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { startNotificationCron } = require('./notification-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/ping', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.status(200).send('pong');
});

// ---- core middleware -------------------------------------------------------
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- never hand out server files (code, secrets) ---------------------------
app.use((req, res, next) => {
  if (/^\/(app\.js|notification-cron\.js|package(-lock)?\.json|\.env[^/]*|\.git|node_modules)(\/|$)/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

// ---- static files (images, css, etc.) ---------------------------------------
app.use(express.static(__dirname, { index: false }));

// ---- pages -------------------------------------------------------------------
// home = your private circles
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'circles.html')));
app.get('/circles', (req, res) => res.redirect(301, '/'));
app.get('/circle', (req, res) => res.sendFile(path.join(__dirname, 'circle.html')));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'auth.html')));

// old invite links (/circle/join?code=XXXX) -> the circle preview, keeping the code
app.get('/circle/join', (req, res) => {
  const code = req.query.code ? `?code=${encodeURIComponent(req.query.code)}` : '';
  res.redirect(302, `/circle${code}`);
});

// email unsubscribe / notification settings (the notification emails link here)
app.get('/notify-settings', (req, res) => res.sendFile(path.join(__dirname, 'notify-settings.html')));
app.get('/unsubscribe', (req, res) => res.sendFile(path.join(__dirname, 'notify-settings.html')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- anything else goes back to your circles --------------------------------
app.get(/^(?!\/api).*/, (req, res) => res.redirect(302, '/'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Waater running on http://localhost:${PORT}`);
  startNotificationCron();
});