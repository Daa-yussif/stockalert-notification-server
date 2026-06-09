const express = require('express');
const { checkAllMedicines, checkSingleMedicine } = require('./medicineChecker');
const { sendNotification } = require('./notificationHelper');
const { db } = require('./firebase');

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'StockAlert Notification Server',
    time: new Date().toISOString(),
  });
});

// Manually trigger a full medicine check and send alerts
router.post('/check', async (req, res) => {
  try {
    await checkAllMedicines();
    res.json({ success: true, message: 'Medicine check completed' });
  } catch (err) {
    console.error('[API] Check error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send a custom notification to all devices
router.post('/notify', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  try {
    await sendNotification(title, body);
    res.json({ success: true, message: 'Notification sent' });
  } catch (err) {
    console.error('[API] Notify error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Register or update an FCM token
router.post('/token', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }
  try {
    await db.collection('fcm_tokens').doc(token).set({
      token,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Token registered' });
  } catch (err) {
    console.error('[API] Token error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all medicines with alert status
router.get('/medicines/alerts', async (req, res) => {
  try {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const snap = await db.collection('medicines').get();

    const result = { expired: [], nearExpiry: [], lowStock: [], ok: [] };

    snap.docs.forEach((doc) => {
      const m = { id: doc.id, ...doc.data() };
      const expiry = m.expiryDate?.toDate?.() ?? new Date(m.expiryDate);
      if (expiry < now) {
        result.expired.push(m.name);
      } else if (expiry < in30Days) {
        result.nearExpiry.push(m.name);
      } else if (m.quantity <= m.lowStockThreshold) {
        result.lowStock.push(m.name);
      } else {
        result.ok.push(m.name);
      }
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;