/**
 * Web Push subscription for Android PWA notifications.
 */
import { api, isLoggedIn, onAuthChanged } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Ask permission (if needed) and upsert subscription for the logged-in user.
 */
export async function syncPushSubscription() {
  if (!pushSupported() || !isLoggedIn()) return false;
  try {
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : Notification.permission === 'denied'
          ? 'denied'
          : await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/vapid-public-key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await api('/push/subscribe', {
      method: 'POST',
      body: { subscription: sub.toJSON() },
    });
    return true;
  } catch (e) {
    console.warn('[push] sync failed', e.message || e);
    return false;
  }
}

export async function unsubscribePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/subscribe', {
        method: 'DELETE',
        body: { endpoint: sub.endpoint },
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* */
  }
}

/** Wire auth changes — subscribe after login (best on Android installed PWA). */
export function setupPushNotifications() {
  if (!pushSupported()) return;
  onAuthChanged((user) => {
    if (user) {
      setTimeout(() => {
        syncPushSubscription();
      }, 1200);
    }
  });
  if (isLoggedIn()) {
    setTimeout(() => syncPushSubscription(), 2000);
  }
}
