const { admin } = require('./firebase');

/**
 * Verifies the Firebase ID token sent in the Authorization header.
 * Attaches the verified uid to req.uid so routes can trust it.
 *
 * Usage: app.post('/api/ai-chat', verifyAuth, aiChatHandler);
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

module.exports = { verifyAuth };