// Reuses the SAME initialized admin app from your existing firebase.js —
// does NOT call admin.initializeApp() again. Your existing authMiddleware.js
// (verifyAuth) stays exactly as it is and keeps powering /api/token,
// /api/ai-chat, and /api/medicines/alerts. This file is only for the
// new Postgres-backed /api/pos/* routes, which need pharmacy_id and
// role/permission context that verifyAuth doesn't provide.
const { admin } = require('../src/firebase');
const { withFirebaseUidScope, withoutScope } = require('./db');

/**
 * Verifies the Firebase ID token, then looks up which pharmacy + role
 * that UID belongs to in Postgres. Attaches req.staff:
 *   { id, firebaseUid, pharmacyId, roleId }
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const staff = await withFirebaseUidScope(decoded.uid, async (client) => {
      const { rows } = await client.query(
        `SELECT id, firebase_uid, pharmacy_id, role_id, is_active
         FROM staff WHERE firebase_uid = $1`,
        [decoded.uid]
      );
      return rows[0] || null;
    });

    if (!staff) {
      return res.status(403).json({ error: 'No pharmacy membership found for this account' });
    }
    if (!staff.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    req.staff = {
      id: staff.id,
      firebaseUid: staff.firebase_uid,
      pharmacyId: staff.pharmacy_id,
      roleId: staff.role_id,
    };
    req.firebaseDecoded = decoded; // handy if a route needs email etc.
    next();
  } catch (err) {
    next(err);
  }
}

/** Loads req.staff.permissions (array of permission keys). Run after requireAuth. */
async function loadPermissions(req, res, next) {
  try {
    const permissions = await withoutScope(async (client) => {
      const { rows } = await client.query(
        `SELECT p.key FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1`,
        [req.staff.roleId]
      );
      return rows.map((r) => r.key);
    });
    req.staff.permissions = permissions;
    next();
  } catch (err) {
    next(err);
  }
}

function requirePermission(key) {
  return (req, res, next) => {
    if (!req.staff.permissions.includes(key)) {
      return res.status(403).json({ error: `Missing permission: ${key}` });
    }
    next();
  };
}

module.exports = { requireAuth, loadPermissions, requirePermission };