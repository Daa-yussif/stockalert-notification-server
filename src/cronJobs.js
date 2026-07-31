const cron = require('node-cron');
const { checkAllMedicines } = require('./medicineChecker');
require('dotenv').config();

const TIMEZONE = process.env.CRON_TIMEZONE || 'Africa/Accra';

/**
 * Start all scheduled cron jobs
 */
function startCronJobs() {
  // -- 7:00 AM daily --------------------------------------------------
  cron.schedule('0 7 * * *', async () => {
    console.log(`[Cron] 7AM check at ${new Date().toISOString()}`);
    try {
      await checkAllMedicines();
    } catch (err) {
      console.error('[Cron] Error during 7AM check:', err);
    }
  }, { timezone: TIMEZONE });

  console.log(`[Cron] 7AM alert scheduled: "0 7 * * *" (${TIMEZONE})`);

  // -- 5:00 PM daily ---------------------------------------------------
  cron.schedule('0 17 * * *', async () => {
    console.log(`[Cron] 5PM check at ${new Date().toISOString()}`);
    try {
      await checkAllMedicines();
    } catch (err) {
      console.error('[Cron] Error during 5PM check:', err);
    }
  }, { timezone: TIMEZONE });

  console.log(`[Cron] 5PM alert scheduled: "0 17 * * *" (${TIMEZONE})`);

  console.log('[Cron] All jobs running - notifications at 7:00 AM and 5:00 PM daily');
}

module.exports = { startCronJobs };
