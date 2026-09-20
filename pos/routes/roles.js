const express = require('express');
const { pool } = require('../db');
const { requireAuth, loadPermissions, requirePermission } = require('../authMiddleware');

const router = express.Router();
router.use(requireAuth, loadPermissions);

/**
 * GET /api/pos/roles/permissions-catalog
 * The full, platform-wide permission catalog (not pharmacy-scoped —
 * this table has no RLS, every pharmacy sees the same list). Used to
 * render the permission-matrix checklist grouped by category.
 * Registered BEFORE /:id so it isn't swallowed by that param route.
 */
router.get('/permissions-catalog', requirePermission('staff.manage_roles'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, key, category, description FROM permissions ORDER BY category, key`
    );
    res.json({ permissions: rows });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /api/pos/roles
 * Lists the calling pharmacy's roles (owner, manager, cashier, plus
 * any custom ones), for use in the invite-creation and staff
 * management screens.
 */
router.get('/', requirePermission('staff.invite'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);
    const { rows } = await client.query(
      `SELECT id, name, is_system_role FROM roles WHERE pharmacy_id = $1 ORDER BY name`,
      [req.staff.pharmacyId]
    );
    res.json({ roles: rows });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/pos/roles
 * Body: { name }
 * Creates a brand new custom role for this pharmacy, starting with
 * no permissions granted — the owner adds them via PUT afterward.
 */
router.post('/', requirePermission('staff.manage_roles'), async (req, res, next) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const result = await client.query(
      `INSERT INTO roles (pharmacy_id, name, is_system_role) VALUES ($1, $2, false) RETURNING id, name, is_system_role`,
      [req.staff.pharmacyId, name.trim()]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], permissionIds: [] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /api/pos/roles/:id
 * A single role plus the ids of every permission it currently grants.
 */
router.get('/:id', requirePermission('staff.manage_roles'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const roleResult = await client.query(
      `SELECT id, name, is_system_role FROM roles WHERE id = $1`,
      [req.params.id]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const permsResult = await client.query(
      `SELECT permission_id FROM role_permissions WHERE role_id = $1`,
      [req.params.id]
    );

    res.json({
      ...roleResult.rows[0],
      permissionIds: permsResult.rows.map((r) => r.permission_id),
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/**
 * PUT /api/pos/roles/:id
 * Body: { permissionIds: [...] }
 * Replaces this role's entire permission set with the given list.
 * The 'owner' role (is_system_role = true) can never be edited —
 * this protects an owner from accidentally locking themselves out of
 * their own pharmacy.
 */
router.put('/:id', requirePermission('staff.manage_roles'), async (req, res, next) => {
  const { permissionIds } = req.body;
  if (!Array.isArray(permissionIds)) {
    return res.status(400).json({ error: 'permissionIds must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const roleResult = await client.query(
      `SELECT id, is_system_role FROM roles WHERE id = $1`,
      [req.params.id]
    );
    if (roleResult.rows.length === 0) {
      throw Object.assign(new Error('Role not found'), { status: 404 });
    }
    if (roleResult.rows[0].is_system_role) {
      throw Object.assign(new Error('The owner role cannot be edited'), { status: 403 });
    }

    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [req.params.id]);

    for (const permissionId of permissionIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
        [req.params.id, permissionId]
      );
    }

    await client.query('COMMIT');
    res.json({ id: req.params.id, permissionIds });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;