import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { connectDB } from '../src/config/database';
import { User } from '../src/models/user.model';
import { Shift, ShiftAssignment } from '../src/models/shift.model';
import { AttendanceRecord } from '../src/models/attendance-record.model';
import { AttendanceRegularization } from '../src/models/attendance-regularization.model';
import { Leave } from '../src/models/leave.model';
import { WFH } from '../src/models/wfh.model';
import { AttendanceRegularizationService } from '../src/services/attendance-regularization.service';
import { LeaveService } from '../src/services/leave.service';
import { WFHService } from '../src/services/wfh.service';
import { emailService } from '../src/services/email.service';
import { RequestContext } from '../src/types/context';
import { getExpectedWorkMinutes } from '../src/utilis/attendance-duration';

type Result = {
  name: string;
  passed: boolean;
  details: string;
};

const results: Result[] = [];
const generatedAt = new Date();
const suffix = `${generatedAt.toISOString().replace(/\D/g, '').slice(0, 14)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
const qaName = `QA Regularization ${suffix}`;
const qaEmail = `qa.regularization.${suffix}@example.invalid`;
const qaEmployeeCode = `QAREG${suffix.slice(-12)}`;
const qaBiometricId = `QR${suffix.slice(-16)}`;

const originalLog = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[QA]')) {
    originalLog(...args);
  }
};

function utcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function duration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function clock(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function atOffset(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function hasStatus(record: any, status: string): boolean {
  return Array.isArray(record.attendanceStatus) && record.attendanceStatus.includes(status);
}

function assertThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<string>): Promise<void> {
  try {
    const details = await body();
    results.push({ name, passed: true, details });
    console.log(`[QA] PASS: ${name}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, details });
    console.log(`[QA] FAIL: ${name} - ${details}`);
  }
}

async function main(): Promise<void> {
  await connectDB();

  // Prevent this integration test from sending mail to real employees/admins.
  (emailService as any).sendEmail = async () => ({ success: true, testSuppressed: true });

  const adminRecord = await User.findOne({
    active: true,
    $or: [{ role: 'admin' }, { isSuperAdmin: true }],
  }).lean();
  if (!adminRecord) throw new Error('No active admin is available to act as the test approver');
  const admin = adminRecord;

  const templateAssignment = await ShiftAssignment.findOne({
    status: 'current',
    isActive: true,
  }).populate<{ shiftId: any }>('shiftId');
  assertThat(templateAssignment?.shiftId, 'No active shift assignment with a valid shift is available');

  const shiftRecord = await Shift.findById(templateAssignment.shiftId._id);
  if (!shiftRecord) throw new Error('The template shift could not be loaded');
  const shift = shiftRecord;
  assertThat(!shift.isOvernightShift, 'The E2E test requires an active non-overnight shift');

  const templateUserRecord = await User.findById(templateAssignment.userId).lean();
  if (!templateUserRecord) throw new Error('The employee attached to the template shift could not be loaded');
  const templateUser = templateUserRecord;

  const qaUser = await User.create({
    name: qaName,
    email: qaEmail,
    password: `QA-only-${suffix}`,
    role: 'staff',
    specificRole: 'QA Regularization Test',
    departmentId: templateUser.departmentId,
    managerId: admin._id,
    managerName: admin.name,
    costCenter: templateUser.costCenter || 'QA',
    employeeCode: qaEmployeeCode,
    biometricId: qaBiometricId,
    active: true,
    joiningDate: new Date('2026-01-01T00:00:00.000Z'),
    confirmationDate: new Date('2026-01-01T00:00:00.000Z'),
    probationDate: templateUser.probationDate || '0',
    location: templateUser.location || 'qa',
    noticePeriod: templateUser.noticePeriod ?? 0,
    employmentStatus: templateUser.employmentStatus || 'confirmed',
    country: 'IN',
    currency: 'INR',
    licenseType: 'employee',
    portalAccess: false,
  });

  const qaAssignment = await ShiftAssignment.create({
    userId: qaUser._id,
    shiftId: shift._id,
    shiftCode: shift.code,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
    isActive: true,
    status: 'current',
    earlyCheckInThreshold: templateAssignment.earlyCheckInThreshold,
    assignedBy: admin._id,
    assignedAt: new Date(),
    weekendDays: templateAssignment.weekendDays?.length ? templateAssignment.weekendDays : [0, 6],
  });

  qaUser.currentShiftAssignmentData = {
    startDate: qaAssignment.startDate,
    endDate: null,
    shiftCode: shift.code,
    shiftId: shift._id as any,
    shiftAssignmentId: qaAssignment._id as any,
  } as any;
  await qaUser.save();

  const context: RequestContext = {
    reqRole: 'admin',
    requestId: `qa-regularization-${suffix}`,
    user: {
      _id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      departmentId: admin.departmentId,
      active: admin.active,
      country: admin.country,
      currency: admin.currency,
      licenseType: admin.licenseType,
      portalAccess: admin.portalAccess,
    },
  };
  const regularizationService = new AttendanceRegularizationService(context);
  const leaveService = new LeaveService(context);
  const wfhService = new WFHService(context);

  const shiftStartMinutes = parseClock(shift.startTime);
  const fullExpectedMinutes = (() => {
    const start = utcDay('2026-09-01');
    start.setUTCHours(Math.floor(shiftStartMinutes / 60), shiftStartMinutes % 60, 0, 0);
    const endMinutes = parseClock(shift.endTime);
    const end = utcDay('2026-09-01');
    end.setUTCHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    return getExpectedWorkMinutes(start, end);
  })();
  const halfExpectedMinutes = fullExpectedMinutes / 2;

  function shiftWindowFor(date: string): { day: Date; start: Date; end: Date } {
    const day = utcDay(date);
    const start = new Date(day);
    const end = new Date(day);
    const startMinutes = parseClock(shift.startTime);
    const endMinutes = parseClock(shift.endTime);
    // Shift configuration is treated as local Indian time by the production service.
    start.setUTCMinutes(startMinutes - 330);
    end.setUTCMinutes(endMinutes - 330);
    if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
    return { day, start, end };
  }

  async function createAttendance(
    date: string,
    sessions: Array<[number, number]>,
    needsRegularization = true,
  ): Promise<any> {
    const window = shiftWindowFor(date);
    const swipes = sessions.flatMap(([inOffset, outOffset]) => ([
      { timestamp: atOffset(window.start, inOffset), direction: 'IN', deviceId: qaBiometricId },
      { timestamp: atOffset(window.start, outOffset), direction: 'OUT', deviceId: qaBiometricId },
    ]));
    const workedMinutes = sessions.reduce((sum, [start, end]) => sum + (end - start), 0);
    return AttendanceRecord.create({
      userId: qaUser._id,
      shiftId: shift._id,
      shiftCode: shift.code,
      shiftDay: window.day,
      shiftStart: window.start,
      shiftEnd: window.end,
      swipes,
      firstIn: swipes[0]?.timestamp,
      lastOut: swipes[swipes.length - 1]?.timestamp,
      isWithinWindow: true,
      isLateEntry: false,
      isEarlyExit: workedMinutes < fullExpectedMinutes,
      isWFH: false,
      needsRegularization,
      totalWorkHours: duration(workedMinutes),
      breakHours: '00:00:00',
      actualWorkHours: duration(workedMinutes),
      shiftHours: duration(fullExpectedMinutes),
      shortfallHours: duration(Math.max(fullExpectedMinutes - workedMinutes, 0)),
      excessHours: duration(Math.max(workedMinutes - fullExpectedMinutes, 0)),
      attendanceStatus: ['Present'],
      status: swipes.length > 2 ? 'duplicate_swipes' : 'complete',
      outOfWindowSwipes: [],
    });
  }

  async function createLeave(date: string, halfDayType: 'first-half' | 'second-half', status = 'Pending'): Promise<any> {
    const sourceLeave = await Leave.findOne({ leaveTypeId: { $exists: true }, leaveType: { $nin: ['wfh', 'work_from_home'] } }).lean();
    const fallbackLov = await mongoose.connection.collection('lovs').findOne({
      type: { $in: ['leave_type', 'leavetype'] },
    });
    const leaveTypeId = sourceLeave?.leaveTypeId || fallbackLov?._id || new Types.ObjectId();
    const leaveType = sourceLeave?.leaveType || 'annual';
    return Leave.create({
      userId: qaUser._id,
      user: { name: qaUser.name, email: qaUser.email },
      leaveTypeId,
      leaveType,
      startDate: utcDay(date),
      endDate: utcDay(date),
      noOfDays: 0.5,
      status,
      reason: `QA ${halfDayType} leave for regularization integration test`,
      appliedTo: { _id: admin._id.toString(), name: admin.name },
      leaveDuration: 'half-day',
      halfDayType,
    });
  }

  async function approveLeave(leave: any): Promise<void> {
    await leaveService.updateStatus(leave._id, {
      status: 'Approved',
      approvedById: admin._id,
      approvedBy: { _id: admin._id, name: admin.name, email: admin.email },
    }, { sendEmails: false });
  }

  async function requestRegularization(
    date: string,
    attendance: any,
    targetMinutes: number,
  ): Promise<{ regularization: any; driftMinutes: number }> {
    const endClock = clock(shiftStartMinutes + targetMinutes);
    const response = await regularizationService.createBulkRegularization([{
      userId: qaUser._id.toString(),
      date,
      fromTime: shift.startTime,
      toTime: endClock,
      reason: `QA integration regularization ${date}`,
      shiftType: shift.code,
      attendanceId: attendance._id.toString(),
      approver: { id: admin._id.toString(), name: admin.name },
    }]);
    const item = response[0];
    assertThat(item?.success, item?.error || 'Bulk regularization did not return a successful result');
    const expectedFrom = shiftWindowFor(date).start;
    const driftMinutes = (new Date(item.regularization.from).getTime() - expectedFrom.getTime()) / 60_000;
    return { regularization: item.regularization, driftMinutes };
  }

  async function approveRegularization(regularization: any): Promise<any> {
    await regularizationService.updateRegularizationStatus(
      regularization._id,
      'Approved',
      { id: admin._id, name: admin.name },
      'QA integration approval',
      { sendEmails: false, backgroundEmails: false },
    );
    return AttendanceRecord.findById(regularization.attendanceId).lean();
  }

  await check('same-day regularization can be submitted and approved', async () => {
    const attendance = await createAttendance('2026-09-04', [[0, halfExpectedMinutes - 30]]);
    const requested = await requestRegularization('2026-09-04', attendance, fullExpectedMinutes);
    const pending = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(pending?.status === 'pending_regularization', `Expected pending_regularization, received ${pending?.status}`);
    const approved = await approveRegularization(requested.regularization);
    assertThat(approved?.regularization?.status === 'Approved', 'Attendance was not linked to an approved regularization');
    assertThat(hasStatus(approved, 'Regularized') && hasStatus(approved, 'Present'), 'Approved attendance is missing Regularized/Present');
    assertThat(approved?.needsRegularization === false, 'Approved attendance still requires regularization');
    assertThat(approved?.shortfallHours === '00:00:00', `Unexpected shortfall ${approved?.shortfallHours}`);
    assertThat(requested.driftMinutes === 0, `Stored request time drifted ${requested.driftMinutes} minutes from the shift start`);
    return 'Submitted on the current test date, approved, and closed without shortfall.';
  });

  await check('pending half-day leave does not prematurely reduce expected hours', async () => {
    const attendance = await createAttendance('2026-08-31', [[0, halfExpectedMinutes - 30]]);
    const leave = await createLeave('2026-08-31', 'second-half');
    const requested = await requestRegularization('2026-08-31', attendance, halfExpectedMinutes);
    const afterRegularization = await approveRegularization(requested.regularization);
    assertThat(afterRegularization?.shiftHours === duration(fullExpectedMinutes), `Pending leave reduced shift hours to ${afterRegularization?.shiftHours}`);
    assertThat(afterRegularization?.shortfallHours === duration(halfExpectedMinutes), `Expected full-day comparison before leave approval; got ${afterRegularization?.shortfallHours}`);
    await approveLeave(leave);
    const afterLeave = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(afterLeave?.shiftHours === duration(halfExpectedMinutes), `Approved leave did not reduce shift hours: ${afterLeave?.shiftHours}`);
    assertThat(afterLeave?.shortfallHours === '00:00:00', `Approved leave left a shortfall: ${afterLeave?.shortfallHours}`);
    assertThat(hasStatus(afterLeave, 'On-Leave') && hasStatus(afterLeave, 'Regularized'), 'Leave approval did not preserve regularization context');
    return 'Pending leave used full expectation; approval then recalculated the day to 50%.';
  });

  await check('approved half-day leave before regularization uses the 50% requirement', async () => {
    const attendance = await createAttendance('2026-09-01', [[0, Math.max(1, halfExpectedMinutes - 60)]]);
    const leave = await createLeave('2026-09-01', 'second-half');
    await approveLeave(leave);
    const before = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(before?.shortfallHours === duration(60), `Expected a 60-minute half-day shortfall, got ${before?.shortfallHours}`);
    const requested = await requestRegularization('2026-09-01', attendance, halfExpectedMinutes);
    const after = await approveRegularization(requested.regularization);
    assertThat(after?.shiftHours === duration(halfExpectedMinutes), `Expected half-day shift hours, got ${after?.shiftHours}`);
    assertThat(after?.shortfallHours === '00:00:00', `Regularization did not clear the half-day shortfall: ${after?.shortfallHours}`);
    assertThat(hasStatus(after, 'On-Leave') && hasStatus(after, 'Present') && hasStatus(after, 'Regularized'), 'Combined leave/attendance statuses were not preserved');
    return 'The regularization filled only the missing portion of the 50% expectation.';
  });

  await check('regularization before leave approval converges to the same final result', async () => {
    const attendance = await createAttendance('2026-09-02', [[0, Math.max(1, halfExpectedMinutes - 60)]]);
    const leave = await createLeave('2026-09-02', 'first-half');
    const requested = await requestRegularization('2026-09-02', attendance, halfExpectedMinutes);
    const beforeLeave = await approveRegularization(requested.regularization);
    assertThat(beforeLeave?.shortfallHours === duration(halfExpectedMinutes), `Expected full-day shortfall before approval, got ${beforeLeave?.shortfallHours}`);
    await approveLeave(leave);
    const afterLeave = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(afterLeave?.shiftHours === duration(halfExpectedMinutes), `Leave approval did not set half-day hours: ${afterLeave?.shiftHours}`);
    assertThat(afterLeave?.shortfallHours === '00:00:00', `Final result retained a shortfall: ${afterLeave?.shortfallHours}`);
    assertThat(hasStatus(afterLeave, 'On-Leave') && hasStatus(afterLeave, 'Regularized'), 'Final statuses lost leave or regularization');
    return 'Processing order did not change the final expected hours or status combination.';
  });

  await check('multiple biometric swipe history is preserved during half-day regularization', async () => {
    const firstSession = Math.min(120, halfExpectedMinutes / 2);
    const attendance = await createAttendance('2026-09-03', [
      [0, firstSession],
      [firstSession + 30, halfExpectedMinutes + 30],
    ]);
    const originalSwipeTimes = attendance.swipes.map((swipe: any) => new Date(swipe.timestamp).toISOString());
    const leave = await createLeave('2026-09-03', 'first-half');
    await approveLeave(leave);
    const requested = await requestRegularization('2026-09-03', attendance, halfExpectedMinutes);
    const after = await approveRegularization(requested.regularization);
    const afterSwipeTimes = after?.swipes.map((swipe: any) => new Date(swipe.timestamp).toISOString()) || [];
    assertThat(afterSwipeTimes.length === 4, `Expected 4 biometric swipes, received ${afterSwipeTimes.length}`);
    assertThat(JSON.stringify(afterSwipeTimes) === JSON.stringify(originalSwipeTimes), 'Biometric swipe timestamps changed during approval');
    assertThat(after?.swipes.every((swipe: any) => swipe.deviceId === qaBiometricId), 'Biometric swipes were replaced with manual swipes');
    assertThat(after?.shortfallHours === '00:00:00', `Unexpected multiple-swipe shortfall: ${after?.shortfallHours}`);
    return 'All four IN/OUT events remained intact and were recalculated against 50%.';
  });

  await check('flexible first-half leave permits sufficient morning work', async () => {
    const attendance = await createAttendance('2026-08-28', [[0, halfExpectedMinutes]], false);
    const leave = await createLeave('2026-08-28', 'first-half');
    await approveLeave(leave);
    const after = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(after?.shortfallHours === '00:00:00', `Morning work was incorrectly treated as short: ${after?.shortfallHours}`);
    assertThat(after?.shiftHours === duration(halfExpectedMinutes), `Expected 50% shift hours, got ${after?.shiftHours}`);
    assertThat(hasStatus(after, 'Present') && hasStatus(after, 'On-Leave'), 'Expected Present + On-Leave');
    return 'No fixed clock-half or lunch boundary rejected the valid worked duration.';
  });

  await check('duplicate pending regularization is rejected', async () => {
    const attendance = await createAttendance('2026-08-27', [[0, halfExpectedMinutes - 30]]);
    await requestRegularization('2026-08-27', attendance, fullExpectedMinutes);
    let duplicateError = '';
    try {
      await requestRegularization('2026-08-27', attendance, fullExpectedMinutes);
    } catch (error) {
      duplicateError = error instanceof Error ? error.message : String(error);
    }
    assertThat(/another regularization request exists/i.test(duplicateError), `Unexpected duplicate response: ${duplicateError || 'no error'}`);
    const count = await AttendanceRegularization.countDocuments({ userId: qaUser._id, shiftDay: utcDay('2026-08-27') });
    assertThat(count === 1, `Duplicate request created ${count} records`);
    return 'A second Pending request was blocked and no duplicate document was inserted.';
  });

  await check('rejection preserves swipe history and exits pending state', async () => {
    const attendance = await createAttendance('2026-08-26', [[0, halfExpectedMinutes - 30]]);
    const originalSwipeTimes = attendance.swipes.map((swipe: any) => new Date(swipe.timestamp).toISOString());
    const requested = await requestRegularization('2026-08-26', attendance, fullExpectedMinutes);
    await regularizationService.updateRegularizationStatus(
      requested.regularization._id,
      'Rejected',
      { id: admin._id, name: admin.name },
      'QA rejection check',
      { sendEmails: false, backgroundEmails: false },
    );
    const after = await AttendanceRecord.findById(attendance._id).lean();
    const afterSwipeTimes = after?.swipes.map((swipe: any) => new Date(swipe.timestamp).toISOString()) || [];
    assertThat(JSON.stringify(afterSwipeTimes) === JSON.stringify(originalSwipeTimes), 'Rejection changed the biometric swipe history');
    assertThat(!hasStatus(after, 'Pending-Regularization'), 'Attendance status still contains Pending-Regularization');
    assertThat(after?.status !== 'pending_regularization', 'Top-level attendance status remained pending_regularization after rejection');
    assertThat(after?.regularization?.status === 'Rejected-Absent', `Unexpected rejection state ${after?.regularization?.status}`);
    return 'Rejected request preserved swipes and restored a non-pending attendance state.';
  });

  await check('approved full-day leave still blocks regularization', async () => {
    const attendance = await createAttendance('2026-08-25', [[0, halfExpectedMinutes - 30]]);
    const sourceLeave = await Leave.findOne({ leaveTypeId: { $exists: true }, leaveType: { $nin: ['wfh', 'work_from_home'] } }).lean();
    const leave = await Leave.create({
      userId: qaUser._id,
      user: { name: qaUser.name, email: qaUser.email },
      leaveTypeId: sourceLeave?.leaveTypeId || new Types.ObjectId(),
      leaveType: sourceLeave?.leaveType || 'annual',
      startDate: utcDay('2026-08-25'),
      endDate: utcDay('2026-08-25'),
      noOfDays: 1,
      status: 'Pending',
      reason: 'QA full-day leave block test',
      appliedTo: { _id: admin._id.toString(), name: admin.name },
      leaveDuration: 'full-day',
    });
    await approveLeave(leave);
    let blockedError = '';
    try {
      await requestRegularization('2026-08-25', attendance, fullExpectedMinutes);
    } catch (error) {
      blockedError = error instanceof Error ? error.message : String(error);
    }
    assertThat(/full-day leave or absent/i.test(blockedError), `Unexpected full-day block response: ${blockedError || 'no error'}`);
    return 'The existing full-day leave restriction remained in place.';
  });

  await check('office half-day plus opposite-half WFH is accepted without rewriting attendance', async () => {
    const date = '2026-09-07';
    const attendance = await createAttendance(date, [[0, halfExpectedMinutes]], false);
    const before = await AttendanceRecord.findById(attendance._id).lean();
    const wfh = await wfhService.create({
      userId: qaUser._id,
      startDate: utcDay(date),
      endDate: utcDay(date),
      wfhDuration: 'half-day',
      halfDayType: 'second-half',
      reason: 'QA office first half and WFH second half',
      appliedOnBehalf: true,
      appliedTo: { _id: admin._id.toString(), name: admin.name },
    });
    await wfhService.updateStatus(wfh._id, {
      status: 'Approved',
      approvedById: admin._id,
      approvedBy: { _id: admin._id, name: admin.name, email: admin.email },
    });
    const savedWfh = await WFH.findById(wfh._id).lean();
    const after = await AttendanceRecord.findById(attendance._id).lean();
    assertThat(savedWfh?.status === 'Approved' && savedWfh.noOfDays === 0.5, 'Half-day WFH was not approved as 0.5 day');
    assertThat(after?.swipes.length === before?.swipes.length, 'WFH processing changed attendance swipe count');
    assertThat(after?.totalWorkHours === before?.totalWorkHours, 'WFH processing rewrote office work hours');
    return 'Second-half WFH was approved as 0.5 day and existing office attendance stayed intact.';
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  const finalCounts = {
    attendanceRecords: await AttendanceRecord.countDocuments({ userId: qaUser._id }),
    regularizations: await AttendanceRegularization.countDocuments({ userId: qaUser._id }),
    leaves: await Leave.countDocuments({ userId: qaUser._id }),
    wfhRequests: await WFH.countDocuments({ userId: qaUser._id }),
  };

  let cleanup: Record<string, number> | undefined;
  if (process.env.QA_REGRESSION_CLEANUP === 'true') {
    cleanup = {
      wfhs: (await WFH.deleteMany({ userId: qaUser._id })).deletedCount,
      attendanceRecords: (await AttendanceRecord.deleteMany({ userId: qaUser._id })).deletedCount,
      regularizations: (await AttendanceRegularization.deleteMany({ userId: qaUser._id })).deletedCount,
      shiftAssignments: (await ShiftAssignment.deleteMany({ userId: qaUser._id })).deletedCount,
      leaveSummaries: (await mongoose.connection.collection('leavesummaries').deleteMany({ userId: qaUser._id })).deletedCount,
      leaves: (await Leave.deleteMany({ userId: qaUser._id })).deletedCount,
      users: (await User.deleteOne({ _id: qaUser._id, name: qaName, employeeCode: qaEmployeeCode })).deletedCount,
    };
  }

  console.log = originalLog;
  originalLog(JSON.stringify({
    testUser: {
      id: qaUser._id.toString(),
      name: qaName,
      email: qaEmail,
      employeeCode: qaEmployeeCode,
      portalAccess: false,
    },
    shift: {
      code: shift.code,
      configuredHours: duration(fullExpectedMinutes),
      halfDayHours: duration(halfExpectedMinutes),
    },
    totals: {
      passed: results.filter(result => result.passed).length,
      failed: results.filter(result => !result.passed).length,
      checks: results.length,
    },
    finalCounts,
    cleanup,
    results,
  }, null, 2));
}

main()
  .catch(error => {
    console.log = originalLog;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
