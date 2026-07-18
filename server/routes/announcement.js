import { Router } from 'express';
import { getAnnouncement } from '../models/announcement.js';

const router = Router();

/** Public — game client reads the global banner. */
router.get('/', async (_req, res, next) => {
  try {
    const announcement = await getAnnouncement();
    res.json({ announcement: announcement || { enabled: false, en: '', fa: '' } });
  } catch (e) {
    next(e);
  }
});

export default router;
