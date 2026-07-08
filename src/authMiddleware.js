const { admin, db } = require('./firebase');

/**
 * Verifies the Firebase ID token sent in the Authorization header.
 * Attaches the verified uid to req.uid so routes can trust it.
 */
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.uid = decodedToken.uid;
    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Resolves the pharmacy DATA OWNER's uid for a given logged-in uid.
 * - If the uid belongs to an owner, returns it unchanged.
 * - If the uid belongs to a staff/cashier account (has a staff_access
 *   mapping doc), returns the owner's uid instead — so staff requests
 *   always operate on the owner's data, never their own empty account.
 */
async function resolveOwnerUid(uid) {
  try {
    const staffDoc = await db.collection('staff_access').doc(uid).get();
    if (staffDoc.exists) {
      const data = staffDoc.data();
      return data.ownerUid || uid;
    }
    return uid;
  } catch (err) {
    console.error('[Auth] resolveOwnerUid failed, falling back to raw uid:', err.message);
    return uid;
  }
}

/**
 * Whether a given uid is itself a staff/cashier account
 * (used to block staff from creating further staff).
 */
async function isStaffAccount(uid) {
  const staffDoc = await db.collection('staff_access').doc(uid).get();
  return staffDoc.exists;
}

module.exports = { verifyAuth, resolveOwnerUid, isStaffAccount };