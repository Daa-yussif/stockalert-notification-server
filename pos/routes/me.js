const express = require('express');
const { pool } = require('../db');
const { requireAuth, loadPermissions } = require('../authMiddleware');

const router = express.Router();

/**
 * GET /api/pos/me
 * The first call the Flutter app makes right after Firebase login.
 * Returns pharmacy + role + permissions so AuthService can decide
 * what the UI should show and what the local device should cache
 * for offline permission checks.
 */
router.get('/', requireAuth, loadPermissions, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const staffResult = await client.query(
      `SELECT s.id, s.name, s.email, r.id AS role_id, r.name AS role_name,
              p.id AS pharmacy_id, p.name AS pharmacy_name, p.plan, p.subscription_status,
              p.currency, p.tax_rate
       FROM staff s
       JOIN roles r ON r.id = s.role_id
       JOIN pharmacies p ON p.id = s.pharmacy_id
       WHERE s.id = $1`,
      [req.staff.id]
    );

    if (staffResult.rows.length === 0) {
      throw Object.assign(new Error('Staff record not found'), { status: 404 });
    }

    const row = staffResult.rows[0];
    res.json({
      staffId: row.id,
      name: row.name,
      email: row.email,
      role: { id: row.role_id, name: row.role_name },
      permissions: req.staff.permissions,
      pharmacy: {
        id: row.pharmacy_id,
        name: row.pharmacy_name,
        plan: row.plan,
        subscriptionStatus: row.subscription_status,
        currency: row.currency,
        taxRate: row.tax_rate,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;