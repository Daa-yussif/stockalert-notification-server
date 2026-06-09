const { db } = require('./firebase');
const { sendNotification } = require('./notificationHelper');

/**
 * Check all medicines and send alerts for expired, near expiry, low stock
 * Called by cron job (daily) and Firestore listener (real-time)
 */
async function checkAllMedicines() {
  console.log('[Checker] Running full medicine check...');
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const snap = await db.collection('medicines').get();
  const medicines = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const expired = [];
  const nearExpiry = [];
  const lowStock = [];

  medicines.forEach((m) => {
    const expiry = m.expiryDate?.toDate?.() ?? new Date(m.expiryDate);
    if (expiry < now) {
      expired.push(m.name);
    } else if (expiry < in30Days) {
      nearExpiry.push(`${m.name} (${Math.floor((expiry - now) / 86400000)}d)`);
    }
    if (m.quantity <= m.lowStockThreshold && expiry >= now) {
      lowStock.push(`${m.name} (${m.quantity} left)`);
    }
  });

  const alerts = [];
  if (expired.length > 0) {
    alerts.push(`🔴 Expired (${expired.length}): ${expired.slice(0, 3).join(', ')}${expired.length > 3 ? '...' : ''}`);
  }
  if (nearExpiry.length > 0) {
    alerts.push(`🟡 Near Expiry (${nearExpiry.length}): ${nearExpiry.slice(0, 3).join(', ')}${nearExpiry.length > 3 ? '...' : ''}`);
  }
  if (lowStock.length > 0) {
    alerts.push(`🟠 Low Stock (${lowStock.length}): ${lowStock.slice(0, 3).join(', ')}${lowStock.length > 3 ? '...' : ''}`);
  }

  if (alerts.length === 0) {
    console.log('[Checker] All medicines OK — no alerts');
    return;
  }

  await sendNotification(
    'StockAlert — Daily Report',
    alerts.join(' | '),
    { type: 'daily_report' }
  );
  console.log('[Checker] Daily report sent:', alerts);
}

/**
 * Check a single medicine and send instant alert if needed
 * Called when Firestore detects a change
 */
async function checkSingleMedicine(medicine) {
  const now = new Date();
  const expiry = medicine.expiryDate?.toDate?.() ?? new Date(medicine.expiryDate);
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

  await sendNotification(title, body, { type, medicineId: medicine.id ?? '' });
  console.log(`[Checker] Alert sent for ${medicine.name}: ${type}`);
}

module.exports = { checkAllMedicines, checkSingleMedicine };