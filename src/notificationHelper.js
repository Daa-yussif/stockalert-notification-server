const { messaging, db } = require('./firebase');

/**
 * Fetch all valid FCM tokens from Firestore
 */
async function getTokens() {
  const snap = await db.collection('fcm_tokens').get();
  return snap.docs.map((d) => d.data().token).filter(Boolean);
}

/**
 * Remove invalid/expired tokens from Firestore
 */
async function removeInvalidTokens(tokens) {
  if (tokens.length === 0) return;
  const batch = db.batch();
  tokens.forEach((token) => {
    batch.delete(db.collection('fcm_tokens').doc(token));
  });
  await batch.commit();
  console.log(`[FCM] Removed ${tokens.length} invalid token(s)`);
}

/**
 * Send a multicast notification to all registered devices
 */
async function sendNotification(title, body, data = {}) {
  const tokens = await getTokens();
  if (tokens.length === 0) {
    console.log('[FCM] No tokens found — skipping notification');
    return;
  }

  const message = {
    notification: { title, body },
    data,
    android: {
      notification: {
        channelId: 'stockalert_alerts',
        priority: 'high',
        sound: 'default',
        icon: 'ic_launcher',
      },
    },
    tokens,
  };

  const response = await messaging.sendEachForMulticast(message);
  console.log(`[FCM] Sent: ${response.successCount} success, ${response.failureCount} failed`);

  // Clean up invalid tokens
  const invalid = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const code = resp.error?.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalid.push(tokens[idx]);
      }
    }
  });
  if (invalid.length > 0) await removeInvalidTokens(invalid);
}

module.exports = { sendNotification, getTokens };