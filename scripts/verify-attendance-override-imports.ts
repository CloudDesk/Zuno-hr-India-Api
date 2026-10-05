import assert from 'node:assert/strict';
import { AttendanceOverrideService } from '../src/services/attendance-override.service';
import { BiometricAttendanceService } from '../src/services/biometric-attendance.service';
import { User } from '../src/models/user.model';

async function verify() {
    const service = new AttendanceOverrideService({} as any) as any;
    const prototype = BiometricAttendanceService.prototype as any;
    const originalFind = User.findById;
    const originalShift = prototype.getCurrentShiftAssignment;
    try {
        // Exercise the actual lazy import in ts-node without querying the database.
        (User as any).findById = () => ({ select: async () => ({ country: 'IN' }) });
        prototype.getCurrentShiftAssignment = async () => null;
        assert.equal(await service.getShiftAssignment('69735bcc77ea11ab2d790594', new Date('2026-08-03')), null);
    } finally {
        User.findById = originalFind;
        prototype.getCurrentShiftAssignment = originalShift;
    }
    const shiftDay = new Date('2026-08-03');
    const shift = { shiftStart: new Date('2026-08-03T03:30:00Z'), shiftEnd: new Date('2026-08-03T12:30:00Z') };
    const data = { userId: '69735bcc77ea11ab2d790594', shiftDay: '2026-08-03', attendanceStatus: ['Override', 'Present'] };
    const present = await service.prepareOverrideRecordData(data, shift, shiftDay, 'Present', true, false, false);
    assert.equal(present.status, 'complete');
    assert.deepEqual(present.firstIn, shift.shiftStart);
    assert.deepEqual(present.lastOut, shift.shiftEnd);
    assert.equal(present.isLateEntry, false);
    assert.equal(present.isEarlyExit, false);
    const absent = await service.prepareOverrideRecordData(data, shift, shiftDay, 'Absent', false, true, false);
    assert.equal(absent.status, 'incomplete');
    assert.equal(absent.firstIn, null);
    assert.equal(absent.actualWorkHours, '00:00:00');
    assert.equal(absent.shortfallHours, absent.shiftHours);
    const holiday = await service.prepareOverrideRecordData(data, shift, shiftDay, 'Holiday-Swipe', false, false, true);
    assert.equal(holiday.status, 'holiday_swipe');
    assert.equal(holiday.firstIn, null);
    assert.equal(holiday.shortfallHours, '00:00:00');
    // Ensure the other lazy dependencies in this service resolve from source too.
    assert.ok(require('../src/models/leave.model').Leave);
    assert.ok(require('../src/services/leave.service').LeaveService);
    assert.ok(require('../src/services/leave-summary.service').LeaveSummaryService);
    assert.ok(require('../src/models/lov.model').LOV);
    console.log('Attendance override source imports and Present/Absent/Holiday behaviour checks passed. No database writes performed.');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
