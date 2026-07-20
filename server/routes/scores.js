import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import { COUNTRIES, PROFILE_AVATARS } from '../config.js';
import { awardMatchCoins, spendAmmo } from '../models/economy.js';

const router = Router();

function countryFlag(code) {
  return COUNTRIES.find((c) => c.code === code)?.flag || '🏳️';
}

function avatarMeta(id) {
  return PROFILE_AVATARS.find((a) => a.id === id) || PROFILE_AVATARS[0];
}

router.post('/submit', authMiddleware, async (req, res, next) => {
  try {
    const { mode, score, mapId, flightTimeSec, metadata } = req.body || {};
    if (!mode || score == null) {
      return res.status(400).json({ error: 'validation', message: 'mode and score required.' });
    }

    const { rows } = await query(
      `INSERT INTO scores (user_id, mode, score, map_id, flight_time_sec, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.auth.userId,
        mode,
        Math.max(0, Math.floor(Number(score))),
        mapId || null,
        flightTimeSec ?? null,
        JSON.stringify(metadata || {}),
      ]
    );

    // Economy: reconcile ammo spent during the match, then award coins.
    let coinsEarned = 0;
    try {
      const ammoUsed = metadata?.ammoUsed;
      if (ammoUsed && typeof ammoUsed === 'object') {
        await spendAmmo(req.auth.userId, ammoUsed);
      }
      coinsEarned = await awardMatchCoins(req.auth.userId, mode, score, flightTimeSec);
    } catch (econErr) {
      console.error('[scores] economy update failed', econErr);
    }

    res.status(201).json({ score: rows[0], coinsEarned });
  } catch (e) {
    next(e);
  }
});

router.get('/leaderboard', optionalAuth, async (req, res, next) => {
  try {
    const mode = req.query.mode || 'all';
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));

    const params = [limit];
    let sql = `
      SELECT u.id AS user_id, u.username, u.display_name, u.profile_avatar, u.country_code,
             MAX(s.score) AS best_score,
             MAX(s.created_at) AS last_played`;

    if (mode !== 'all') {
      params.push(mode);
      sql += `, s.mode FROM scores s
         JOIN users u ON u.id = s.user_id
         WHERE u.is_banned = FALSE AND s.mode = $2
         GROUP BY u.id, u.username, u.display_name, u.profile_avatar, u.country_code, s.mode
         ORDER BY best_score DESC LIMIT $1`;
    } else {
      sql += ` FROM scores s
         JOIN users u ON u.id = s.user_id
         WHERE u.is_banned = FALSE
         GROUP BY u.id, u.username, u.display_name, u.profile_avatar, u.country_code
         ORDER BY best_score DESC LIMIT $1`;
    }

    const { rows } = await query(sql, params);

    const leaderboard = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      profileAvatar: r.profile_avatar,
      avatar: avatarMeta(r.profile_avatar),
      countryCode: r.country_code,
      countryFlag: countryFlag(r.country_code),
      bestScore: r.best_score,
      mode: mode === 'all' ? 'all' : r.mode,
      lastPlayed: r.last_played,
    }));

    res.json({ mode, leaderboard });
  } catch (e) {
    next(e);
  }
});

router.get('/my-best', authMiddleware, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT mode, MAX(score) AS best_score, MAX(created_at) AS last_played
       FROM scores WHERE user_id = $1 GROUP BY mode`,
      [req.auth.userId]
    );
    res.json({ bests: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
