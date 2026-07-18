import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { PROFILE_AVATARS, GENDERS, COUNTRIES } from '../config.js';
import { publicUser } from '../models/user.js';

const router = Router();

router.get('/meta', (_req, res) => {
  res.json({ avatars: PROFILE_AVATARS, genders: GENDERS, countries: COUNTRIES });
});

router.get('/profile', authMiddleware, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/profile', authMiddleware, async (req, res, next) => {
  try {
    const {
      displayName,
      profileAvatar,
      countryCode,
      gender,
      bio,
      settings,
    } = req.body || {};

    const avatarIds = PROFILE_AVATARS.map((a) => a.id);
    if (profileAvatar && !avatarIds.includes(profileAvatar)) {
      return res.status(400).json({ error: 'validation', message: 'Invalid avatar.' });
    }
    if (gender && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'validation', message: 'Invalid gender.' });
    }
    if (countryCode && !COUNTRIES.some((c) => c.code === countryCode)) {
      return res.status(400).json({ error: 'validation', message: 'Invalid country.' });
    }

    const { rows } = await query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         profile_avatar = COALESCE($3, profile_avatar),
         country_code = COALESCE($4, country_code),
         gender = COALESCE($5, gender),
         bio = COALESCE($6, bio),
         settings = COALESCE($7::jsonb, settings),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.user.id,
        displayName ?? null,
        profileAvatar ?? null,
        countryCode ?? null,
        gender ?? null,
        bio ?? null,
        settings ? JSON.stringify(settings) : null,
      ]
    );

    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

export default router;
