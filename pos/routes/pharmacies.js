const express = require('express');
const crypto = require('crypto');
const { admin } = require('../../src/firebase');
const { withPharmacyScope, withFirebaseUidScope } = require('../db');

const router = express.Router();

/**
 * POST /api/pos/pharmacies
 * Public signup — Body: { firebaseIdToken, pharmacyName, address, phone, ownerName }
 *
 * RLS note: a pharmacy row can only be inserted once app.current_pharmacy_id
 * already equals that row's id — but that id doesn't exist until the row
 * is inserted. Fixed here by generating the UUID in Node first, then
 * setting the RLS scope to that UUID before running any inserts, via
 * withPharmacyScope. Every insert in this transaction (pharmacy, roles,
 * role_permissions, staff) then satisfies its RLS policy from the start.
 */
router.post('/', async (req, res, next) => {
  const { firebaseIdToken, pharmacyName, address, phone, ownerName } = req.body;
  if (!firebaseIdToken || !pharmacyName || !ownerName) {
    return res.status(400).json({ error: 'firebaseIdToken, pharmacyName and ownerName are required' });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(firebaseIdToken);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // Uniqueness check uses the firebase-uid-scoped lookup, since
    // pharmacy_id isn't known yet — this only ever reveals THIS
    // caller's own staff row, never anyone else's.
    const existing = await withFirebaseUidScope(decoded.uid, async (client) => {
      const { rows } = await client.query('SELECT id FROM staff WHERE firebase_uid = $1', [decoded.uid]);
      return rows[0] || null;
    });
    if (existing) {
      return res.status(409).json({ error: 'This account is already linked to a pharmacy' });
    }

    const pharmacyId = crypto.randomUUID();
    const trialDays = 14;

    const result = await withPharmacyScope(pharmacyId, async (client) => {
      await client.query(
        `INSERT INTO pharmacies (id, name, address, phone, email, trial_ends_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`,
        [pharmacyId, pharmacyName, address || null, phone || null, decoded.email || null, trialDays]
      );

      const templates = await client.query(`SELECT id, name, is_system_role FROM roles WHERE pharmacy_id IS NULL`);

      let ownerRoleId = null;
      for (const template of templates.rows) {
        const newRole = await client.query(
          `INSERT INTO roles (pharmacy_id, name, is_system_role) VALUES ($1, $2, $3) RETURNING id`,
          [pharmacyId, template.name, template.is_system_role]
        );
        const newRoleId = newRole.rows[0].id;
        if (template.name === 'owner') ownerRoleId = newRoleId;

        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, permission_id FROM role_permissions WHERE role_id = $2`,
          [newRoleId, template.id]
        );
      }

      const staffResult = await client.query(
        `INSERT INTO staff (firebase_uid, pharmacy_id, role_id, name, email)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [decoded.uid, pharmacyId, ownerRoleId, ownerName, decoded.email || null]
      );

      return { pharmacyId, staffId: staffResult.rows[0].id };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;