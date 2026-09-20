require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { startCronJobs } = require('./cronJobs');
const { startFirestoreListener } = require('./firestoreListener');

// NEW — Postgres-backed POS routes, entirely separate from the
// Firestore notification/AI routes above. See pos/ for the code.
const posPharmacyRoutes = require('../pos/routes/pharmacies');
const posInviteRoutes = require('../pos/routes/invites');
const posMedicineRoutes = require('../pos/routes/medicines');
const posSalesRoutes = require('../pos/routes/sales');
const posMeRoutes = require('../pos/routes/me');
const posRolesRoutes = require('../pos/routes/roles');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes (existing — untouched)
app.use('/api', routes);

// NEW — POS routes, namespaced under /api/pos so they can never
// collide with existing paths like /api/medicines/alerts.
app.use('/api/pos/pharmacies', posPharmacyRoutes);
app.use('/api/pos/invites', posInviteRoutes);
app.use('/api/pos/medicines', posMedicineRoutes);
app.use('/api/pos/sales', posSalesRoutes);
app.use('/api/pos/me', posMeRoutes);
app.use('/api/pos/roles', posRolesRoutes);

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
  console.log(`  POST http://localhost:${PORT}/api/pos/pharmacies`);
  console.log(`  POST http://localhost:${PORT}/api/pos/invites`);
  console.log(`  POST http://localhost:${PORT}/api/pos/invites/redeem`);
  console.log(`  GET  http://localhost:${PORT}/api/pos/medicines`);
  console.log(`  POST http://localhost:${PORT}/api/pos/medicines/:id/stock-movements`);
  console.log(`  POST http://localhost:${PORT}/api/pos/sales/shifts`);
  console.log(`  POST http://localhost:${PORT}/api/pos/sales/shifts/:id/close`);
  console.log(`  POST http://localhost:${PORT}/api/pos/sales`);
  console.log(`  POST http://localhost:${PORT}/api/pos/sales/:id/void`);
  console.log(`  GET  http://localhost:${PORT}/api/pos/me`);
});