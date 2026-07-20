import { query, withTransaction } from '../db.js';

export const AMMO_KEYS = ['ammo_cannon', 'ammo_rocket', 'ammo_missile'];
export const ITEM_KEYS = [...AMMO_KEYS, 'wheel_spin'];

/** Granted once when a wallet row is first created. */
export const STARTER_PACK = {
  coins: 200,
  items: { ammo_cannon: 150, ammo_rocket: 40, ammo_missile: 24 },
};

export const DAILY_REWARD = {
  coins: 150,
  items: { ammo_cannon: 40, ammo_rocket: 10, ammo_missile: 6 },
};

/**
 * Wheel of Luck segments. `weight` drives the server-side draw;
 * the index is returned so the client can animate to the segment.
 */
export const WHEEL_SEGMENTS = [
  { id: 'coins_50', weight: 20, coins: 50 },
  { id: 'cannon_30', weight: 16, items: { ammo_cannon: 30 } },
  { id: 'coins_150', weight: 14, coins: 150 },
  { id: 'rocket_8', weight: 14, items: { ammo_rocket: 8 } },
  { id: 'missile_5', weight: 12, items: { ammo_missile: 5 } },
  { id: 'coins_300', weight: 10, coins: 300 },
  { id: 'bonus_spin', weight: 8, items: { wheel_spin: 1 } },
  { id: 'jackpot_1000', weight: 2, coins: 1000 },
];

export const MARKET_CATALOG = [
  { id: 'cannon_pack', price: 200, items: { ammo_cannon: 50 } },
  { id: 'rocket_pack', price: 250, items: { ammo_rocket: 10 } },
  { id: 'missile_pack', price: 300, items: { ammo_missile: 6 } },
  { id: 'spin_1', price: 400, items: { wheel_spin: 1 } },
  { id: 'spin_3', price: 1000, items: { wheel_spin: 3 } },
];

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function logEconomy(client, userId, delta, reason, actor = null) {
  await client.query(
    `INSERT INTO economy_log (user_id, delta, reason, actor)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [userId, JSON.stringify(delta || {}), String(reason).slice(0, 48), actor]
  );
}

async function applyDelta(client, userId, { coins = 0, items = {} }, reason, actor = null) {
  if (coins) {
    if (coins > 0) {
      await client.query(
        `INSERT INTO user_wallets (user_id, coins) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET coins = user_wallets.coins + EXCLUDED.coins, updated_at = NOW()`,
        [userId, coins]
      );
    } else {
      const { rowCount } = await client.query(
        `UPDATE user_wallets SET coins = coins + $2, updated_at = NOW()
         WHERE user_id = $1 AND coins + $2 >= 0`,
        [userId, coins]
      );
      if (!rowCount) throw httpError(400, 'insufficient_coins', 'Not enough coins.');
    }
  }
  for (const [key, qty] of Object.entries(items || {})) {
    const n = Math.trunc(Number(qty) || 0);
    if (!n || !ITEM_KEYS.includes(key)) continue;
    if (n > 0) {
      await client.query(
        `INSERT INTO user_inventory (user_id, item_key, qty) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_key) DO UPDATE
         SET qty = user_inventory.qty + EXCLUDED.qty, updated_at = NOW()`,
        [userId, key, n]
      );
    } else {
      // Clamp at zero (used for ammo reconcile after a match).
      await client.query(
        `INSERT INTO user_inventory (user_id, item_key, qty) VALUES ($1, $2, 0)
         ON CONFLICT (user_id, item_key) DO UPDATE
         SET qty = GREATEST(0, user_inventory.qty + $3), updated_at = NOW()`,
        [userId, key, n]
      );
    }
  }
  await logEconomy(client, userId, { coins, items }, reason, actor);
}

/** Creates the wallet row and grants the starter pack on first touch. */
async function ensureWallet(client, userId) {
  const { rowCount } = await client.query(
    `INSERT INTO user_wallets (user_id, coins) VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  if (rowCount) {
    await applyDelta(client, userId, STARTER_PACK, 'starter');
  }
}

export async function getState(userId) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const { rows: walletRows } = await client.query(
      `SELECT coins FROM user_wallets WHERE user_id = $1`,
      [userId]
    );
    const { rows: invRows } = await client.query(
      `SELECT item_key, qty FROM user_inventory WHERE user_id = $1`,
      [userId]
    );
    const { rows: claimRows } = await client.query(
      `SELECT kind FROM daily_claims
       WHERE user_id = $1 AND day = (NOW() AT TIME ZONE 'utc')::date`,
      [userId]
    );
    const inventory = {};
    for (const key of ITEM_KEYS) inventory[key] = 0;
    for (const r of invRows) inventory[r.item_key] = r.qty;
    const claimed = new Set(claimRows.map((r) => r.kind));
    return {
      coins: Number(walletRows[0]?.coins || 0),
      inventory,
      dailyRewardAvailable: !claimed.has('reward'),
      wheelFreeAvailable: !claimed.has('wheel_free'),
      wheelSpins: inventory.wheel_spin || 0,
      dailyReward: DAILY_REWARD,
      wheelSegments: WHEEL_SEGMENTS.map(({ id, coins, items }) => ({ id, coins, items })),
      market: MARKET_CATALOG,
      serverDay: new Date().toISOString().slice(0, 10),
    };
  });
}

async function claimDay(client, userId, kind) {
  const { rowCount } = await client.query(
    `INSERT INTO daily_claims (user_id, day, kind)
     VALUES ($1, (NOW() AT TIME ZONE 'utc')::date, $2)
     ON CONFLICT DO NOTHING`,
    [userId, kind]
  );
  return rowCount > 0;
}

export async function claimDaily(userId) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    const ok = await claimDay(client, userId, 'reward');
    if (!ok) throw httpError(409, 'already_claimed', 'Daily reward already claimed today.');
    await applyDelta(client, userId, DAILY_REWARD, 'daily_reward');
    return { reward: DAILY_REWARD };
  });
}

function drawWheelSegment() {
  const total = WHEEL_SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i += 1) {
    roll -= WHEEL_SEGMENTS[i].weight;
    if (roll <= 0) return i;
  }
  return WHEEL_SEGMENTS.length - 1;
}

export async function spinWheel(userId) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    let usedFree = await claimDay(client, userId, 'wheel_free');
    if (!usedFree) {
      const { rowCount } = await client.query(
        `UPDATE user_inventory SET qty = qty - 1, updated_at = NOW()
         WHERE user_id = $1 AND item_key = 'wheel_spin' AND qty > 0`,
        [userId]
      );
      if (!rowCount) throw httpError(409, 'no_spins', 'No wheel spins left today.');
    }
    const segmentIndex = drawWheelSegment();
    const seg = WHEEL_SEGMENTS[segmentIndex];
    const prize = { coins: seg.coins || 0, items: seg.items || {} };
    await applyDelta(client, userId, prize, usedFree ? 'wheel_free' : 'wheel_paid');
    return { segmentIndex, segmentId: seg.id, prize, usedFree };
  });
}

export async function buyMarketItem(userId, itemId) {
  const entry = MARKET_CATALOG.find((m) => m.id === itemId);
  if (!entry) throw httpError(400, 'validation', 'Unknown market item.');
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await applyDelta(
      client,
      userId,
      { coins: -entry.price, items: entry.items },
      `market_${entry.id}`
    );
    return { item: entry };
  });
}

/** Reconcile ammo used during a match (clamped at zero). */
export async function spendAmmo(userId, used = {}) {
  const items = {};
  const map = { cannon: 'ammo_cannon', rocket: 'ammo_rocket', missile: 'ammo_missile' };
  for (const [k, itemKey] of Object.entries(map)) {
    const n = Math.min(10000, Math.max(0, Math.trunc(Number(used[k]) || 0)));
    if (n > 0) items[itemKey] = -n;
  }
  if (!Object.keys(items).length) return;
  await withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await applyDelta(client, userId, { items }, 'match_spend');
  });
}

/** Coins earned for a submitted match result. */
export function coinsForMatch(mode, score, flightTimeSec) {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  const time = Math.max(0, Number(flightTimeSec) || 0);
  let coins = Math.min(60, Math.floor(time / 30) * 5); // up to 60 for airtime
  if (mode === 'combat') coins += Math.min(240, Math.floor(s / 50) * 10);
  else if (mode === 'multiplayer') coins += Math.min(300, s * 25); // score = kills
  else if (mode === 'race') coins += Math.min(200, Math.floor(s / 100) * 10);
  else coins += Math.min(40, Math.floor(s / 60) * 5);
  return coins;
}

export async function awardMatchCoins(userId, mode, score, flightTimeSec) {
  const coins = coinsForMatch(mode, score, flightTimeSec);
  if (coins <= 0) return 0;
  await withTransaction(async (client) => {
    await ensureWallet(client, userId);
    await applyDelta(client, userId, { coins }, `match_${String(mode).slice(0, 24)}`);
  });
  return coins;
}

/** Admin grant to a list of user ids (or all active users when userIds is null). */
export async function grantToUsers({ userIds = null, coins = 0, items = {}, actor = null }) {
  const grant = { coins: Math.max(0, Math.trunc(Number(coins) || 0)), items: {} };
  for (const [key, qty] of Object.entries(items || {})) {
    const n = Math.max(0, Math.trunc(Number(qty) || 0));
    if (n > 0 && ITEM_KEYS.includes(key)) grant.items[key] = n;
  }
  if (!grant.coins && !Object.keys(grant.items).length) {
    throw httpError(400, 'validation', 'Nothing to grant.');
  }
  let targets = userIds;
  if (!targets) {
    const { rows } = await query(`SELECT id FROM users WHERE is_banned = FALSE`);
    targets = rows.map((r) => r.id);
  }
  let granted = 0;
  for (const userId of targets) {
    try {
      await withTransaction(async (client) => {
        await ensureWallet(client, userId);
        await applyDelta(client, userId, grant, 'admin_grant', actor);
      });
      granted += 1;
    } catch {
      // Skip unknown/deleted user ids without aborting the whole grant.
    }
  }
  return { granted, grant };
}
