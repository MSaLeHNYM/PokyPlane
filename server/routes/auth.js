import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  createSession,
  signAccessToken,
  validateRefreshSession,
  revokeSession,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshFromCookie,
} from '../services/sessionManager.js';
import {
  findUserByEmail,
  findUserByUsername,
  createUser,
  publicUser,
  logSecurityEvent,
  upsertPresence,
  setPresenceOffline,
} from '../models/user.js';
import { authMiddleware, getClientIp } from '../middleware/auth.js';

const router = Router();

function requireDeviceFingerprint(req, res) {
  const fp = req.body?.deviceFingerprint || req.headers['x-device-fingerprint'];
  if (!fp || String(fp).length < 8) {
    res.status(400).json({ error: 'device_required', message: 'Device fingerprint required.' });
    return null;
  }
  return String(fp);
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, username, password, displayName } = req.body || {};
    const deviceFingerprint = requireDeviceFingerprint(req, res);
    if (!deviceFingerprint) return;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'validation', message: 'Email, username and password required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'validation', message: 'Password must be at least 8 characters.' });
    }
    if (!/^[a-z0-9_]{3,32}$/.test(String(username).toLowerCase())) {
      return res.status(400).json({
        error: 'validation',
        message: 'Username: 3–32 chars, lowercase letters, numbers, underscore.',
      });
    }

    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'email_taken', message: 'Email already registered.' });
    }
    if (await findUserByUsername(username)) {
      return res.status(409).json({ error: 'username_taken', message: 'Username taken.' });
    }

    const user = await createUser({ email, username, password, displayName });
    const ip = getClientIp(req);
    const { sessionId, refreshToken } = await createSession({
      userId: user.id,
      deviceFingerprint,
      userAgent: req.headers['user-agent'],
      ipAddress: ip,
    });

    const accessToken = signAccessToken(user, sessionId);
    setRefreshCookie(res, refreshToken);
    await logSecurityEvent('register', { userId: user.id, ip, details: { username } });
    await upsertPresence(user.id, sessionId, {
      status: 'online',
      ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const deviceFingerprint = requireDeviceFingerprint(req, res);
    if (!deviceFingerprint) return;

    if (!email || !password) {
      return res.status(400).json({ error: 'validation', message: 'Email and password required.' });
    }

    const user = await findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await logSecurityEvent('login_failed', { ip: getClientIp(req), details: { email } });
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: 'banned', message: user.ban_reason || 'Account banned.' });
    }

    const ip = getClientIp(req);
    const { sessionId, refreshToken } = await createSession({
      userId: user.id,
      deviceFingerprint,
      userAgent: req.headers['user-agent'],
      ipAddress: ip,
      reason: 'login',
    });

    const accessToken = signAccessToken(user, sessionId);
    setRefreshCookie(res, refreshToken);
    await logSecurityEvent('login', { userId: user.id, ip });
    await upsertPresence(user.id, sessionId, {
      status: 'online',
      ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      accessToken,
      user: publicUser(user),
      message: 'Other sessions were signed out (one device/browser policy).',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = getRefreshFromCookie(req);
    if (!refreshToken) {
      return res.status(401).json({ error: 'no_refresh', message: 'No refresh token.' });
    }

    const row = await validateRefreshSession(refreshToken);
    if (!row) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'session_revoked', message: 'Session invalid.' });
    }

    const user = {
      id: row.user_id,
      role: row.role,
      username: row.username,
      email: row.email,
    };
    const accessToken = signAccessToken(user, row.id);
    res.json({ accessToken });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    await revokeSession(req.sessionId, 'logout');
    await setPresenceOffline(req.user.id);
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
