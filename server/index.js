import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { ExpressPeerServer } from 'peer';
import { config } from './config.js';
import { migrate } from './models/user.js';
import { ipBanMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import scoresRoutes from './routes/scores.js';
import presenceRoutes from './routes/presence.js';
import adminRoutes from './routes/admin.js';
import announcementRoutes from './routes/announcement.js';
import mpRoutes from './routes/mp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (config.clientOrigin && origin === config.clientOrigin) return cb(null, true);
      if (config.nodeEnv !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      if (config.nodeEnv === 'production' && !config.clientOrigin) {
        return cb(null, true);
      }
      cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(ipBanMiddleware);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pokyplane-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/scores', scoresRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/announcement', announcementRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mp', mpRoutes);

// Same-origin PeerJS signaling (before SPA catch-all).
// Mount at /peerjs with path '/' so client path '/peerjs' hits /peerjs/peerjs (HTTP + WS).
const peerServer = ExpressPeerServer(server, {
  path: '/',
  allow_discovery: false,
  proxied: true, // Liara / reverse proxies
  expire_timeout: 12000,
  alive_timeout: 90000,
});
app.use('/peerjs', peerServer);

app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

const distDir = path.join(__dirname, '..', 'dist');
if (config.nodeEnv === 'production') {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/peerjs')) return next();
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({
    error: 'server_error',
    message: config.nodeEnv === 'development' ? err.message : 'Internal server error.',
  });
});

async function start() {
  if (!config.databaseUrl) {
    console.error(
      '[api] DATABASE_URL is required in production.\n' +
        '      Create a Liara Postgres DB and set DATABASE_URL on the app.'
    );
    process.exit(1);
  }
  await migrate();
  const host = process.env.HOST || '0.0.0.0';

  server.listen(config.port, host, () => {
    console.log(`[api] http://${host}:${config.port}`);
    console.log(`[peer] http://${host}:${config.port}/peerjs`);
    console.log(`[admin] http://${host}:${config.port}/admin/`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[api] Port ${config.port} is already in use.\n` +
          `      Stop the other process:  fuser -k ${config.port}/tcp\n` +
          `      Or change PORT in .env`
      );
      process.exit(1);
    }
    throw err;
  });
}

start().catch((e) => {
  console.error('[api] failed to start', e);
  process.exit(1);
});
