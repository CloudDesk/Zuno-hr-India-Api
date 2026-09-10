// cron.ts
import cron from 'node-cron';
import { updateShiftAssignmentStatuses } from './updateShiftAssignmentStatuses';
import { processDailyMilestones } from './processMilestones';
import { processMissingCheckoutReminders } from './processMissingCheckoutReminders';
import { LeaveReleaseConfigurationService } from '../services/leave-release-configuration.service';

const DEFAULT_MISSING_CHECKOUT_CRON = '0 0 * * *';
const DEFAULT_MISSING_CHECKOUT_TIME = '00:00';
const DEFAULT_MISSING_CHECKOUT_TIMEZONE = 'Asia/Kolkata';

const configuredMissingCheckoutTime =
    process.env.MISSING_CHECKOUT_REMINDER_TIME?.trim() || DEFAULT_MISSING_CHECKOUT_TIME;
const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(configuredMissingCheckoutTime);
const cronFromConfiguredTime = timeMatch
    ? `${Number(timeMatch[2])} ${Number(timeMatch[1])} * * *`
    : DEFAULT_MISSING_CHECKOUT_CRON;
const configuredMissingCheckoutCron =
    process.env.MISSING_CHECKOUT_REMINDER_CRON?.trim() || cronFromConfiguredTime;
const missingCheckoutCron = cron.validate(configuredMissingCheckoutCron)
    ? configuredMissingCheckoutCron
    : DEFAULT_MISSING_CHECKOUT_CRON;
const configuredMissingCheckoutTimezone =
    process.env.MISSING_CHECKOUT_REMINDER_TIMEZONE?.trim() || DEFAULT_MISSING_CHECKOUT_TIMEZONE;
const isValidTimezone = (timezone: string) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return true;
    } catch {
        return false;
    }
};
const missingCheckoutTimezone = isValidTimezone(configuredMissingCheckoutTimezone)
    ? configuredMissingCheckoutTimezone
    : DEFAULT_MISSING_CHECKOUT_TIMEZONE;

if (missingCheckoutCron !== configuredMissingCheckoutCron) {
    console.warn(
        `[CRON] Invalid MISSING_CHECKOUT_REMINDER_CRON "${configuredMissingCheckoutCron}"; ` +
        `using ${DEFAULT_MISSING_CHECKOUT_CRON}.`
    );
}

if (!timeMatch && !process.env.MISSING_CHECKOUT_REMINDER_CRON?.trim()) {
    console.warn(
        `[CRON] Invalid MISSING_CHECKOUT_REMINDER_TIME "${configuredMissingCheckoutTime}"; ` +
        `expected HH:mm and using ${DEFAULT_MISSING_CHECKOUT_TIME}.`
    );
}

if (missingCheckoutTimezone !== configuredMissingCheckoutTimezone) {
    console.warn(
        `[CRON] Invalid MISSING_CHECKOUT_REMINDER_TIMEZONE "${configuredMissingCheckoutTimezone}"; ` +
        `using ${DEFAULT_MISSING_CHECKOUT_TIMEZONE}.`
    );
}

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

// By default, run at 12:00 AM IST. Use MISSING_CHECKOUT_REMINDER_TIME=HH:mm
// for a daily test time, or MISSING_CHECKOUT_REMINDER_CRON for an advanced
// schedule (for example, "*/5 * * * *" runs every five minutes).
console.log(
    `[CRON] Missing sign-out reminder scheduled as "${missingCheckoutCron}" ` +
    `in ${missingCheckoutTimezone}.`
);
cron.schedule(missingCheckoutCron, async () => {
    try {
        console.log('[CRON] Running missing sign-out reminders...');
        const result = await processMissingCheckoutReminders();
        console.log('[CRON] Missing sign-out reminders processed:', result);
    } catch (err) {
        console.error('[CRON] Error processing missing sign-out reminders', err);
    }
}, { timezone: missingCheckoutTimezone });

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
