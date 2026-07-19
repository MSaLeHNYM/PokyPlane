/**
 * Mobile PWA gate — phones/tablets must run the installed app, not a tab.
 * Also registers the service worker and wires the native install prompt.
 */

let deferredInstall = null;
let gateActive = false;

export function isTouchMobile() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|webOS|BlackBerry/i.test(ua)) return true;
  // iPadOS 13+ reports desktop Safari UA
  if (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) {
    return true;
  }
  try {
    // Phone/tablet form factor with touch — leave large desktop touchscreens alone
    if (
      window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(max-width: 1024px), (max-height: 1024px)').matches
    ) {
      return true;
    }
  } catch {
    /* */
  }
  return 'ontouchstart' in window && /Mobi/i.test(ua);
}

export function isStandalonePwa() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch {
    /* */
  }
  // iOS Safari home-screen
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  // Android TWA / related
  if (document.referrer?.startsWith('android-app://')) return true;
  return false;
}

/** True when this session is allowed to play the game. */
export function canPlayGame() {
  if (!isTouchMobile()) return true;
  return isStandalonePwa();
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const swUrl = new URL('sw.js', window.location.href);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl.href).catch((err) => {
      console.warn('[pwa] sw register failed', err);
    });
  });
}

export function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    document.getElementById('pwa-install-btn')?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
    const status = document.getElementById('pwa-status');
    if (status) status.textContent = '';
  });
}

export async function promptPwaInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  return choice?.outcome === 'accepted';
}

/**
 * Show / hide the install gate. Returns true if the game is blocked.
 */
export function applyPwaGate() {
  const el = document.getElementById('pwa-gate');
  const blocked = !canPlayGame();
  gateActive = blocked;
  document.body.classList.toggle('pwa-gate-active', blocked);
  document.body.classList.toggle('pwa-standalone', isStandalonePwa());
  el?.classList.toggle('hidden', !blocked);
  if (blocked) {
    el?.setAttribute('aria-hidden', 'false');
  } else {
    el?.setAttribute('aria-hidden', 'true');
  }
  return blocked;
}

export function isPwaGateActive() {
  return gateActive;
}

/** Force landscape without asking the user (works best in installed PWA). */
export async function forceLandscape() {
  try {
    const orient = screen.orientation;
    if (orient?.lock) {
      await orient.lock('landscape');
      return true;
    }
  } catch {
    /* browser may deny; CSS fallback handles portrait in standalone */
  }
  return false;
}
