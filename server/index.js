import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { migrate } from './models/user.js';
import { ipBanMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import scoresRoutes from './routes/scores.js';
import presenceRoutes from './routes/presence.js';
import adminRoutes from './routes/admin.js';
import announcementRoutes from './routes/announcement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(
  cors({
    origin(origin, cb) {
      // Allow game on localhost (any port) in development
      if (!origin) return cb(null, true);
      if (origin === config.clientOrigin) return cb(null, true);
      if (config.nodeEnv !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
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

app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({
    error: 'server_error',
    message: config.nodeEnv === 'development' ? err.message : 'Internal server error.',
  });
});

async function start() {
  await migrate();
  const server = app.listen(config.port, () => {
    console.log(`[api] http://localhost:${config.port}`);
    console.log(`[admin] http://localhost:${config.port}/admin/`);
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
