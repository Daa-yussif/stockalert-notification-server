const express = require('express');
const { admin, db } = require('./firebase');
const { verifyAuth, isStaffAccount } = require('./authMiddleware');

const router = express.Router();

/**
 * Create a staff/cashier account under the calling owner's pharmacy.
 * Uses Admin SDK to create the Firebase Auth user WITHOUT signing the
 * owner out of their own session (the client SDK can't do this safely).
 */
router.post('/staff/create', verifyAuth, async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({
      error: 'name, email, and a password of 6+ characters are required',
    });
  }

  try {
    // Staff cannot create further staff — keeps hierarchy 2-level only
    const callerIsStaff = await isStaffAccount(req.uid);
    if (callerIsStaff) {
      return res.status(403).json({
        error: 'Staff accounts cannot create additional staff accounts',
      });
    }

    // Create the Firebase Auth user for the new staff member
    const newUser = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // Map the new staff uid -> this owner's uid
    await db.collection('staff_access').doc(newUser.uid).set({
      ownerUid: req.uid,
      createdAt: new Date().toISOString(),
    });

    // Also keep a readable list under the owner's own data for the UI
    await db
      .collection('users')
      .doc(req.uid)
      .collection('staff')
      .doc(newUser.uid)
      .set({
        name,
        email,
        role: 'cashier',
        createdAt: new Date().toISOString(),
      });

    res.json({ success: true, staffUid: newUser.uid });
  } catch (err) {
    console.error('[API] Staff create error:', err.message);
    if (err.code === 'auth/email-already-exists') {
      return res
        .status(400)
        .json({ error: 'An account with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * List all staff/cashier accounts belonging to the calling owner.
 */
router.get('/staff/list', verifyAuth, async (req, res) => {
  try {
    const callerIsStaff = await isStaffAccount(req.uid);
    if (callerIsStaff) {
      // Staff can't see the full staff list — only owners manage staff
      return res.json({ staff: [] });
    }

    const snap = await db
      .collection('users')
      .doc(req.uid)
      .collection('staff')
      .get();

    const staff = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ staff });
  } catch (err) {
    console.error('[API] Staff list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Remove a staff account's access (does not delete their Firebase Auth
 * account, just revokes their mapping to this pharmacy's data).
 */
router.delete('/staff/:staffUid', verifyAuth, async (req, res) => {
  const { staffUid } = req.params;

  try {
    const mappingDoc = await db.collection('staff_access').doc(staffUid).get();
    if (!mappingDoc.exists || mappingDoc.data().ownerUid !== req.uid) {
      return res.status(403).json({ error: 'Not authorized to remove this staff member' });
    }

    await db.collection('staff_access').doc(staffUid).delete();
    await db.collection('users').doc(req.uid).collection('staff').doc(staffUid).delete();

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Staff remove error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;