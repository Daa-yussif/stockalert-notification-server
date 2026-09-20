const { Pool } = require('pg');

// Separate pool from Firestore — this is the ONLY thing in the project
// that talks to PostgreSQL. Everything else (firebase.js, cronJobs.js,
// firestoreListener.js, etc.) is untouched.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Runs `fn` inside a transaction with app.current_pharmacy_id set for
 * that transaction only, so PostgreSQL's row-level security policies
 * scope every query to this pharmacy automatically.
 */
async function withPharmacyScope(pharmacyId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_pharmacy_id', $1, true)", [pharmacyId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` with no pharmacy scope — only for intentionally cross-tenant
 * operations (creating a pharmacy, invite lookup by code, staff lookup
 * by firebase_uid before we know their pharmacy_id).
 */
async function withoutScope(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Like withPharmacyScope, but scopes by the caller's OWN firebase_uid
 * instead of a pharmacy_id — used ONLY for the login-time lookup that
 * discovers which pharmacy a user belongs to, before pharmacy_id is
 * known. Never returns another user's row.
 */
async function withFirebaseUidScope(firebaseUid, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_firebase_uid', $1, true)", [firebaseUid]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Like withPharmacyScope, but scopes by an invite's own code — used
 * ONLY for the redeem-time lookup that discovers which pharmacy an
 * invite belongs to, before pharmacy_id is known. Never returns
 * another invite's row.
 */
async function withInviteCodeScope(code, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_invite_code', $1, true)", [code]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withPharmacyScope, withoutScope, withFirebaseUidScope, withInviteCodeScope };