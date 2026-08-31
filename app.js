// app.js
// Daylog backend — Express + Node.js (simple, single-file version)

const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/ping', (req, res) => res.status(200).send('pong'));



// ---- core middleware -------------------------------------------------------
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// fake auth inline — just reads a header, defaults to guest
app.use((req, res, next) => {
  req.user = { id: req.headers['x-user-id'] || 'guest' };
  next();
});

// ---- static files -----------------------------------------
app.use(express.static(__dirname));

// ---- in-memory "database" --------------------------------------------------
let posts = [];
let users = [];
let messages = [];

// ---- page routes (grouped together, all before the SPA fallback) ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/explore', (req, res) => res.sendFile(path.join(__dirname, 'explore.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'create.html')));
app.get('/messages', (req, res) => res.sendFile(path.join(__dirname, 'messages.html')));
app.get('/post', (req, res) => res.sendFile(path.join(__dirname, 'post.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'auth.html')));

// old bookmarks/links to /inbox still work
app.get('/inbox', (req, res) => res.redirect(301, '/messages'));

// ---- API routes ---------------------------------------------------------
app.get('/api/posts', (req, res) => res.json(posts));
app.get('/api/explore', (req, res) => res.json(posts));

app.post('/api/posts', (req, res) => {
  const post = { id: Date.now().toString(), ...req.body, userId: req.user.id };
  posts.push(post);
  res.status(201).json(post);
});

app.get('/api/users', (req, res) => res.json(users));
app.get('/api/users/me', (req, res) => res.json(req.user));
app.get('/api/inbox', (req, res) => res.json(messages)); // kept as-is; DMs live in Supabase now, not this in-memory array




app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- SPA fallback (catch anything else non-/api) ---------------------------
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- 404 for unmatched /api routes -----------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---- error handling -------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Daylog backend running on http://localhost:${PORT}`);
});