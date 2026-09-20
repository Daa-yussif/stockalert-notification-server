const express = require('express');
const { pool } = require('../db');
const { requireAuth, loadPermissions, requirePermission } = require('../authMiddleware');

const router = express.Router();
router.use(requireAuth, loadPermissions);

router.get('/', requirePermission('inventory.view'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);
    const { rows } = await client.query(
      `SELECT id, supplier_id, name, barcode, quantity, low_stock_threshold,
              expiry_date, price, cost_price, version, updated_at
       FROM medicines WHERE is_deleted = false ORDER BY name`
    );
    const canViewCost = req.staff.permissions.includes('inventory.view_cost_price');
    res.json(rows.map((m) => (canViewCost ? m : { ...m, cost_price: undefined })));
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.get('/changes', requirePermission('inventory.view'), async (req, res, next) => {
  const since = req.query.since || '1970-01-01T00:00:00Z';
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);
    const { rows } = await client.query(
      `SELECT id, supplier_id, name, barcode, quantity, low_stock_threshold,
              expiry_date, price, is_deleted, version, updated_at
       FROM medicines WHERE updated_at > $1 ORDER BY updated_at`,
      [since]
    );
    res.json({ changes: rows, serverTime: new Date().toISOString() });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/pos/medicines
 * Body: { name, barcode?, quantity, lowStockThreshold?, expiryDate?, price, costPrice?, supplierId?, id? }
 *
 * `id` is optional — when a product is added OFFLINE, the app
 * generates the UUID client-side (matching the pattern used for
 * offline pharmacy creation and shift opening) so the local mirror
 * has a stable id immediately. ON CONFLICT makes this idempotent.
 */
router.post('/', requirePermission('inventory.edit_price'), async (req, res, next) => {
  const { name, barcode, quantity, lowStockThreshold, expiryDate, price, costPrice, supplierId, id } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    if (id) {
      const existing = await client.query(`SELECT id, version, updated_at FROM medicines WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return res.status(200).json({ alreadyApplied: true, ...existing.rows[0] });
      }
    }

    const { rows } = id
      ? await client.query(
          `INSERT INTO medicines
             (id, pharmacy_id, supplier_id, name, barcode, quantity, low_stock_threshold, expiry_date, price, cost_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, version, updated_at`,
          [id, req.staff.pharmacyId, supplierId || null, name, barcode || null,
           quantity || 0, lowStockThreshold || 10, expiryDate || null, price, costPrice || null]
        )
      : await client.query(
          `INSERT INTO medicines
             (pharmacy_id, supplier_id, name, barcode, quantity, low_stock_threshold, expiry_date, price, cost_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, version, updated_at`,
          [req.staff.pharmacyId, supplierId || null, name, barcode || null,
           quantity || 0, lowStockThreshold || 10, expiryDate || null, price, costPrice || null]
        );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A product with this barcode already exists' });
    }
    next(err);
  } finally {
    client.release();
  }
});

router.post('/:id/stock-movements', requirePermission('inventory.adjust_stock'), async (req, res, next) => {
  const { changeType, quantityDelta, note, clientOperationId, saleId, deviceId } = req.body;
  if (!changeType || quantityDelta === undefined || !clientOperationId) {
    return res.status(400).json({ error: 'changeType, quantityDelta and clientOperationId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const existing = await client.query(
      `SELECT id, resulting_quantity FROM stock_movements
       WHERE pharmacy_id = $1 AND client_operation_id = $2`,
      [req.staff.pharmacyId, clientOperationId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return res.status(200).json({ alreadyApplied: true, ...existing.rows[0] });
    }

    const medResult = await client.query(`SELECT quantity FROM medicines WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (medResult.rows.length === 0) {
      throw Object.assign(new Error('Medicine not found'), { status: 404 });
    }

    const newQuantity = medResult.rows[0].quantity + quantityDelta;
    if (newQuantity < 0) {
      throw Object.assign(new Error('Insufficient stock for this operation'), { status: 409 });
    }

    await client.query(
      `UPDATE medicines SET quantity = $1, version = version + 1, updated_at = now() WHERE id = $2`,
      [newQuantity, req.params.id]
    );

    const movement = await client.query(
      `INSERT INTO stock_movements
         (pharmacy_id, medicine_id, change_type, quantity_delta, resulting_quantity,
          staff_id, device_id, note, client_operation_id, sale_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, resulting_quantity`,
      [req.staff.pharmacyId, req.params.id, changeType, quantityDelta, newQuantity,
       req.staff.id, deviceId || null, note || null, clientOperationId, saleId || null]
    );

    await client.query('COMMIT');
    res.status(201).json(movement.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;