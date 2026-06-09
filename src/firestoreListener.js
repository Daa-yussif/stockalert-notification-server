const { db } = require('./firebase');
const { checkSingleMedicine } = require('./medicineChecker');

/**
 * Listen to Firestore medicines collection in real-time
 * Fires instantly when any medicine is added or updated
 */
function startFirestoreListener() {
  console.log('[Listener] Starting real-time Firestore listener...');

  const unsubscribe = db.collection('medicines').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        const medicine = { id: change.doc.id, ...change.doc.data() };

        if (change.type === 'added') {
          console.log(`[Listener] New medicine added: ${medicine.name}`);
          await checkSingleMedicine(medicine);
        }

        if (change.type === 'modified') {
          console.log(`[Listener] Medicine updated: ${medicine.name}`);
          await checkSingleMedicine(medicine);
        }

        if (change.type === 'removed') {
          console.log(`[Listener] Medicine removed: ${medicine.name}`);
        }
      });
    },
    (error) => {
      console.error('[Listener] Firestore error:', error);
      // Restart listener after 5 seconds on error
      setTimeout(startFirestoreListener, 5000);
    }
  );

  // Return unsubscribe function so we can stop it if needed
  return unsubscribe;
}

module.exports = { startFirestoreListener };