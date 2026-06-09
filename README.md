# StockAlert Notification Server

Node.js server that sends real-time push notifications for the StockAlert pharmacy app.

## Setup

### 1. Get Firebase Service Account Key
1. Go to Firebase console → stockalert-82e1f
2. Click gear icon → Project settings → Service accounts
3. Click "Generate new private key"
4. Save the downloaded file as `serviceAccountKey.json` in the ROOT of this folder (next to package.json)

### 2. Install dependencies
```bash
npm install
```

### 3. Create .env file
```bash
cp .env.example .env
```

### 4. Run the server
```bash
# Production
npm start

# Development (auto-restarts on file change)
npm run dev
```

## API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/health | Check server is running |
| POST | /api/check | Trigger manual medicine check |
| POST | /api/notify | Send custom notification |
| POST | /api/token | Register FCM token |
| GET | /api/medicines/alerts | Get all alert statuses |

## Folder Structure
```
notification-server/
├── src/
│   ├── index.js              → server entry point
│   ├── firebase.js           → Firebase Admin SDK init
│   ├── firestoreListener.js  → real-time Firestore watcher
│   ├── cronJobs.js           → scheduled daily/hourly checks
│   ├── medicineChecker.js    → alert logic
│   ├── notificationHelper.js → FCM send helper
│   └── routes.js             → API endpoints
├── serviceAccountKey.json    → your Firebase key (never commit!)
├── .env                      → environment variables (never commit!)
├── .env.example              → template
├── .gitignore
├── package.json
└── README.md
```