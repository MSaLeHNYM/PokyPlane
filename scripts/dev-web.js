/**
 * Start Vite on VITE_GAME_PORT (default 80). Falls back to 8080 if port 80 needs root.
 */
import net from 'net';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const preferred = Number(process.env.VITE_GAME_PORT || 80);
const fallbacks = [preferred, 8080, 5173].filter((p, i, a) => a.indexOf(p) === i);

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (const port of fallbacks) {
    if (await canBind(port)) return port;
  }
  return 5173;
}

const port = await pickPort();

if (port !== preferred) {
  console.warn(
    `[web] Port ${preferred} unavailable (needs sudo on Linux). Using http://localhost:${port}/`
  );
  if (preferred === 80) {
    console.warn('[web] For port 80:  sudo env VITE_GAME_PORT=80 npm run dev');
  }
} else {
  console.log(`[web] Game → http://localhost${port === 80 ? '' : `:${port}`}/`);
}

const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_ACTUAL_GAME_PORT: String(port) },
});

child.on('exit', (code) => process.exit(code ?? 0));
