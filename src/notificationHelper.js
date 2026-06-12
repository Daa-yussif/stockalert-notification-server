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
 * Send a multicast notification to all registered devices.
 * Never throws — logs and returns instead, so a notification failure
 * never crashes the Firestore listener / cron jobs.
 */
async function sendNotification(title, body, data = {}) {
  let tokens;
  try {
    tokens = await getTokens();
  } catch (err) {
    console.error('[FCM] Failed to fetch tokens:', err.message);
    return;
  }

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

  let response;
  try {
    response = await messaging.sendEachForMulticast(message);
  } catch (err) {
    console.error('[FCM] sendEachForMulticast failed:', err.message);
    return;
  }

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

  if (invalid.length > 0) {
    try {
      await removeInvalidTokens(invalid);
    } catch (err) {
      console.error('[FCM] Failed to remove invalid tokens:', err.message);
    }
  }
}

module.exports = { sendNotification, getTokens };