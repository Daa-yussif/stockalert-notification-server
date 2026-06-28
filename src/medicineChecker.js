const { db } = require('./firebase');
const { sendNotification } = require('./notificationHelper');

/**
 * Check all medicines across ALL users and send alerts.
 * Firestore structure: users/{uid}/medicines/{medicineId}
 * FCM tokens structure: users/{uid}/fcm_tokens/{token}
 */
async function checkAllMedicines() {
  console.log('[Checker] Running full medicine check across all users...');
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Get all users
  const usersSnap = await db.collection('users').get();

  if (usersSnap.empty) {
    console.log('[Checker] No users found — skipping');
    return;
  }

  // Process each user separately
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    try {
      // Get this user's medicines
      const medSnap = await db
        .collection('users')
        .doc(uid)
        .collection('medicines')
        .get();

      if (medSnap.empty) continue;

      const medicines = medSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const expired = [];
      const nearExpiry = [];
      const lowStock = [];

      medicines.forEach((m) => {
        const expiry = m.expiryDate?.toDate?.() ?? new Date(m.expiryDate);
        if (expiry < now) {
          expired.push(m.name);
        } else if (expiry < in30Days) {
          nearExpiry.push(
            `${m.name} (${Math.floor((expiry - now) / 86400000)}d)`
          );
        }
        if (m.quantity <= m.lowStockThreshold && expiry >= now) {
          lowStock.push(`${m.name} (${m.quantity} left)`);
        }
      });

      const alerts = [];
      if (expired.length > 0) {
        alerts.push(
          `🔴 Expired (${expired.length}): ${expired.slice(0, 3).join(', ')}${expired.length > 3 ? '...' : ''}`
        );
      }
      if (nearExpiry.length > 0) {
        alerts.push(
          `🟡 Near Expiry (${nearExpiry.length}): ${nearExpiry.slice(0, 3).join(', ')}${nearExpiry.length > 3 ? '...' : ''}`
        );
      }
      if (lowStock.length > 0) {
        alerts.push(
          `🟠 Low Stock (${lowStock.length}): ${lowStock.slice(0, 3).join(', ')}${lowStock.length > 3 ? '...' : ''}`
        );
      }

      if (alerts.length === 0) {
        console.log(`[Checker] User ${uid} — all medicines OK`);
        continue;
      }

      // Get this user's FCM tokens
      const tokenSnap = await db
        .collection('users')
        .doc(uid)
        .collection('fcm_tokens')
        .get();

      const tokens = tokenSnap.docs
        .map((d) => d.data().token)
        .filter(Boolean);

      if (tokens.length === 0) {
        console.log(`[Checker] User ${uid} — no tokens, skipping notification`);
        continue;
      }

      await sendNotificationToTokens(
        tokens,
        'StockAlert — Daily Report',
        alerts.join(' | '),
        { type: 'daily_report', uid }
      );

      console.log(`[Checker] User ${uid} — report sent:`, alerts);
    } catch (err) {
      console.error(`[Checker] Error processing user ${uid}:`, err.message);
    }
  }

  console.log('[Checker] Full check complete');
}

/**
 * Check a single medicine and send instant alert if needed.
 * Called by Firestore listener on real-time changes.
 */
async function checkSingleMedicine(medicine, uid) {
  const now = new Date();
  const expiry =
    medicine.expiryDate?.toDate?.() ?? new Date(medicine.expiryDate);
  const daysToExpiry = Math.floor((expiry - now) / 86400000);

  let title = null;
  let body = null;
  let type = null;

  if (expiry < now) {
    title = '⚠️ Expired Medicine';
    body = `${medicine.name} has expired. Remove from shelf immediately.`;
    type = 'expired';
  } else if (daysToExpiry <= 30) {
    title = '🕐 Near Expiry Alert';
    body = `${medicine.name} expires in ${daysToExpiry} day(s). Take action now.`;
    type = 'near_expiry';
  } else if (medicine.quantity <= medicine.lowStockThreshold) {
    title = '📦 Low Stock Alert';
    body = `${medicine.name} has only ${medicine.quantity} unit(s) left. Reorder soon.`;
    type = 'low_stock';
  }

  if (!title) return;

  // Get this user's tokens only
  const tokenSnap = await db
    .collection('users')
    .doc(uid)
    .collection('fcm_tokens')
    .get();

  const tokens = tokenSnap.docs.map((d) => d.data().token).filter(Boolean);

  if (tokens.length === 0) return;

  await sendNotificationToTokens(tokens, title, body, {
    type,
    medicineId: medicine.id ?? '',
    uid,
  });

  console.log(`[Checker] Alert sent for ${medicine.name}: ${type}`);
}

/**
 * Send notification to a specific list of tokens
 */
const { messaging } = require('./firebase');

async function sendNotificationToTokens(tokens, title, body, data = {}) {
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

  try {
    const response = await messaging.sendEachForMulticast(message);
    console.log(
      `[FCM] Sent: ${response.successCount} success, ${response.failureCount} failed`
    );

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
      console.log(`[FCM] Removing ${invalid.length} invalid token(s)`);
    }
  } catch (err) {
    console.error('[FCM] sendEachForMulticast failed:', err.message);
  }
}

module.exports = { checkAllMedicines, checkSingleMedicine };