
import { ShiftAssignment } from './../models/shift.model'
import { User } from './../models/user.model';

// Get today's date boundaries in UTC
const getTodayUTCDateRange = () => {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const start = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0));
    const end = new Date(Date.UTC(utcYear, utcMonth, utcDate, 23, 59, 59, 999));
    return { start, end };
};

export const updateShiftAssignmentStatuses = async () => {
    const { start: todayStartUTC, end: todayEndUTC } = getTodayUTCDateRange();

    console.log(`[ShiftStatusCron] UTC check: ${todayStartUTC.toISOString()} → ${todayEndUTC.toISOString()}`);

    // 1. CURRENT → PAST if endDate ≤ today
    const currentToPast = await ShiftAssignment.find({
        status: 'current',
        isActive: true,
        endDate: { $lte: todayEndUTC },
    });

    for (const assignment of currentToPast) {
        assignment.status = 'past';
        assignment.isActive = false;
        await assignment.save();

        await User.updateOne(
            { _id: assignment.userId },
            { $set: { currentShiftAssignmentData: null } }
        );
    }

    // 2. UPCOMING → CURRENT if startDate === today
    const upcomingToCurrent = await ShiftAssignment.find({
        status: 'upcoming',
        isActive: true,
        startDate: { $gte: todayStartUTC, $lte: todayEndUTC },
    });

    for (const assignment of upcomingToCurrent) {
        assignment.status = 'current';
        await assignment.save();

        const shiftData = {
            startDate: assignment.startDate,
            endDate: assignment.endDate,
            shiftCode: assignment.shiftCode,
            shiftId: assignment.shiftId,
            shiftAssignmentId: assignment._id,
        };

        await User.updateOne(
            { _id: assignment.userId },
            {
                $set: {
                    currentShiftAssignmentData: shiftData,
                    upcomingShiftAssignmentData: null,
                },
            }
        );
    }

    console.log(`[ShiftStatusCron] Done → ${currentToPast.length} past, ${upcomingToCurrent.length} current`);
};
