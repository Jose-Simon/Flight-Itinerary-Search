import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProd ? 3000 : 8787);

const app = express();
app.use(express.json({ limit: '128kb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/google-flights', async (req, res) => {
  try {
    const { apiKey, params } = req.body ?? {};
    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ error: 'Missing apiKey in request body' });
      return;
    }
    if (!params || typeof params !== 'object') {
      res.status(400).json({ error: 'Missing params object' });
      return;
    }

    const search = new URLSearchParams();
    search.set('engine', 'google_flights');
    search.set('api_key', apiKey.trim());

    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      search.set(k, String(v));
    }

    const url = `https://serpapi.com/search.json?${search.toString()}`;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'Invalid JSON from SerpApi', raw: text.slice(0, 500) });
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status).json(json);
      return;
    }

    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Proxy error' });
  }
});

app.get('/api/serpapi-account', async (req, res) => {
  try {
    const apiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
    if (!apiKey) {
      res.status(400).json({ error: 'Missing apiKey query param' });
      return;
    }
    const url = `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await upstream.text();
    let json;
    try { json = JSON.parse(text); } catch {
      res.status(502).json({ error: 'Invalid JSON from SerpApi', raw: text.slice(0, 300) });
      return;
    }
    if (!upstream.ok) { res.status(upstream.status).json(json); return; }
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Proxy error' });
  }
});

if (isProd) {
  if (!fs.existsSync(dist)) {
    console.error('dist/ not found. Run npm run build first.');
    process.exit(1);
  }
  app.use(express.static(dist));
  /** Express 5 / path-to-regexp v8 rejects `*`; fall through from static → SPA shell. */
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[server] ${isProd ? 'production' : 'dev'} listening on ${PORT}`);
});
