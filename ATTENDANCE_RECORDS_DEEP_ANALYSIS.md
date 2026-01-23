# Deep Analysis: Attendance Records Creation and Update with Status

## Executive Summary

This document provides a comprehensive analysis of all scenarios where `attendancerecords` are created and updated, including the specific `status` and `attendanceStatus` values assigned in each case.

---

## Table of Contents

1. [Status Field Values](#status-field-values)
2. [AttendanceStatus Field Values](#attendancestatus-field-values)
3. [Scenario 1: Swipes In/Out](#scenario-1-swipes-inout)
4. [Scenario 2: Leave Apply/Approve/Reject](#scenario-2-leave-applyapprovereject)
5. [Scenario 3: Attendance Regularization](#scenario-3-attendance-regularization)
6. [Scenario 4: Restricted Holiday Apply/Approve/Reject](#scenario-4-restricted-holiday-applyapprovereject)
7. [Scenario 5: WFH (Work From Home)](#scenario-5-wfh-work-from-home)
8. [Additional Scenarios](#additional-scenarios)
9. [Status Transition Matrix](#status-transition-matrix)
10. [Pre-Save Hook Behavior](#pre-save-hook-behavior)

---

## Status Field Values

The `status` field can have the following values (as defined in the model):

```typescript
'incomplete' | 'complete' | 'duplicate_swipes' | 'missing_checkout' | 
'holiday_swipe' | 'leave_swipe' | 'pending_regularization' | 
'regularized' | 'overridden'
```

---

## AttendanceStatus Field Values

The `attendanceStatus` field is an array that can contain:

```typescript
('Present' | 'Late' | 'On-Time' | 'Early-Exit' | 'Absent' | 'On-Leave' | 
'Out-Of-Window' | 'Holiday-Swipe' | 'Pending-Regularization' | 
'Regularized' | 'OT' | 'Override')[]
```

---

## Scenario 1: Swipes In/Out

### Location
- **Service**: `src/services/biometric-attendance.service.ts`
- **Method**: `processSwipe()`, `findOrCreateAttendanceRecord()`, `processFirstSwipe()`, `processSecondSwipe()`, `processMultipleSwipes()`

### 1.1 Initial Record Creation (First Swipe)

**Trigger**: First biometric swipe (IN) of the day

**Code Location**: `findOrCreateAttendanceRecord()` (lines 340-440)

**Creation Logic**:
```typescript
record = await AttendanceRecord.create({
  userId,
  shiftId,
  shiftDay,
  shiftCode,
  shiftStart,
  shiftEnd,
  swipes: [],
  outOfWindowSwipes: [],
  needsRegularization: false,
  attendanceStatus: [],  // Empty initially
  isLateEntry: false,
  isEarlyExit: false,
  isWithinWindow: true,
  excessHours: '0:00:00',
  shortfallHours: '0:00:00',
  // status: NOT SET - relies on pre-save hook
});
```

**Holiday Detection** (if holiday found):
```typescript
if (holiday && isActuallyHoliday) {
  record.status = 'holiday_swipe';
  record.attendanceStatus = ['Holiday-Swipe'];
  record.regularization = {
    isRegularized: true,
    hasRegularizationRequest: false,
    regularizationType: ['Holiday-Swipe'],
    status: 'Approved',
    regularizationId: new Types.ObjectId(),
  };
}
```

**After First Swipe Processing** (`processFirstSwipe()` - lines 528-583):
```typescript
// Status set by pre-save hook: 'incomplete'
record.attendanceStatus = record.isLateEntry ? ['Late'] : ['On-Time'];
record.needsRegularization = true;  // Always true for incomplete
```

**Initial State After First Swipe**:
- `status`: `'incomplete'` (set by pre-save hook)
- `attendanceStatus`: `['Late']` or `['On-Time']`
- `swipes`: `[{timestamp, direction: 'IN', deviceId: 'biometric', location}]`
- `firstIn`: Set to swipe timestamp
- `needsRegularization`: `true`

### 1.2 Second Swipe (Complete Attendance)

**Trigger**: Second biometric swipe (OUT) of the day

**Code Location**: `processSecondSwipe()` (lines 585-658)

**Update Logic**:
```typescript
record.swipes.push(outSwipe);
record.lastOut = timestamp;
record.isEarlyExit = timestamp < earlyExitThreshold;

// Calculate metrics
const metrics = await this.calculateAttendanceMetrics(...);

// Update time fields
record.totalWorkHours = metrics.totalWorkHours;
record.breakHours = metrics.breakHours;
record.actualWorkHours = metrics.actualWorkHours;
record.shortfallHours = metrics.shortfallHours;
record.excessHours = metrics.excessHours;

// Update attendance status
if (record.isEarlyExit) {
  record.attendanceStatus.push('Early-Exit');
}
if (!record.attendanceStatus.includes('Present')) {
  record.attendanceStatus.push('Present');
}

// Update regularization flag
record.needsRegularization = 
  record.isLateEntry ||
  record.isEarlyExit ||
  metrics.hasShortfall ||
  !record.isWithinWindow;
```

**Status After Second Swipe**:
- `status`: `'complete'` (set by pre-save hook - exactly 2 swipes)
- `attendanceStatus`: 
  - Base: `['Present']`
  - If late: `['Late', 'Present']`
  - If early exit: `['Late', 'Present', 'Early-Exit']` or `['On-Time', 'Present', 'Early-Exit']`
  - If OT: `['Present', 'OT']` (added in metrics calculation)
- `swipes`: `[{IN}, {OUT}]`
- `needsRegularization`: Based on late/early/shortfall/window violations

### 1.3 Multiple Swipes (3+ Swipes)

**Trigger**: Third or subsequent swipe

**Code Location**: `processMultipleSwipes()` (lines 660-754)

**Update Logic**:
```typescript
record.swipes.push(newSwipe);

// Recalculate firstIn and lastOut from all swipes
const sortedSwipes = [...validSwipes].sort(...);
record.firstIn = firstInSwipe.timestamp;
record.lastOut = lastOutSwipe.timestamp;

// Calculate metrics using multiple swipe logic
const metrics = await this.calculateMultipleSwipeMetrics(...);

// Update attendance status
if (record.isLateEntry && !record.attendanceStatus.includes('Late')) {
  record.attendanceStatus = record.attendanceStatus.filter(s => s !== 'On-Time');
  record.attendanceStatus.push('Late');
}
if (record.isEarlyExit && !record.attendanceStatus.includes('Early-Exit')) {
  record.attendanceStatus.push('Early-Exit');
}
if (!record.attendanceStatus.includes('Present')) {
  record.attendanceStatus.push('Present');
}
```

**Status After Multiple Swipes**:
- `status`: `'duplicate_swipes'` (set by pre-save hook - 3+ swipes)
- `attendanceStatus`: Similar to second swipe, but preserves multiple swipe history
- `swipes`: `[{IN}, {OUT}, {IN}, {OUT}, ...]` (all swipes preserved)
- `needsRegularization`: Based on late/early/shortfall/window violations

### 1.4 Out-of-Window Swipes

**Trigger**: Swipe outside the shift window

**Code Location**: `processOutOfWindowSwipe()` (lines 801-839)

**Update Logic**:
```typescript
record.outOfWindowSwipes.push(outOfWindowSwipe);
record.needsRegularization = true;
if (!record.attendanceStatus.includes('Out-Of-Window')) {
  record.attendanceStatus.push('Out-Of-Window');
}
```

**Status**:
- `status`: Depends on total swipe count (pre-save hook)
- `attendanceStatus`: Includes `'Out-Of-Window'`
- `outOfWindowSwipes`: Contains the out-of-window swipe

---

## Scenario 2: Leave Apply/Approve/Reject

### Location
- **Service**: `src/services/leave.service.ts`
- **Method**: `updateStatus()` (lines 1325-1753)

### 2.1 Leave Approval

**Trigger**: Leave request status changed to `'Approved'`

**Code Location**: `leave.service.ts:1618-1685`

**Update Logic**:
```typescript
if (updateData.status === 'Approved') {
  const startDate = new Date(leave.startDate);
  const endDate = new Date(leave.endDate);
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const existingRecord = await AttendanceRecord.findOne({
      userId: leave.userId,
      shiftDay: currentDate,
    });

    const hasSwipes = existingRecord && existingRecord.swipes && existingRecord.swipes.length > 0;
    const isRestrictedHoliday = leave.leaveType === 'restricted_holiday';

    let updateFields: any = {
      updatedAt: new Date(),
      updatedBy: updateData.approvedById
    };

    if (isRestrictedHoliday && hasSwipes) {
      // Restricted Holiday WITH swipes
      updateFields.status = 'holiday_swipe';
      updateFields.attendanceStatus = ['Holiday-Swipe'];
      updateFields.regularization = {
        isRegularized: true,
        hasRegularizationRequest: false,
        regularizationType: ['Holiday-Swipe'],
        status: 'Approved',
        regularizationId: new Types.ObjectId(),
      };
    } else {
      // Regular leave OR Restricted Holiday WITHOUT swipes
      updateFields.attendanceStatus = ['On-Leave'];
      // Note: status is NOT explicitly set - may remain as existing value
    }

    await AttendanceRecord.findOneAndUpdate(
      { userId: leave.userId, shiftDay: currentDate },
      { $set: updateFields },
      { upsert: true, strict: false }
    );

    currentDate.setDate(currentDate.getDate() + 1);
  }
}
```

**Status Values**:

| Case | status | attendanceStatus | Notes |
|------|--------|------------------|-------|
| **Restricted Holiday + Has Swipes** | `'holiday_swipe'` | `['Holiday-Swipe']` | Swipes preserved, marked as holiday |
| **Restricted Holiday + No Swipes** | (unchanged) | `['On-Leave']` | No record may exist, created via upsert |
| **Regular Leave + Has Swipes** | (unchanged) | `['On-Leave']` | Existing swipes preserved |
| **Regular Leave + No Swipes** | (unchanged) | `['On-Leave']` | Record created via upsert |

**Important Notes**:
- If record doesn't exist, it's created via `upsert: true`
- Existing swipes are NOT deleted when leave is approved
- For restricted holiday with swipes, regularization is auto-approved

### 2.2 Leave Rejection/Cancellation

**Trigger**: Leave request status changed to `'Rejected'` or `'Cancelled'`

**Code Location**: `leave.service.ts:1687-1745`

**Update Logic**:
```typescript
if (updateData.status === 'Rejected' || updateData.status === 'Cancelled') {
  const startDate = new Date(leave.startDate);
  const endDate = new Date(leave.endDate);
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    await AttendanceRecord.findOneAndUpdate(
      {
        userId: leave.userId,
        shiftDay: currentDate,
        leaveRequestId: leave._id,  // Only update records linked to this leave
      },
      {
        $set: {
          attendanceStatus: ["Absent"],
          updatedAt: new Date(),
          updatedBy: updateData.rejectedById || updateData.approvedById,
        },
        $unset: {
          leaveRequestId: '',
        },
      },
      { strict: false }
    );

    currentDate.setDate(currentDate.getDate() + 1);
  }
}
```

**Status Values**:
- `status`: (unchanged)
- `attendanceStatus`: `['Absent']` (replaces previous values)
- `leaveRequestId`: Removed

**Important Notes**:
- Only updates records that have `leaveRequestId` matching the rejected leave
- If no record exists, no update occurs (no upsert)
- Previous attendance status is completely replaced with `['Absent']`

---

## Scenario 3: Attendance Regularization

### Location
- **Service**: `src/services/attendance-regularization.service.ts`
- **Methods**: `createRegularization()`, `createBulkRegularization()`, `updateRegularizationStatus()`, `handleApproval()`, `handleRejection()`, `withdrawRegularization()`

### 3.1 Regularization Request Creation

**Trigger**: Employee creates regularization request

**Code Location**: `createRegularization()` (lines 297-426), `createBulkRegularization()` (lines 429-691)

#### 3.1.1 Regularization for Existing Record

**Update Logic**:
```typescript
const attendance = await AttendanceRecord.findById(data.attendanceId);
if (attendance) {
  attendance.regularization = {
    hasRegularizationRequest: true,
    isRegularized: false,
    status: 'Pending',
    regularizationId: regularization._id,
  };
  await attendance.save();
}
```

**Status Values**:
- `status`: (unchanged - preserves existing status)
- `attendanceStatus`: (unchanged, but may have `'Pending-Regularization'` added in bulk)
- `regularization.hasRegularizationRequest`: `true`
- `regularization.isRegularized`: `false`
- `regularization.status`: `'Pending'`

#### 3.1.2 Regularization for Non-Existent Record (Bulk Only)

**Code Location**: `createBulkRegularization()` (lines 520-540)

**Creation Logic**:
```typescript
if (!attendance) {
  attendance = new AttendanceRecord({
    userId: new Types.ObjectId(userId),
    shiftId: shiftAssignment.shiftId,
    shiftCode: shiftAssignment.shiftCode,
    shiftDay,
    shiftStart: shiftWindow.shiftStart,
    shiftEnd: shiftWindow.shiftEnd,
    swipes: [],
    attendanceStatus: ['Pending-Regularization'],
    needsRegularization: true,
    isWithinWindow: true,
    totalWorkHours: '00:00:00',
    breakHours: '00:00:00',
    actualWorkHours: '00:00:00',
    shortfallHours: '00:00:00',
    excessHours: '00:00:00',
    status: 'incomplete',
  });
  await attendance.save();
} else {
  if (!attendance.attendanceStatus.includes('Pending-Regularization')) {
    attendance.attendanceStatus.push('Pending-Regularization');
  }
  attendance.needsRegularization = true;
}
```

**Status Values**:
- `status`: `'incomplete'` (new record) or (unchanged for existing)
- `attendanceStatus`: `['Pending-Regularization']` (new) or includes `'Pending-Regularization'` (existing)
- `needsRegularization`: `true`

### 3.2 Regularization Approval

**Trigger**: Manager/Admin approves regularization request

**Code Location**: `handleApproval()` (lines 974-1106)

**Update Logic**:
```typescript
// Remove 'Pending-Regularization' from attendanceStatus
attendanceRecord.attendanceStatus = attendanceRecord.attendanceStatus.filter(
  (status) => status !== 'Pending-Regularization'
);

// Handle existing swipes vs new regularization
const hasExistingBiometricSwipes = attendanceRecord.swipes &&
  attendanceRecord.swipes.length > 0 &&
  attendanceRecord.swipes.some(s => s.deviceId !== 'manual');

if (hasExistingBiometricSwipes && attendanceRecord.swipes.length > 2) {
  // Multiple swipes exist - preserve them
  attendanceRecord.firstIn = regularization.from;
  attendanceRecord.lastOut = regularization.to;
  // Recalculate metrics using multiple swipe logic
  metrics = await this.calculateMultipleSwipeMetrics(...);
} else {
  // Replace with regularization swipes
  attendanceRecord.firstIn = regularization.from;
  attendanceRecord.lastOut = regularization.to;
  attendanceRecord.swipes = [
    { timestamp: regularization.from, direction: 'IN', deviceId: 'manual', ... },
    { timestamp: regularization.to, direction: 'OUT', deviceId: 'manual', ... },
  ];
  metrics = await this.calculateAttendanceMetrics(...);
}

// Update all time-related fields
attendanceRecord.totalWorkHours = metrics.totalWorkHours;
attendanceRecord.breakHours = metrics.breakHours;
attendanceRecord.actualWorkHours = metrics.actualWorkHours;
attendanceRecord.shortfallHours = metrics.shortfallHours;
attendanceRecord.excessHours = metrics.excessHours;

// Update attendance status
if (!attendanceRecord.attendanceStatus.includes('Regularized')) {
  attendanceRecord.attendanceStatus.push('Regularized');
}
if (!attendanceRecord.attendanceStatus.includes('Present')) {
  attendanceRecord.attendanceStatus.push('Present');
}

attendanceRecord.status = 'complete';
attendanceRecord.needsRegularization = false;

// Update regularization status
attendanceRecord.regularization = {
  hasRegularizationRequest: true,
  isRegularized: true,
  status: 'Approved',
  regularizationId: regularization._id,
  regularizedAt: new Date(),
  regularizedBy: regularization.approver?.id ? new Types.ObjectId(regularization.approver.id) : undefined,
};
```

**Status Values**:
- `status`: `'complete'`
- `attendanceStatus`: 
  - Removed: `'Pending-Regularization'`
  - Added: `'Regularized'`, `'Present'`
  - Preserved: Other existing statuses (e.g., `'Late'`, `'Early-Exit'`, `'OT'`)
- `regularization.isRegularized`: `true`
- `regularization.status`: `'Approved'`
- `needsRegularization`: `false`

### 3.3 Regularization Rejection

**Trigger**: Manager/Admin rejects regularization request

**Code Location**: `handleRejection()` (lines 866-885), `processLeaveOrAbsent()` (lines 888-950)

**Update Logic**:
```typescript
// Remove 'Pending-Regularization' from attendanceStatus
attendanceRecord.attendanceStatus = attendanceRecord.attendanceStatus.filter(
  (status: string) => status !== 'Pending-Regularization'
);

// Check leave balance (currently disabled - always false)
const hasLeaveBalance = false;

if (hasLeaveBalance) {
  // Update leave balance and mark as on-leave
  attendanceRecord.attendanceStatus = ['On-Leave'];
} else {
  // Mark as Absent if no leave balance
  if (!attendanceRecord.attendanceStatus.includes('Absent')) {
    attendanceRecord.attendanceStatus.push('Absent');
  }
}

// Update regularization status
attendanceRecord.regularization = {
  hasRegularizationRequest: true,
  isRegularized: false,
  status: 'Rejected-Absent',  // or 'Rejected-Leave' if leave balance exists
  regularizationId: regularization._id,
  remarks: regularization.comments || "Rejected",
};

// Set all time-related fields to zero
attendanceRecord.totalWorkHours = '00:00:00';
attendanceRecord.breakHours = '00:00:00';
attendanceRecord.actualWorkHours = '00:00:00';
attendanceRecord.shortfallHours = '00:00:00';
attendanceRecord.excessHours = '00:00:00';
```

**Status Values**:
- `status`: (unchanged)
- `attendanceStatus`: 
  - Removed: `'Pending-Regularization'`
  - Added: `'Absent'` (or `'On-Leave'` if leave balance exists)
- `regularization.isRegularized`: `false`
- `regularization.status`: `'Rejected-Absent'` or `'Rejected-Leave'`
- All time fields: `'00:00:00'`

### 3.4 Regularization Withdrawal

**Trigger**: Employee withdraws pending regularization request

**Code Location**: `withdrawRegularization()` (lines 1108-1154)

**Update Logic**:
```typescript
// Remove Pending-Regularization from attendanceStatus
attendance.attendanceStatus = attendance.attendanceStatus.filter(
  (status: string) => status !== 'Pending-Regularization'
);

attendance.regularization = undefined;
attendance.needsRegularization = true;  // Allow new regularization requests
```

**Status Values**:
- `status`: (unchanged)
- `attendanceStatus`: `'Pending-Regularization'` removed
- `regularization`: `undefined`
- `needsRegularization`: `true`

---

## Scenario 4: Restricted Holiday Apply/Approve/Reject

### Location
- **Service**: `src/services/optional-holiday.service.ts`
- **Method**: `updateStatus()` (lines 554-777)

**Note**: Restricted holidays can be applied via:
1. **Optional Holiday Request** (`OptionalHolidayRequest` collection)
2. **Leave Request** with `leaveType: 'restricted_holiday'` (handled in Scenario 2)

### 4.1 Optional Holiday Approval

**Trigger**: Optional holiday request status changed to `'Approved'`

**Code Location**: `optional-holiday.service.ts:593-634`

**Update Logic**:
```typescript
if (updateData.status === 'Approved') {
  const existingRecord = await AttendanceRecord.findOne({
    userId: request.userId,
    shiftDay: request.holidayDate
  });

  if (existingRecord && existingRecord.swipes && existingRecord.swipes.length > 0) {
    // Retroactively update attendance record if swipes exist
    existingRecord.status = 'holiday_swipe';
    if (!existingRecord.attendanceStatus.includes('Holiday-Swipe')) {
      existingRecord.attendanceStatus.push('Holiday-Swipe');
    }

    // Initialize or update regularization for holiday swipe
    if (!existingRecord.regularization) {
      existingRecord.regularization = {
        isRegularized: true,
        hasRegularizationRequest: false,
        regularizationType: ['Holiday-Swipe'],
        status: 'Approved',
        regularizationId: new Types.ObjectId(),
      };
    } else {
      const reg = existingRecord.regularization;
      reg.isRegularized = true;
      reg.status = 'Approved';
      if (!reg.regularizationType) {
        reg.regularizationType = ['Holiday-Swipe'];
      } else if (!reg.regularizationType.includes('Holiday-Swipe')) {
        reg.regularizationType.push('Holiday-Swipe');
      }
      existingRecord.regularization = reg;
    }

    await existingRecord.save();
  }
}
```

**Status Values**:

| Case | status | attendanceStatus | Notes |
|------|--------|-----------------|-------|
| **Has Swipes** | `'holiday_swipe'` | Includes `'Holiday-Swipe'` | Swipes preserved, marked as holiday |
| **No Swipes** | (unchanged) | (unchanged) | No attendance record update |

**Important Notes**:
- Only updates if attendance record exists AND has swipes
- If no record exists or no swipes, no update occurs
- Swipes are preserved, not deleted
- Regularization is auto-approved

### 4.2 Optional Holiday Rejection

**Trigger**: Optional holiday request status changed to `'Rejected'`

**Code Location**: `optional-holiday.service.ts:554-777`

**Update Logic**:
- **No attendance record update** - only updates `OptionalHolidayRequest` status
- Attendance records remain unchanged

**Status Values**:
- `status`: (unchanged)
- `attendanceStatus`: (unchanged)

---

## Scenario 5: WFH (Work From Home)

### Location
- **Service**: `src/services/wfh.service.ts`
- **Method**: `create()`, `updateStatus()`

### Important Finding

**WFH does NOT create or update attendance records.**

WFH is tracked separately in:
- `WFH` collection (separate from attendance)
- `LeaveSummary.workFromHome` category

**No attendance record operations occur** when:
- WFH is created
- WFH is approved
- WFH is rejected
- WFH is cancelled

**Rationale**: WFH is a permission/approval system, not an attendance tracking system. Employees on WFH may still need to swipe or may not be required to swipe depending on company policy.

---

## Additional Scenarios

### 6.1 Bulk Attendance Upload

**Location**: `src/services/bulk-attendance-upload.service.ts`

**Trigger**: Admin uploads bulk attendance CSV/Excel file

**Creation Logic**:
```typescript
const attendanceRecord = new AttendanceRecord({
  userId: new Types.ObjectId(row.userId),
  shiftId: shiftAssignmentId,
  shiftCode: row.shiftCode,
  shiftDay,
  shiftStart: shiftStartUTC,
  shiftEnd: adjustedShiftEndUTC,
  swipes,  // Pre-populated from file
  firstIn: inTimeUTC,
  lastOut: adjustedOutTimeUTC,
  isWithinWindow: hasOvertime ? true : isWithinWindow,
  isLateEntry,
  isEarlyExit,
  needsRegularization: false,
  totalWorkHours,
  breakHours: '0:00:00',
  actualWorkHours: totalWorkHours,
  shiftHours,
  shortfallHours: '0:00:00',
  excessHours: hasOvertime ? formatOvertimeHours(overtimeHours) : '0:00:00',
  overtimeStart: hasOvertime ? adjustedShiftEndUTC : undefined,
  overtimeEnd: hasOvertime ? adjustedOutTimeUTC : undefined,
  status,  // 'complete' or 'duplicate_swipes'
  attendanceStatus,  // Array built from conditions
  outOfWindowSwipes: [],
  regularization: {
    isRegularized: false,
    hasRegularizationRequest: false,
    status: 'Pending'
  }
});
```

**Status Values**:
- `status`: `'complete'` (if 2 swipes) or `'duplicate_swipes'` (if 3+ swipes)
- `attendanceStatus`: Array built from:
  - `'Late'` (if `isLateEntry`)
  - `'Early-Exit'` (if `isEarlyExit`)
  - `'OT'` (if `hasOvertime`)
  - `'Present'` (always added)
  - `'Holiday-Swipe'` (if `isHoliday`)

### 6.2 Attendance Override

**Location**: `src/services/attendance-override.service.ts`

**Trigger**: Admin manually overrides attendance record

**Update Logic**:
```typescript
// Store original values
record.override = {
  isOverridden: true,
  overriddenAt: new Date(),
  overriddenBy: adminId,
  originalStatus: record.status,
  originalAttendanceStatus: [...record.attendanceStatus],
  originalFirstIn: record.firstIn,
  originalLastOut: record.lastOut,
  // ... other original values
};

// Update with override values
record.status = data.status;  // e.g., 'overridden'
record.attendanceStatus = data.attendanceStatus;  // Must include 'Override'
record.firstIn = new Date(data.firstIn);
record.lastOut = new Date(data.lastOut);
// ... other fields updated
```

**Status Values**:
- `status`: `'overridden'`
- `attendanceStatus`: Must include `'Override'`, plus other statuses (e.g., `['Override', 'Present']`)
- Original values stored in `override` object

### 6.3 Holiday Detection During Swipe

**Location**: `biometric-attendance.service.ts:375-437`

**Trigger**: Swipe occurs on a holiday date

**Update Logic** (within `findOrCreateAttendanceRecord()`):
```typescript
const holiday = await this.checkHolidayCalendar(userId, shiftDay);

if (holiday) {
  let isActuallyHoliday = true;

  // For optional holidays, check if user has approved request
  if (holiday.type === 'optional') {
    const approvedOptionalRequest = await OptionalHolidayRequest.findOne({...});
    const approvedLeaveRequest = await Leave.findOne({...});
    
    if (!approvedOptionalRequest && !approvedLeaveRequest) {
      isActuallyHoliday = false;  // Process as regular day
    }
  }

  if (isActuallyHoliday) {
    record.status = 'holiday_swipe';
    record.attendanceStatus = ['Holiday-Swipe'];
    record.regularization = {
      isRegularized: true,
      hasRegularizationRequest: false,
      regularizationType: ['Holiday-Swipe'],
      status: 'Approved',
      regularizationId: new Types.ObjectId(),
    };
    await record.save();
  }
}
```

**Status Values**:
- `status`: `'holiday_swipe'`
- `attendanceStatus`: `['Holiday-Swipe']`
- `regularization.isRegularized`: `true`
- `regularization.status`: `'Approved'`

---

## Status Transition Matrix

| From Status | To Status | Trigger | Notes |
|-------------|-----------|---------|-------|
| (none) | `'incomplete'` | First swipe | Pre-save hook |
| `'incomplete'` | `'complete'` | Second swipe (exactly 2) | Pre-save hook |
| `'incomplete'` | `'duplicate_swipes'` | Third+ swipe | Pre-save hook |
| `'complete'` | `'duplicate_swipes'` | Third+ swipe | Pre-save hook |
| Any | `'holiday_swipe'` | Holiday detected OR Restricted holiday approved with swipes | Manual set |
| Any | `'leave_swipe'` | Leave approved (restricted holiday without swipes) | Manual set |
| Any | `'pending_regularization'` | Regularization request created | Manual set |
| `'pending_regularization'` | `'regularized'` | Regularization approved | Manual set |
| Any | `'overridden'` | Admin override | Manual set |

---

## Pre-Save Hook Behavior

**Location**: `src/models/attendance-record.model.ts:358-388`

**Trigger**: Record is saved AND `swipes` field is modified

**Logic**:
```typescript
attendanceRecordSchema.pre('save', function (next) {
  // Only update status if swipes are modified
  if (!this.isModified('swipes')) {
    return next();
  }

  // Preserve special statuses
  const specialStatuses = ['holiday_swipe', 'leave_swipe', 'overridden', 'regularized', 'pending_regularization'];
  if (this.status && specialStatuses.includes(this.status)) {
    return next();  // Don't override special statuses
  }

  // Sort swipes by timestamp
  this.swipes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Filter valid swipes
  const validSwipes = this.swipes.filter(s => s.direction === 'IN' || s.direction === 'OUT');

  // Set status based on count
  if (validSwipes.length < 2) {
    this.status = 'incomplete';
  } else if (validSwipes.length === 2) {
    this.status = 'complete';
  } else {
    this.status = 'duplicate_swipes';
  }

  next();
});
```

**Important Notes**:
- Hook only runs if `swipes` field is modified
- Special statuses are preserved and NOT overridden by hook
- Status is based on count of valid swipes (with direction IN/OUT)

---

## Summary Table: All Scenarios

| Scenario | Creates Record? | Updates Record? | status Value | attendanceStatus Values | Key Conditions |
|----------|----------------|-----------------|-------------|------------------------|----------------|
| **First Swipe** | ✅ | ❌ | `'incomplete'` | `['Late']` or `['On-Time']` | Pre-save hook |
| **Second Swipe** | ❌ | ✅ | `'complete'` | `['Present']` + optional `['Late']`, `['Early-Exit']`, `['OT']` | Pre-save hook |
| **Multiple Swipes** | ❌ | ✅ | `'duplicate_swipes'` | `['Present']` + optional statuses | Pre-save hook |
| **Leave Approved (Regular)** | ✅ (upsert) | ✅ | (unchanged) | `['On-Leave']` | No swipes or has swipes |
| **Leave Approved (Restricted + Swipes)** | ✅ (upsert) | ✅ | `'holiday_swipe'` | `['Holiday-Swipe']` | Has swipes |
| **Leave Approved (Restricted + No Swipes)** | ✅ (upsert) | ✅ | (unchanged) | `['On-Leave']` | No swipes |
| **Leave Rejected** | ❌ | ✅ | (unchanged) | `['Absent']` | Only if record exists with leaveRequestId |
| **Regularization Created** | ✅ (bulk only) | ✅ | `'incomplete'` (new) or (unchanged) | Includes `'Pending-Regularization'` | Existing or new record |
| **Regularization Approved** | ❌ | ✅ | `'complete'` | `['Regularized', 'Present']` + preserved statuses | Replaces or preserves swipes |
| **Regularization Rejected** | ❌ | ✅ | (unchanged) | `['Absent']` or `['On-Leave']` | Time fields reset to zero |
| **Regularization Withdrawn** | ❌ | ✅ | (unchanged) | Removes `'Pending-Regularization'` | Regularization cleared |
| **Optional Holiday Approved + Swipes** | ❌ | ✅ | `'holiday_swipe'` | Includes `['Holiday-Swipe']` | Only if record exists with swipes |
| **Optional Holiday Approved + No Swipes** | ❌ | ❌ | (unchanged) | (unchanged) | No update if no record/swipes |
| **Optional Holiday Rejected** | ❌ | ❌ | (unchanged) | (unchanged) | No attendance update |
| **Holiday Detected (Swipe)** | ✅ | ✅ | `'holiday_swipe'` | `['Holiday-Swipe']` | During swipe processing |
| **Bulk Upload** | ✅ | ❌ | `'complete'` or `'duplicate_swipes'` | Array from conditions | Pre-populated from file |
| **Override** | ❌ | ✅ | `'overridden'` | Must include `'Override'` | Admin manual override |
| **WFH** | ❌ | ❌ | N/A | N/A | No attendance record operations |

---

## Key Insights

1. **Pre-Save Hook**: Automatically sets `status` based on swipe count, but preserves special statuses (`holiday_swipe`, `leave_swipe`, `overridden`, `regularized`, `pending_regularization`).

2. **Leave Approval**: Creates records via `upsert: true` if they don't exist. For restricted holidays with swipes, sets `status: 'holiday_swipe'`.

3. **Regularization**: Can create new records (bulk only) or update existing ones. Approval sets `status: 'complete'` and adds `'Regularized'` and `'Present'` to `attendanceStatus`.

4. **Restricted Holiday**: Two paths:
   - Via Optional Holiday Request: Only updates if record exists with swipes
   - Via Leave Request: Handles both with/without swipes cases

5. **WFH**: Does NOT interact with attendance records at all.

6. **Status Preservation**: Special statuses are preserved by pre-save hook, preventing accidental overwrites.

7. **Multiple Swipes**: All swipes are preserved, and metrics are recalculated using multiple swipe logic.

8. **Holiday Swipe**: Auto-regularized with `status: 'Approved'` in regularization object.

---

## Recommendations

1. **Consistency**: Consider explicitly setting `status` during leave approval for all cases, not just restricted holidays with swipes.

2. **WFH Integration**: If WFH should affect attendance, add logic to create/update attendance records on WFH approval.

3. **Leave Rejection**: Currently only updates records with `leaveRequestId`. Consider broader matching criteria.

4. **Regularization Rejection**: Currently always sets to `'Absent'` (leave balance check disabled). Re-enable leave balance check if needed.

5. **Documentation**: Add comments explaining why certain statuses are preserved vs. overwritten.

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Author**: AI Analysis  
**Review Status**: Pending
