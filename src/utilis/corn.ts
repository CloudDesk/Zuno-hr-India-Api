// cron.ts
import cron from 'node-cron';
import { updateShiftAssignmentStatuses } from './updateShiftAssignmentStatuses';
import { processDailyMilestones } from './processMilestones';
import { processMissingCheckoutReminders } from './processMissingCheckoutReminders';
import { LeaveReleaseConfigurationService } from '../services/leave-release-configuration.service';

cron.schedule('59 23 * * *', async () => {
    try {
        console.log('[CRON] Running shift assignment status updater...');
        await updateShiftAssignmentStatuses();
        console.log('[CRON] Done');
    } catch (err) {
        console.error('[CRON] Error updating shift assignments', err);
    }
});

// Daily automated greetings at 12:00 AM IST.
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('[CRON] Running daily milestone greetings...');
        await processDailyMilestones();
        console.log('[CRON] Milestones processed.');
    } catch (err) {
        console.error('[CRON] Error in milestone cron', err);
    }
}, { timezone: 'Asia/Kolkata' });

// 12:00 AM IST: remind employees whose final swipe for the day is still IN.
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('[CRON] Running missing sign-out reminders...');
        const result = await processMissingCheckoutReminders();
        console.log('[CRON] Missing sign-out reminders processed:', result);
    } catch (err) {
        console.error('[CRON] Error processing missing sign-out reminders', err);
    }
}, { timezone: 'Asia/Kolkata' });

// 12:05 AM IST: process leave credits due for the new business date.
cron.schedule('5 0 * * *', async () => {
    try {
        console.log('[CRON] Running scheduled leave releases...');
        const result = await LeaveReleaseConfigurationService.processDueConfigurations();
        console.log('[CRON] Scheduled leave releases processed:', result);
    } catch (err) {
        console.error('[CRON] Error processing scheduled leave releases', err);
    }
}, { timezone: 'Asia/Kolkata' });
