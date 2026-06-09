if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production (Render)
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  credential = admin.credential.cert(serviceAccount);
} else {
  // Local
  const serviceAccount = require('../../serviceAccountKey.json');
  credential = admin.credential.cert(serviceAccount);
}