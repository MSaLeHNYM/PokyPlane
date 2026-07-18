import { verifyAccessToken, getActiveSession, touchSession } from '../services/sessionManager.js';
import { findUserById, isIpBanned } from '../models/user.js';

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip;
}

export async function ipBanMiddleware(req, res, next) {
  try {
    const ip = getClientIp(req);
    if (await isIpBanned(ip)) {
      return res.status(403).json({ error: 'ip_banned', message: 'Your IP is banned.' });
    }
    req.clientIp = ip;
    next();
  } catch (e) {
    next(e);
  }
}

export async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing access token.' });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'token_expired', message: 'Access token invalid or expired.' });
    }

    const session = await getActiveSession(payload.sid, payload.sub);
    if (!session) {
      return res.status(401).json({
        error: 'session_revoked',
        message: 'Session ended — logged in elsewhere or kicked.',
      });
    }

    const user = await findUserById(payload.sub);
    if (!user || user.is_banned) {
      return res.status(403).json({ error: 'banned', message: 'Account banned or not found.' });
    }

    await touchSession(session.id);

    req.user = user;
    req.sessionId = session.id;
    req.auth = { userId: user.id, role: user.role, sessionId: session.id };
    next();
  } catch (e) {
    next(e);
  }
}

export function adminMiddleware(req, res, next) {
  if (req.auth?.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Admin only.' });
  }
  next();
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  authMiddleware(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;
    next();
  });
}
