const express = require('express');
const { pool } = require('../db');
const { requireAuth, loadPermissions, requirePermission } = require('../authMiddleware');

const router = express.Router();
router.use(requireAuth, loadPermissions);

// ============================================================
// Shifts
// ============================================================

/**
 * POST /api/pos/sales/shifts
 * Opens a new shift for the logged-in cashier.
 * Body: { openingCashAmount, deviceId, id? }
 *
 * `id` is optional — when a shift is opened OFFLINE, the app
 * generates the UUID client-side (so checkout can proceed
 * immediately without waiting on the network) and this endpoint
 * accepts it here once connectivity returns. ON CONFLICT makes this
 * idempotent: if a sync retry resubmits the same id, the existing
 * row is returned rather than erroring.
 */
router.post('/shifts', requirePermission('shift.open'), async (req, res, next) => {
  const { openingCashAmount, deviceId, id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    // If a client-supplied id already exists, this is a retried sync
    // of an offline-opened shift — return it as-is rather than
    // erroring or opening a second one.
    if (id) {
      const existing = await client.query(`SELECT id, opened_at FROM shifts WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return res.status(200).json({ alreadyApplied: true, ...existing.rows[0] });
      }
    }

    const openAlready = await client.query(
      `SELECT id FROM shifts WHERE staff_id = $1 AND status = 'open'`,
      [req.staff.id]
    );
    if (openAlready.rows.length > 0) {
      throw Object.assign(new Error('You already have an open shift'), { status: 409 });
    }

    const result = id
      ? await client.query(
          `INSERT INTO shifts (id, pharmacy_id, staff_id, device_id, opening_cash_amount)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, opened_at`,
          [id, req.staff.pharmacyId, req.staff.id, deviceId || null, openingCashAmount || 0]
        )
      : await client.query(
          `INSERT INTO shifts (pharmacy_id, staff_id, device_id, opening_cash_amount)
           VALUES ($1, $2, $3, $4) RETURNING id, opened_at`,
          [req.staff.pharmacyId, req.staff.id, deviceId || null, openingCashAmount || 0]
        );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'You already have an open shift' });
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/pos/sales/shifts/:id/close
 * Body: { closingCashAmount, notes }
 * Closing your OWN shift needs shift.close. Closing someone else's
 * (e.g. a manager reconciling after a cashier forgot) needs shift.close_others.
 */
router.post('/shifts/:id/close', async (req, res, next) => {
  const { closingCashAmount, notes } = req.body;
  if (closingCashAmount === undefined) {
    return res.status(400).json({ error: 'closingCashAmount is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const shiftResult = await client.query(
      `SELECT id, staff_id, opening_cash_amount, status FROM shifts WHERE id = $1`,
      [req.params.id]
    );
    const shift = shiftResult.rows[0];
    if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });
    if (shift.status === 'closed') throw Object.assign(new Error('Shift is already closed'), { status: 409 });

    const isOwnShift = shift.staff_id === req.staff.id;
    const permissionNeeded = isOwnShift ? 'shift.close' : 'shift.close_others';
    if (!req.staff.permissions.includes(permissionNeeded)) {
      throw Object.assign(new Error(`Missing permission: ${permissionNeeded}`), { status: 403 });
    }

    // Expected cash = opening float + total cash payments during this shift.
    const cashSalesResult = await client.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total_cash
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = $1 AND p.method = 'cash' AND s.status = 'completed'`,
      [req.params.id]
    );
    const expectedCash = Number(shift.opening_cash_amount) + Number(cashSalesResult.rows[0].total_cash);

    const result = await client.query(
      `UPDATE shifts
       SET status = 'closed', closed_at = now(), closed_by = $1,
           closing_cash_amount = $2, expected_cash_amount = $3, notes = $4
       WHERE id = $5
       RETURNING id, closed_at, expected_cash_amount, cash_discrepancy`,
      [req.staff.id, closingCashAmount, expectedCash, notes || null, req.params.id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

// ============================================================
// Sales
// ============================================================

/**
 * POST /api/pos/sales
 * Body: {
 *   shiftId, deviceId, clientOperationId,
 *   lineItems: [{ medicineId, quantity, unitPrice, discountAmount? }],
 *   payments: [{ method, amount, reference? }],
 *   discountTotal?, taxTotal?
 * }
 *
 * Creates the sale, its line items, its payments, and one stock_movement
 * per line item — all in a single transaction. If any line item can't
 * be fulfilled (insufficient stock), the ENTIRE sale rolls back — a
 * pharmacy sale is all-or-nothing, never partially applied.
 */
router.post('/', requirePermission('sale.create'), async (req, res, next) => {
  const { shiftId, deviceId, clientOperationId, lineItems, payments, discountTotal, taxTotal } = req.body;

  if (!shiftId || !clientOperationId || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'shiftId, clientOperationId and at least one line item are required' });
  }
  if (!Array.isArray(payments) || payments.length === 0) {
    return res.status(400).json({ error: 'At least one payment is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    // Idempotency: if this exact sale was already synced, return it as-is.
    const existing = await client.query(
      `SELECT id, sale_number, total FROM sales WHERE pharmacy_id = $1 AND client_operation_id = $2`,
      [req.staff.pharmacyId, clientOperationId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return res.status(200).json({ alreadyApplied: true, ...existing.rows[0] });
    }

    // Confirm the shift is open and belongs to this staff member.
    const shiftResult = await client.query(
      `SELECT id, status FROM shifts WHERE id = $1 AND staff_id = $2`,
      [shiftId, req.staff.id]
    );
    if (shiftResult.rows.length === 0) throw Object.assign(new Error('Shift not found'), { status: 404 });
    if (shiftResult.rows[0].status !== 'open') {
      throw Object.assign(new Error('Cannot ring up a sale on a closed shift'), { status: 409 });
    }

    let subtotal = 0;
    const resolvedLines = [];

    // Lock every line item's medicine row up front (in a stable order —
    // by id — to avoid deadlocks between two concurrent sales that share
    // a product) and validate stock before writing anything.
    const sortedLines = [...lineItems].sort((a, b) => String(a.medicineId).localeCompare(String(b.medicineId)));
    for (const line of sortedLines) {
      const medResult = await client.query(
        `SELECT id, name, quantity, price FROM medicines WHERE id = $1 FOR UPDATE`,
        [line.medicineId]
      );
      if (medResult.rows.length === 0) {
        throw Object.assign(new Error(`Medicine ${line.medicineId} not found`), { status: 404 });
      }
      const medicine = medResult.rows[0];
      const newQuantity = medicine.quantity - line.quantity;
      if (newQuantity < 0) {
        throw Object.assign(new Error(`Insufficient stock for ${medicine.name}`), { status: 409 });
      }

      const unitPrice = line.unitPrice ?? medicine.price;
      const discount = line.discountAmount || 0;
      const lineTotal = unitPrice * line.quantity - discount;
      subtotal += lineTotal;

      resolvedLines.push({ ...line, medicineName: medicine.name, unitPrice, discount, lineTotal, newQuantity });
    }

    const finalDiscountTotal = discountTotal || 0;
    const finalTaxTotal = taxTotal || 0;
    const total = subtotal - finalDiscountTotal + finalTaxTotal;

    const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    if (Math.abs(paymentsTotal - total) > 0.01) {
      throw Object.assign(new Error(`Payments (${paymentsTotal}) do not match sale total (${total})`), { status: 400 });
    }

    const saleNumberResult = await client.query(
      `SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales WHERE pharmacy_id = $1`,
      [req.staff.pharmacyId]
    );
    const saleNumber = saleNumberResult.rows[0].next;

    const saleResult = await client.query(
      `INSERT INTO sales
         (pharmacy_id, shift_id, staff_id, device_id, sale_number,
          subtotal, discount_total, tax_total, total, client_operation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, sale_number, created_at`,
      [req.staff.pharmacyId, shiftId, req.staff.id, deviceId || null, saleNumber,
       subtotal, finalDiscountTotal, finalTaxTotal, total, clientOperationId]
    );
    const saleId = saleResult.rows[0].id;

    for (const line of resolvedLines) {
      await client.query(
        `INSERT INTO sale_line_items (sale_id, medicine_id, medicine_name, quantity, unit_price, discount_amount, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [saleId, line.medicineId, line.medicineName, line.quantity, line.unitPrice, line.discount, line.lineTotal]
      );

      await client.query(
        `UPDATE medicines SET quantity = $1, version = version + 1, updated_at = now() WHERE id = $2`,
        [line.newQuantity, line.medicineId]
      );

      await client.query(
        `INSERT INTO stock_movements
           (pharmacy_id, medicine_id, change_type, quantity_delta, resulting_quantity,
            staff_id, device_id, client_operation_id, sale_id)
         VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7, $8)`,
        [req.staff.pharmacyId, line.medicineId, -line.quantity, line.newQuantity,
         req.staff.id, deviceId || null, `${clientOperationId}:${line.medicineId}`, saleId]
      );
    }

    for (const payment of payments) {
      await client.query(
        `INSERT INTO payments (sale_id, method, amount, reference) VALUES ($1, $2, $3, $4)`,
        [saleId, payment.method, payment.amount, payment.reference || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: saleId, saleNumber, total, createdAt: saleResult.rows[0].created_at });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/pos/sales/:id/void
 * Body: { reason, deviceId, clientOperationId }
 * Marks the sale voided and reverses each line item's stock via a
 * new 'return' movement — never deletes or edits the original sale.
 */
router.post('/:id/void', requirePermission('sale.void'), async (req, res, next) => {
  const { reason, deviceId, clientOperationId } = req.body;
  if (!clientOperationId) return res.status(400).json({ error: 'clientOperationId is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [req.staff.pharmacyId]);

    const saleResult = await client.query(`SELECT id, status FROM sales WHERE id = $1`, [req.params.id]);
    const sale = saleResult.rows[0];
    if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404 });
    if (sale.status !== 'completed') {
      throw Object.assign(new Error(`Sale is already ${sale.status}`), { status: 409 });
    }

    const lineItems = await client.query(
      `SELECT medicine_id, quantity FROM sale_line_items WHERE sale_id = $1`,
      [req.params.id]
    );

    for (const line of lineItems.rows) {
      const medResult = await client.query(`SELECT quantity FROM medicines WHERE id = $1 FOR UPDATE`, [line.medicine_id]);
      const newQuantity = medResult.rows[0].quantity + line.quantity;

      await client.query(
        `UPDATE medicines SET quantity = $1, version = version + 1, updated_at = now() WHERE id = $2`,
        [newQuantity, line.medicine_id]
      );

      await client.query(
        `INSERT INTO stock_movements
           (pharmacy_id, medicine_id, change_type, quantity_delta, resulting_quantity,
            staff_id, device_id, client_operation_id, sale_id, note)
         VALUES ($1, $2, 'return', $3, $4, $5, $6, $7, $8, $9)`,
        [req.staff.pharmacyId, line.medicine_id, line.quantity, newQuantity,
         req.staff.id, deviceId || null, `${clientOperationId}:${line.medicine_id}`, req.params.id,
         reason || 'Sale voided']
      );
    }

    await client.query(
      `UPDATE sales SET status = 'voided', voided_by = $1, voided_at = now(), void_reason = $2 WHERE id = $3`,
      [req.staff.id, reason || null, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ id: req.params.id, status: 'voided' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;