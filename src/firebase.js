const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

if (!admin.apps.length) {
  const serviceAccount = require(
    path.resolve(__dirname, '../serviceAccountKey.json')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  console.log('[Firebase] Initialized successfully');
}

const db = admin.firestore();
const messaging = admin.messaging();

module.exports = { admin, db, messaging };