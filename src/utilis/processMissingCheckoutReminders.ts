import { AttendanceRecord, AttendanceReminder, User } from '../models';
import { RequestContext } from '../types/context';
import { UserService } from '../services/user.service';
import { emailService } from '../services/email.service';

const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const getIndiaDayBoundaries = (now: Date) => {
  const indiaNow = new Date(now.getTime() + INDIA_OFFSET_MS);
  const todayStartUtc = new Date(
    Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate()) - INDIA_OFFSET_MS
  );
  const previousDayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
  const attendanceDate = new Date(previousDayStartUtc.getTime() + INDIA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return { previousDayStartUtc, todayStartUtc, attendanceDate };
};

export const processMissingCheckoutReminders = async (now = new Date()) => {
  const { previousDayStartUtc, todayStartUtc, attendanceDate } = getIndiaDayBoundaries(now);
  const records = await AttendanceRecord.find({
    firstIn: { $gte: previousDayStartUtc, $lt: todayStartUtc },
    swipes: { $elemMatch: { direction: 'IN' } },
    status: { $nin: ['regularized', 'overridden'] }
  }).lean();

  const openRecords = records.filter(record => {
    const validSwipes = (record.swipes || [])
      .filter(swipe => swipe.direction === 'IN' || swipe.direction === 'OUT')
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    return validSwipes.length > 0 && validSwipes[validSwipes.length - 1].direction === 'IN';
  });

  const users = await User.find({
    _id: { $in: openRecords.map(record => record.userId) },
    active: true,
    portalAccess: true
  }).lean();
  const usersById = new Map(users.map(user => [user._id.toString(), user]));
  const result = { found: openRecords.length, sent: 0, failed: 0, skipped: 0 };

  for (const record of openRecords) {
    const user = usersById.get(record.userId.toString());
    if (!user) {
      result.skipped += 1;
      continue;
    }

    let reminder: any;
    try {
      reminder = await AttendanceReminder.create({
        attendanceRecordId: record._id,
        userId: user._id,
        reminderType: 'missing_checkout',
        attendanceDate,
        status: 'processing'
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        result.skipped += 1;
        continue;
      }
      throw error;
    }

    const title = 'Missing sign-out reminder';
    const body = `You signed in on ${attendanceDate}, but no final sign-out was recorded. Please sign out or submit an attendance regularization request.`;
    let pushSent = false;
    let emailSent = false;
    const errors: string[] = [];

    if (user.fcmToken) {
      const context: RequestContext = {
        requestId: `MISSING-CHECKOUT-${record._id}`,
        reqRole: user.role,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          departmentId: user.departmentId,
          active: user.active,
          country: user.country,
          currency: user.currency,
          licenseType: user.licenseType,
          portalAccess: user.portalAccess
        }
      };
      try {
        await new UserService(context).sendNotification(user._id.toString(), title, body, {
          type: 'missing_checkout',
          attendanceDate,
          attendanceRecordId: record._id.toString()
        });
        pushSent = true;
      } catch (error: any) {
        errors.push(`Push: ${error.message}`);
      }
    }

    if (user.email) {
      try {
        await emailService.sendEmail({
          body: {
            to: user.email,
            subject: title,
            text: `Hello ${user.name},\n\n${body}\n\nRegards,\n${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`
          }
        });
        emailSent = true;
      } catch (error: any) {
        errors.push(`Email: ${error.message}`);
      }
    }

    const sent = pushSent || emailSent;
    reminder.status = sent ? 'sent' : 'failed';
    reminder.pushSent = pushSent;
    reminder.emailSent = emailSent;
    reminder.error = errors.join(' | ') || undefined;
    reminder.sentAt = sent ? new Date() : undefined;
    await reminder.save();
    sent ? result.sent += 1 : result.failed += 1;
  }

  return result;
};
