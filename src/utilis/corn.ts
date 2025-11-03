// cron.ts
import cron from 'node-cron';
import { updateShiftAssignmentStatuses } from './updateShiftAssignmentStatuses';

cron.schedule('59 23 * * *', async () => {
    try {
        console.log('[CRON] Running shift assignment status updater...');
        await updateShiftAssignmentStatuses();
        console.log('[CRON] Done');
    } catch (err) {
        console.error('[CRON] Error updating shift assignments', err);
    }
});