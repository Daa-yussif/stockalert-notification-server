const express = require('express');
const crypto = require('crypto');
const { admin } = require('../../src/firebase');
const { pool, withPharmacyScope, withInviteCodeScope } = require('../db');
const { requireAuth, loadPermissions, requirePermission } = require('../authMiddleware');

const router = express.Router();

router.post('/', requireAuth, loadPermissions, requirePermission('staff.invite'), async (req, res, next) => {
  const { roleId, email } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });

  try {
    const result = await withPharmacyScope(req.staff.pharmacyId, async (client) => {
      const roleCheck = await client.query('SELECT id FROM roles WHERE id = $1', [roleId]);
      if (roleCheck.rows.length === 0) {
        throw Object.assign(new Error('Role not found for this pharmacy'), { status: 400 });
      }

      const code = crypto.randomBytes(6).toString('hex');
      const expiresInDays = 7;

      const insertResult = await client.query(
        `INSERT INTO invites (pharmacy_id, code, role_id, email, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)
         RETURNING id, code, expires_at`,
        [req.staff.pharmacyId, code, roleId, email || null, expiresInDays, req.staff.id]
      );
      return insertResult.rows[0];
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /api/pos/invites/redeem
 * RLS note: the invite lookup by code runs BEFORE pharmacy_id is known,
 * so it uses withInviteCodeScope (matches only this invite's own code —
 * never reveals another pharmacy's invites). Once the invite's
 * pharmacy_id is known, the rest of the transaction re-scopes to it
 * via a second SET LOCAL on the same connection before inserting staff.
 */
router.post('/redeem', async (req, res, next) => {
  const { firebaseIdToken, code, name } = req.body;
  if (!firebaseIdToken || !code || !name) {
    return res.status(400).json({ error: 'firebaseIdToken, code and name are required' });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(firebaseIdToken);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_invite_code', $1, true)", [code]);

    const inviteResult = await client.query(
      `SELECT id, pharmacy_id, role_id, email, expires_at, redeemed_by, created_by
       FROM invites WHERE code = $1`,
      [code]
    );
    const invite = inviteResult.rows[0];

    if (!invite) throw Object.assign(new Error('Invalid invite code'), { status: 404 });
    if (invite.redeemed_by) throw Object.assign(new Error('This invite has already been used'), { status: 409 });
    if (new Date(invite.expires_at) < new Date()) throw Object.assign(new Error('This invite has expired'), { status: 410 });
    if (invite.email && invite.email.toLowerCase() !== (decoded.email || '').toLowerCase()) {
      throw Object.assign(new Error('This invite is restricted to a different email address'), { status: 403 });
    }

    // Now that we know the pharmacy_id, re-scope this same transaction
    // to it so the staff INSERT (and the staff table's RLS check)
    // succeeds.
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [invite.pharmacy_id]);
    await client.query("SELECT set_config('app.current_firebase_uid', $1, true)", [decoded.uid]);

    const existingStaff = await client.query('SELECT id FROM staff WHERE firebase_uid = $1', [decoded.uid]);
    if (existingStaff.rows.length > 0) {
      throw Object.assign(new Error('This account is already linked to a pharmacy'), { status: 409 });
    }

    const staffResult = await client.query(
      `INSERT INTO staff (firebase_uid, pharmacy_id, role_id, name, email, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [decoded.uid, invite.pharmacy_id, invite.role_id, name, decoded.email || null, invite.created_by]
    );

    await client.query(
      `UPDATE invites SET redeemed_by = $1, redeemed_at = now() WHERE id = $2`,
      [staffResult.rows[0].id, invite.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ pharmacyId: invite.pharmacy_id, staffId: staffResult.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;