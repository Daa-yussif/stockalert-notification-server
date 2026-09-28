const express = require('express');
const { pool } = require('../db');
const { requireAuth, loadPermissions } = require('../authMiddleware');

const router = express.Router();
router.use(requireAuth, loadPermissions);

/**
 * POST /api/pos/devices
 * Body: { id?, name, platform }
 *
 * Registers this physical device (a tablet/phone at the register) so
 * sales, stock movements, and shifts can be attributed to it, and so
 * the plan's device limit (enforced by a DB trigger, see migration
 * 004) actually has something to count against.
 *
 * `id` is optional — the app generates a stable UUID on first launch
 * and reuses it forever, so this is idempotent: registering the same
 * id twice just returns the existing row rather than erroring or
 * creating a duplicate (and, more importantly, never double-counts
 * against the plan's device limit).
 */
router.post('/', async (req, res, next) => {
  const { id, name, platform } = req.body;
  if (!name || !platform) {
    return res.status(400).json({ error: 'name and platform are required' });
  }
  if (!['android', 'ios', 'web'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be android, ios, or web' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    if (id) {
      const existing = await client.query(`SELECT id, name FROM devices WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return res.status(200).json({ alreadyApplied: true, ...existing.rows[0] });
      }
    }

    const result = id
      ? await client.query(
          `INSERT INTO devices (id, pharmacy_id, name, platform, registered_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
          [id, req.staff.pharmacyId, name, platform, req.staff.id]
        )
      : await client.query(
          `INSERT INTO devices (pharmacy_id, name, platform, registered_by)
           VALUES ($1, $2, $3, $4) RETURNING id, name`,
          [req.staff.pharmacyId, name, platform, req.staff.id]
        );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    // The device-limit trigger (migration 004) raises a plain
    // exception, not a Postgres constraint code — surface it as a
    // clean 403 rather than a generic 500.
    if (err.message && err.message.includes('Device limit')) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;