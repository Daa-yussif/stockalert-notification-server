const { db } = require('./firebase');
const { checkSingleMedicine } = require('./medicineChecker');

/**
 * Listen to ALL users' medicines in real-time via a single collection
 * group listener, instead of first listing db.collection('users') and
 * attaching one listener per uid.
 *
 * Why: Firestore only returns a parent doc from collection().get()/
 * onSnapshot() if that doc has its own fields set. A users/{uid} doc
 * that only ever had subcollections written to it (medicines,
 * fcm_tokens - never a direct .set() on the user doc itself) never
 * showed up, so the old per-user-discovery approach silently listened
 * to nobody. A collection group query bypasses the parent entirely.
 *
 * Firestore structure: users/{uid}/medicines/{medicineId}
 */
function startFirestoreListener() {
  console.log('[Listener] Starting real-time Firestore listener for all users (collection group)...');

  db.collectionGroup('medicines').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        const uid = change.doc.ref.parent.parent?.id;
        if (!uid) return;

        const medicine = { id: change.doc.id, ...change.doc.data() };

        if (change.type === 'added') {
          console.log(`[Listener] User ${uid} - new medicine: ${medicine.name}`);
          await checkSingleMedicine(medicine, uid);
        }

        if (change.type === 'modified') {
          console.log(`[Listener] User ${uid} - medicine updated: ${medicine.name}`);
          await checkSingleMedicine(medicine, uid);
        }

        if (change.type === 'removed') {
          console.log(`[Listener] User ${uid} - medicine removed: ${medicine.name}`);
        }
      });
    },
    (error) => {
      console.error('[Listener] Collection group error:', error.message);
      setTimeout(startFirestoreListener, 5000);
    }
  );
}

module.exports = { startFirestoreListener };
