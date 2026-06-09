require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { startCronJobs } = require('./cronJobs');
const { startFirestoreListener } = require('./firestoreListener');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   StockAlert Notification Server       ║');
  console.log(`║   Running on port ${PORT}                 ║`);
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  // Start real-time Firestore listener
  startFirestoreListener();

  // Start scheduled cron jobs
  startCronJobs();

  console.log('[Server] All systems running');
  console.log('');
  console.log('API Endpoints:');
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  POST http://localhost:${PORT}/api/check`);
  console.log(`  POST http://localhost:${PORT}/api/notify`);
  console.log(`  POST http://localhost:${PORT}/api/token`);
  console.log(`  GET  http://localhost:${PORT}/api/medicines/alerts`);
});