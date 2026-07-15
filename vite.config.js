import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gamePort = Number(env.VITE_GAME_PORT || 80);
  const apiPort = Number(env.PORT || 7777);

  return {
    base: './',
    server: {
      port: gamePort,
      strictPort: false,
      open: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/admin': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: gamePort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/admin': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
