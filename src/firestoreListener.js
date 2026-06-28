const { db } = require('./firebase');
const { checkSingleMedicine } = require('./medicineChecker');

/**
 * Listen to ALL users' medicines in real-time.
 * Firestore structure: users/{uid}/medicines/{medicineId}
 */
function startFirestoreListener() {
  console.log('[Listener] Starting real-time Firestore listener for all users...');

  // First get all existing users, then listen to each
  db.collection('users').onSnapshot(
    async (usersSnapshot) => {
      usersSnapshot.docChanges().forEach((userChange) => {
        const uid = userChange.doc.id;

        if (userChange.type === 'added') {
          // New user detected — start listening to their medicines
          listenToUserMedicines(uid);
        }
      });

      // Also listen to all existing users on startup
      if (usersSnapshot.docs.length > 0) {
        usersSnapshot.docs.forEach((userDoc) => {
          listenToUserMedicines(userDoc.id);
        });
      }
    },
    (error) => {
      console.error('[Listener] Users collection error:', error);
      setTimeout(startFirestoreListener, 5000);
    }
  );
}

// Track active listeners to avoid duplicates
const activeListeners = new Set();

/**
 * Listen to a single user's medicines subcollection
 */
function listenToUserMedicines(uid) {
  // Skip if already listening to this user
  if (activeListeners.has(uid)) return;
  activeListeners.add(uid);

  console.log(`[Listener] Listening to medicines for user: ${uid}`);

  db.collection('users')
    .doc(uid)
    .collection('medicines')
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          const medicine = { id: change.doc.id, ...change.doc.data() };

          if (change.type === 'added') {
            console.log(`[Listener] User ${uid} — new medicine: ${medicine.name}`);
            await checkSingleMedicine(medicine, uid);
          }

          if (change.type === 'modified') {
            console.log(`[Listener] User ${uid} — medicine updated: ${medicine.name}`);
            await checkSingleMedicine(medicine, uid);
          }

          if (change.type === 'removed') {
            console.log(`[Listener] User ${uid} — medicine removed: ${medicine.name}`);
          }
        });
      },
      (error) => {
        console.error(`[Listener] Error for user ${uid}:`, error.message);
        // Remove from active set so it can be re-added
        activeListeners.delete(uid);
        // Retry after 5 seconds
        setTimeout(() => listenToUserMedicines(uid), 5000);
      }
    );
}

module.exports = { startFirestoreListener };