const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Production (Render) — read from environment variable
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
    console.log('[Firebase] Initialized from environment variable');
  } else {
    // Local development — read from file
    const serviceAccount = require(
      path.resolve(__dirname, '../../serviceAccountKey.json')
    );
    credential = admin.credential.cert(serviceAccount);
    console.log('[Firebase] Initialized from local file');
  }

  admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

module.exports = { admin, db, messaging };