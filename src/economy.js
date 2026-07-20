/**
 * Client-side economy store: coins, ammo inventory, daily/wheel availability.
 * Server-authoritative; this module just caches state and notifies listeners.
 */
import { fetchEconomyState, onAuthChanged, isLoggedIn } from './api.js';

/** Ammo for guests (not logged in) — per-match, not persisted. */
export const GUEST_AMMO = { cannon: 60, rocket: 15, missile: 10 };

let state = null;
const listeners = new Set();

function emit() {
  for (const cb of listeners) {
    try {
      cb(state);
    } catch (e) {
      console.warn('[economy]', e);
    }
  }
}

export function getEconomyState() {
  return state;
}

/** Replace cached state (e.g. from a claim/spin/buy response). */
export function setEconomyState(next) {
  state = next || null;
  emit();
}

export function onEconomyChanged(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function refreshEconomy() {
  if (!isLoggedIn()) {
    state = null;
    emit();
    return null;
  }
  try {
    const data = await fetchEconomyState();
    state = data?.state || null;
  } catch (e) {
    console.warn('[economy] refresh failed', e);
  }
  emit();
  return state;
}

/** Ammo counts for WeaponSystem.setAmmo (guest fallback when logged out). */
export function ammoFromState(s = state) {
  if (!s) return { ...GUEST_AMMO };
  const inv = s.inventory || {};
  return {
    cannon: inv.ammo_cannon ?? 0,
    rocket: inv.ammo_rocket ?? 0,
    missile: inv.ammo_missile ?? 0,
  };
}

onAuthChanged(() => {
  refreshEconomy();
});
