import { presenceHeartbeat, presenceOffline, isLoggedIn } from './api.js';

let timer = null;

export function startPresenceLoop(getState) {
  stopPresenceLoop();
  if (!isLoggedIn()) return;

  const beat = async () => {
    if (!isLoggedIn()) return;
    const st = getState?.() || { status: 'online' };
    await presenceHeartbeat(st);
  };

  beat();
  timer = setInterval(beat, 30000);
}

export function stopPresenceLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  presenceOffline();
}
