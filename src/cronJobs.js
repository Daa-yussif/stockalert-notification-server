const cron = require('node-cron');
const { checkAllMedicines } = require('./medicineChecker');
require('dotenv').config();

const SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * *';
const TIMEZONE = process.env.CRON_TIMEZONE || 'Africa/Accra';

/**
 * Start all scheduled cron jobs
 */
function startCronJobs() {
  // Daily stock alert at 8AM Accra time
  cron.schedule(
    SCHEDULE,
    async () => {
      console.log(`[Cron] Running daily stock check at ${new Date().toISOString()}`);
      try {
        await checkAllMedicines();
      } catch (err) {
        console.error('[Cron] Error during daily check:', err);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log(`[Cron] Daily alert scheduled: "${SCHEDULE}" (${TIMEZONE})`);

  // Also run a check every hour for any urgent issues
  cron.schedule('0 * * * *', async () => {
    console.log(`[Cron] Hourly check at ${new Date().toISOString()}`);
    try {
      await checkAllMedicines();
    } catch (err) {
      console.error('[Cron] Error during hourly check:', err);
    }
  });

  console.log('[Cron] Hourly check also scheduled');
}

module.exports = { startCronJobs };