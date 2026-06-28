const cron = require('node-cron');
const { checkAllMedicines } = require('./medicineChecker');
require('dotenv').config();

const TIMEZONE = process.env.CRON_TIMEZONE || 'Africa/Accra';

/**
 * Start all scheduled cron jobs
 */
function startCronJobs() {
  // ── 12:00 AM (midnight) daily ─────────────────────────────────────
  cron.schedule('0 0 * * *', async () => {
    console.log(`[Cron] Midnight check at ${new Date().toISOString()}`);
    try {
      await checkAllMedicines();
    } catch (err) {
      console.error('[Cron] Error during midnight check:', err);
    }
  }, { timezone: TIMEZONE });

  console.log(`[Cron] Midnight alert scheduled: "0 0 * * *" (${TIMEZONE})`);

  // ── 6:00 PM daily ────────────────────────────────────────────────
  cron.schedule('0 18 * * *', async () => {
    console.log(`[Cron] 6PM check at ${new Date().toISOString()}`);
    try {
      await checkAllMedicines();
    } catch (err) {
      console.error('[Cron] Error during 6PM check:', err);
    }
  }, { timezone: TIMEZONE });

  console.log(`[Cron] 6PM alert scheduled: "0 18 * * *" (${TIMEZONE})`);

  console.log('[Cron] All jobs running — notifications at 12:00 AM and 6:00 PM daily');
}

module.exports = { startCronJobs };