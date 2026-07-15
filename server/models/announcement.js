import { query } from '../db.js';

const DEFAULT_EN = 'Welcome pilots! Host a match and share the link — fly together.';
const DEFAULT_FA = 'خلبان‌ها خوش آمدید! مسابقه بسازید و لینک را بفرستید — با هم پرواز کنید.';

export async function ensureAnnouncementRow() {
  await query(
    `INSERT INTO announcements (id, enabled, text_en, text_fa)
     VALUES (1, TRUE, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_EN, DEFAULT_FA]
  );
}

export function formatAnnouncement(row) {
  if (!row) return null;
  return {
    enabled: !!row.enabled,
    en: row.text_en || '',
    fa: row.text_fa || '',
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getAnnouncement() {
  const { rows } = await query(
    `SELECT enabled, text_en, text_fa, updated_at, updated_by FROM announcements WHERE id = 1`
  );
  return formatAnnouncement(rows[0]);
}

export async function upsertAnnouncement({ enabled, en, fa, updatedBy }) {
  const textEn = String(en ?? '').slice(0, 500);
  const textFa = String(fa ?? '').slice(0, 500);
  const on = !!enabled;

  const { rows } = await query(
    `INSERT INTO announcements (id, enabled, text_en, text_fa, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       text_en = EXCLUDED.text_en,
       text_fa = EXCLUDED.text_fa,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING enabled, text_en, text_fa, updated_at, updated_by`,
    [on, textEn, textFa, updatedBy || null]
  );
  return formatAnnouncement(rows[0]);
}
