# Resignation → Payroll → Final Settlement: Complete Integration Flow

## Table of Contents
1. [Current State Analysis](#current-state-analysis)
2. [Proposed Integrated Flow](#proposed-integrated-flow)
3. [Data Models & Schema Changes](#data-models--schema-changes)
4. [Service Methods & Implementation](#service-methods--implementation)
5. [API Routes & Endpoints](#api-routes--endpoints)
6. [Calculation Logic](#calculation-logic)
7. [Email Notifications](#email-notifications)

---

## ⚠️ IMPORTANT: Key Business Rules

### 1. LWD Month Payroll Creation
**Question**: If Jan payroll is EXCLUDED, does final settlement create payroll for Jan?

**Answer**: ✅ **YES**
- Jan payroll is EXCLUDED from normal payroll generation (because LWD = Jan 31)
- When final settlement is confirmed (on Feb 1), it **CREATES a new payroll record for Jan month**
- This Jan payroll contains final settlement calculations (net amount from settlement)
- Status: `Completed` (auto-completed)
- Flag: `isFinalSettlement = true`

**Example Flow**:
```
LWD = Jan 31
├─ Nov payroll: ✅ Created normally
├─ Dec payroll: ✅ Created with isSalaryHold = true (marked RED)
├─ Jan payroll: ❌ EXCLUDED from normal payroll generation
└─ Final Settlement (Feb 1): ✅ CREATES payroll for Jan month with final settlement calculations
```

### 2. Pending Resignation Control
**Question**: If employee applies resignation in Nov, but HR approves only on Dec 20 (LWD = Jan 31), can HR hold Dec payroll?

**Answer**: ✅ **YES - This is now supported**
- When resignation is **PENDING** (not yet approved), employee is **INCLUDED** in payroll
- Payroll record is marked with `isPendingResignation = true`
- In payroll draft screen:
  - Employee name shown in **ORANGE/YELLOW** (warning color)
  - Tag: **"Pending Resignation"**
  - Shows preferred LWD (if provided by employee)
  - HR can see and decide whether to process or hold Dec payroll
- HR has full control to exclude/include employees with pending resignations

**Example Scenario**:
```
Nov 15: Employee applies resignation (Status: Pending, Preferred LWD: Jan 31)
Nov 30: HR generates Nov payroll → Employee included with isPendingResignation = true (ORANGE)
Dec 20: HR approves resignation (Status: Approved, Approved LWD: Jan 31)
Dec 31: HR generates Dec payroll → Employee included with isSalaryHold = true (RED)
        → Dec payroll created but on hold (not paid)
Jan 31: Jan payroll EXCLUDED (final settlement handles)
Feb 1: Final settlement CREATES payroll for Jan month
        → HR can see Dec on-hold payroll in final settlement worksheet
        → HR can choose to include Dec payroll in final settlement (checkbox)
        → If included: Dec payroll + Jan final settlement = total payment
        → If not included: Only Jan final settlement paid, Dec payroll remains on hold
```

**Key Points**:
- ✅ Pending resignations are visible in payroll draft screen
- ✅ HR can see preferred LWD even before approval
- ✅ HR can decide to hold payroll for pending resignations
- ✅ System marks pending resignations with warning (ORANGE color)
- ✅ After approval, it switches to approved resignation logic (RED color)

### 3. On-Hold Payrolls in Final Settlement
**Question**: Can we get on-hold payroll data in final settlement?

**Answer**: ✅ **YES - This is now supported**
- When final settlement is created, system automatically fetches all on-hold payrolls
- On-hold payrolls are payrolls with `isSalaryHold = true` that haven't been completed
- In final settlement worksheet:
  - HR can see list of all on-hold payrolls (month, year, net salary, status)
  - Shows total on-hold amount
  - Checkbox: "Include On-Hold Payrolls in Final Settlement"
  - If checked: Adds total on-hold amount to total payable
  - If unchecked: On-hold payrolls remain unpaid (can be processed separately later)
- When final settlement is confirmed with on-hold payrolls included:
  - On-hold payrolls are marked as `Completed`
  - `isSalaryHold` flag is removed
  - Payment confirmed date is set

**Example Scenario**:
```
Dec 31: HR generates Dec payroll → isSalaryHold = true (on hold, not paid)
Jan 31: Jan payroll EXCLUDED (final settlement handles)
Feb 1: Final settlement created → Shows Dec on-hold payroll
        → HR sees: Dec 2024 - Net Salary: ₹50,000 - Status: Draft
        → Total On-Hold Amount: ₹50,000
        → HR checks "Include On-Hold Payrolls" checkbox
        → Final Settlement Total Payable = Jan salary + Leave encashment + ₹50,000 (Dec payroll)
        → When confirmed: Dec payroll marked as Completed, Jan payroll created
```

### 4. Complex Resignation Scenarios

#### **Scenario 1: Short Notice Period (Same Day or Immediate Resignation)**

**Example**: Employee applies resignation on Dec 8th (got Nov salary), wants to resign from Dec 15th

**Option 1: No Hold Salary - Immediate Final Settlement**
- ✅ **Supported**: HR can trigger final settlement on Dec 15th (same day as LWD)
- ✅ **Supported**: Payroll generated for Dec 15 (partial month - Dec 1 to Dec 15)
- ✅ **Supported**: HR can initiate final settlement on Dec 15th OR later (Jan 5th or after 4 weeks)
- ✅ **Status Tracking**: Final settlement has status field (`Draft`, `Confirmed`) to track when it can be initiated
- **Flow**:
  ```
  Dec 8: Employee applies resignation (Preferred LWD: Dec 15)
  Dec 8: HR approves resignation (Approved LWD: Dec 15, salaryHold: false)
  Dec 15: HR triggers final settlement → Creates payroll for Dec 1-15
  OR
  Jan 5: HR triggers final settlement → Creates payroll for Dec 1-15 (late initiation)
  ```

**Option 2: Buyout Amount (Employee Pays to Leave Early)**
- ✅ **Supported**: Buyout option in final settlement (`noticePeriodDecision = 'buyout'`)
- ✅ **Supported**: HR can configure buyout amount manually
- ✅ **Supported**: Leave encashment is configurable (HR can set to 0 or any amount)
- **Flow**:
  ```
  Dec 8: Employee applies resignation (Preferred LWD: Dec 15)
  Dec 8: HR approves resignation (Approved LWD: Dec 15)
  Dec 15: HR triggers final settlement
  → HR selects "Buyout" option
  → HR enters buyout amount (e.g., ₹20,000)
  → HR can adjust leave encashment (set to 0 or any amount)
  → Final settlement: Employee pays buyout amount
  ```

#### **Scenario 2: Full Notice Period (30 Days Notice Served)**

**Example**: Employee applies resignation on Dec 8th (got Nov salary), wants to resign from Jan 8th (30 days notice)

**Option 1: Hold Dec Salary, Process in Jan**
- ✅ **Supported**: Dec payroll created with `isSalaryHold = true`
- ✅ **Supported**: On Jan 5th, HR processes Dec payroll (can untick hold and pay)
- ✅ **Supported**: On Jan 9th, HR triggers final settlement for Jan month
- ✅ **Supported**: Final settlement creates payroll for Jan month
- **Flow**:
  ```
  Dec 8: Employee applies resignation (Preferred LWD: Jan 8)
  Dec 8: HR approves resignation (Approved LWD: Jan 8, salaryHold: true)
  Dec 31: HR generates Dec payroll → isSalaryHold = true (on hold)
  Jan 5: HR can process Dec payroll (untick hold) OR keep on hold
  Jan 9: HR triggers final settlement → Creates payroll for Jan 1-8
  → If Dec payroll on hold: HR can include it in final settlement
  → Final settlement = Dec payroll (if included) + Jan partial salary + Leave encashment
  ```

**Option 2: Hold Dec Salary, Deduct in Final Settlement**
- ✅ **Supported**: Dec payroll on hold (`isSalaryHold = true`)
- ✅ **Supported**: Final settlement includes Dec on-hold payroll
- ✅ **Supported**: Notice period recovery calculation
- ✅ **Supported**: Negative amount handling (employee pays or set to 0)
- **Flow**:
  ```
  Dec 8: Employee applies resignation (Preferred LWD: Jan 8)
  Dec 8: HR approves resignation (Approved LWD: Jan 8, salaryHold: true)
  Dec 31: HR generates Dec payroll → isSalaryHold = true (on hold, ₹50,000)
  Jan 9: HR triggers final settlement
  → HR includes Dec on-hold payroll (₹50,000)
  → Jan partial salary (8 days): ₹13,333
  → Leave encashment: ₹5,000
  → Notice period recovery: ₹20,000 (if shortfall)
  → Total Payable: ₹50,000 + ₹13,333 + ₹5,000 = ₹68,333
  → Total Deduction: ₹20,000
  → Net Amount: ₹48,333 (positive = pay employee)
  
  OR if deductions exceed payable:
  → Total Payable: ₹50,000 + ₹13,333 = ₹63,333
  → Total Deduction: ₹70,000 (recovery + other deductions)
  → Net Amount: -₹6,667 (negative = employee pays)
  → HR can either:
     a) Set to 0 (skip recovery)
     b) Keep negative (employee pays company)
  ```

#### **Negative Amount Handling**

**When Net Amount is Negative:**
- ✅ **Supported**: System calculates negative net amount
- ✅ **HR Options**:
  1. **Set to 0**: HR can manually adjust deductions to make net amount = 0
  2. **Keep Negative**: Employee pays the amount to company
  3. **Partial Recovery**: HR can reduce recovery amount to minimize negative
- **Implementation**: HR can edit `recoveryAmount`, `otherDeductions`, or `buyoutAmount` in final settlement worksheet

---

## 1. Current State Analysis

### 1.1 Existing Resignation Flow (Standalone)
**Location**: `src/services/user.service.ts` (Lines 888-1084)

**Current Methods:**
- `applyResignation()` - Employee submits resignation
- `approveResignation()` - HR approves with notice period
- `rejectResignation()` - HR rejects resignation
- `withdrawResignation()` - Employee withdraws before approval

**Current Data Structure** (in User model):
```typescript
resignations: [{
  status: 'Pending' | 'Approved' | 'Rejected' | 'Withdrawn'
  summary: string
  remarks: string
  submittedAt: Date
  approvedAt: Date
  rejectedAt: Date
  withdrawnAt: Date
  approvedBy: ObjectId
  noticePeriodDays: number
  preferredLastWorkingDay: Date
  approvedLastWorkingDay: Date
  finalSettlementDone: boolean
  isActive: boolean
}]
```

**Current Issues:**
- ❌ Not linked to payroll module
- ❌ No salary hold mechanism
- ❌ No final settlement calculation
- ❌ No automatic deactivation on LWD
- ❌ No integration with payroll status

### 1.2 Existing Payroll Filtering
**Location**: `src/services/payroll.service.ts` (Lines 402-528)

**Current Status Filtering:**
- "Active": `active: true`
- "On Hold": `active: true` + pending resignation
- "Resigned": Approved resignation exists

**Current Limitation:**
- Only filters users, doesn't prevent payroll generation
- No salary hold checkbox mechanism
- No visual highlighting in payroll UI

---

## 2. Proposed Integrated Flow

### 2.1 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    RESIGNATION FLOW                              │
└─────────────────────────────────────────────────────────────────┘

Step 1: Employee Submits Resignation
├─ POST /users/:id/resignation/apply
├─ Status: Pending
├─ Stores: summary, preferredLastWorkingDay
└─ Email: Notification to HR

Step 2: HR Approves/Rejects Resignation
├─ POST /users/:id/resignation/approve
│  ├─ Status: Approved
│  ├─ Sets: noticePeriodDays, approvedLastWorkingDay
│  └─ Email: Approval email to employee
│
└─ POST /users/:id/resignation/reject
   ├─ Status: Rejected
   └─ Email: Rejection email to employee

Step 3: Payroll Integration (NEW)
├─ When Resignation Approved:
│  ├─ User marked for "Salary Hold" (default)
│  ├─ In Payroll Draft Screen:
│  │  ├─ Employee name shown in RED (if salaryHold = true)
│  │  ├─ Tag: "Resigned – Salary Hold" (if salaryHold = true)
│  │  ├─ Payroll Status: "Draft" (can proceed through all stages)
│  │  └─ HR can process payroll normally (approve, in-payment, complete)
│  └─ Payroll record is CREATED but marked with salaryHold flag
│
└─ Payroll Generation Logic:
   ├─ Check resignation status
   ├─ If Approved + LWD not reached:
   │  ├─ CREATE payroll record (regardless of salaryHold)
   │  ├─ Mark payroll with isSalaryHold = true (if salaryHold = true)
   │  └─ Payroll can proceed through all stages (Draft → PendingApproval → InPayment → Completed)
   ├─ If Approved + LWD reached:
   │  └─ EXCLUDE from normal payroll (final settlement will handle)
   └─ Example Scenario:
      ├─ Resignation approved with LWD = Jan 31
      ├─ Nov payroll: CREATE normally (pay full month)
      ├─ Dec payroll: CREATE with isSalaryHold = true (marked RED, can still process)
      └─ Jan payroll: EXCLUDE from normal payroll generation
          └─ Final Settlement (on Feb 1): CREATES payroll for Jan month with final settlement calculations

Step 4: Last Working Day (LWD) Reached (MANUAL TRIGGER ONLY)
├─ Trigger: Manual entry by HR
├─ Route: POST /final-settlement/trigger/:userId
├─ HR Actions:
│  ├─ HR manually triggers when LWD is reached
│  ├─ Checks: approvedLastWorkingDay
│  ├─ Actions:
│  │  ├─ Set user.active = false
│  │  ├─ Create Final Settlement Draft
│  │  ├─ Auto-calculate initial values
│  │  └─ Email: Notification to HR + Employee
│  └─ Status: Ready for Final Settlement
└─ Note: HR has full control over when to trigger final settlement

Step 5: Final Settlement Worksheet (HR Screen)
├─ GET /final-settlement/:userId
├─ Single screen with all sections
├─ Auto-calculated fields (HR can edit)
├─ Three Notice Period Options (Radio Buttons):
│  ├─ Option 1: Apply Notice Period & Recover Shortfall
│  ├─ Option 2: No Notice Period (Pay only actual days)
│  └─ Option 3: Buyout (Employee pays to leave early)
└─ Actions:
   ├─ Save Draft
   ├─ Preview & Confirm (locks + generates PDF + sends email)
   └─ Cancel (only if draft)

Step 6: Final Settlement Confirmation
├─ Status: Confirmed & Locked
├─ Generate PDF
├─ Send email to employee + admin
├─ Process payroll (if exit month) OR create new payroll record
└─ Mark finalSettlementDone = true
```

### 2.2 Detailed Step-by-Step Flow

#### **Phase 1: Resignation Submission & Approval**

**1.1 Employee Submits Resignation**
- **Route**: `POST /users/:id/resignation/apply`
- **Service**: `userService.applyResignation()`
- **Actions**:
  - Validates no existing pending/approved resignation
  - Creates resignation record with status: "Pending"
  - Stores: summary, preferredLastWorkingDay, remarks
  - Sends email to HR
- **Status**: `resignations[].status = 'Pending'`

**1.2 HR Approves Resignation**
- **Route**: `POST /users/:id/resignation/approve`
- **Service**: `userService.approveResignation()`
- **Actions**:
  - Validates pending resignation exists
  - Updates status: "Approved"
  - Sets: noticePeriodDays, approvedLastWorkingDay
  - Sets: approvedBy, approvedAt
  - Sends approval email to employee
- **Status**: `resignations[].status = 'Approved'`, `isActive: true`
- **NEW**: Sets `salaryHold: true` (default)

**1.3 HR Rejects Resignation**
- **Route**: `POST /users/:id/resignation/reject`
- **Service**: `userService.rejectResignation()`
- **Actions**:
  - Updates status: "Rejected"
  - Sets: rejectedAt, approvedBy
  - Sends rejection email
- **Status**: `resignations[].status = 'Rejected'`, `isActive: false`

**1.4 Employee Withdraws Resignation**
- **Route**: `POST /users/:id/resignation/withdraw`
- **Service**: `userService.withdrawResignation()`
- **Actions**:
  - Only allowed if status is "Pending"
  - Updates status: "Withdrawn"
  - Sets: withdrawnAt
  - Sets: isActive = false
- **Status**: `resignations[].status = 'Withdrawn'`, `isActive: false`

#### **Phase 2: Payroll Integration**

**2.1 Payroll Generation with Salary Hold**

**Route**: `POST /payroll/generate`
**Service**: `payrollService.initiatePayroll()`

**Modified Flow**:
```
1. Validate monthYear format
2. Get User IDs (from filters or provided)
3. Check Existing Payroll (exclude blocked users)
4. Fetch Employees & Salary Assignments
5. Validate Employee-Salary Assignment Consistency
6. NEW: Check Resignation Status for Each Employee
   ├─ If resignation.status = 'Pending' (NOT YET APPROVED):
   │  ├─ INCLUDE in payroll BUT mark with isPendingResignation = true
   │  ├─ HR can see in payroll draft screen with warning tag
   │  ├─ HR can decide to exclude/include manually
   │  └─ This handles case: Employee applied in Nov, HR approves in Dec 20, LWD = Jan 31
   │      → HR can hold Dec payroll even before approval
   │
   ├─ If resignation.status = 'Approved' AND
   │     approvedLastWorkingDay > payroll month end:
   │  ├─ INCLUDE in payroll (CREATE payroll record)
   │  ├─ Mark payroll with isSalaryHold = true (if salaryHold = true)
   │  └─ Payroll can proceed through all stages normally
   │
   └─ If resignation.status = 'Approved' AND
        approvedLastWorkingDay <= payroll month end:
      └─ EXCLUDE (final settlement handles this month)
      
   Example: LWD = Jan 31, Resignation applied in Nov, Approved on Dec 20
   ├─ Nov payroll (Nov 30): CREATE with isPendingResignation = true (HR can hold)
   ├─ Dec payroll (Dec 31): CREATE with isSalaryHold = true (marked RED, can still process)
   └─ Jan payroll (Jan 31): EXCLUDE from normal payroll
       └─ Final Settlement (Feb 1): CREATES payroll for Jan with final settlement calculations
   
7. Process Payroll Records (for all included employees)
8. Insert Records with isSalaryHold flag
9. Calculate Summary
10. Return Summary with Status: Draft
```

**2.2 Payroll Draft Screen Display**

**Route**: `GET /payroll/summary?month=X&year=YYYY`
**Service**: `payrollService.getPayrollSummary()`

**Enhanced Response**:
```typescript
{
  totalEmployees: number,
  totalGrossSalary: number,
  // ... existing fields
  exportableDetails: [{
    employeeId: string,
    employeeName: string,
    status: string, // Draft, PendingApproval, InPayment, Completed, etc.
    // NEW FIELDS:
    resignationStatus?: 'Pending' | 'Approved' | null,
    isPendingResignation?: boolean, // From payroll record - if resignation is pending
    isSalaryHold?: boolean, // From payroll record - if approved and salary hold
    salaryHold?: boolean, // From resignation record
    preferredLastWorkingDay?: Date, // From pending resignation
    approvedLastWorkingDay?: Date, // From approved resignation
    highlightColor?: 'red' | 'orange' | null, // RED if isSalaryHold, ORANGE if isPendingResignation
    tags?: string[] // ['Pending Resignation'] or ['Resigned – Salary Hold']
  }]
}
```

**UI Display Logic**:
- If `isPendingResignation = true`:
  - Employee name: ORANGE/YELLOW color (warning)
  - Tag: "Pending Resignation"
  - Payroll status: Normal (Draft, PendingApproval, InPayment, Completed)
  - HR can process or exclude manually
  - HR can see preferred LWD (if provided by employee)
  
- If `isSalaryHold = true`:
  - Employee name: RED color
  - Tag: "Resigned – Salary Hold"
  - Payroll status: Normal (Draft, PendingApproval, InPayment, Completed)
  - HR can process through all stages normally
  
- If `isSalaryHold = false`:
  - Normal display (no highlighting)

**2.3 Update Salary Hold Status**

**Route**: `POST /payroll/update-salary-hold`
**Service**: `payrollService.updateSalaryHold()`

**Request Body**:
```typescript
{
  employeeId: string,
  month: number,
  year: number,
  salaryHold: boolean, // true = hold, false = pay
  reason?: string // Required if changing from hold to pay
}
```

**Actions**:
- Updates resignation record: `salaryHold` field
- Updates existing payroll record (if exists): `isSalaryHold` field
- If changing to `salaryHold: false`:
  - Requires reason
  - Logs change in resignation history
  - Updates payroll record: `isSalaryHold = false`
  - Removes RED highlight in UI
- If changing to `salaryHold: true`:
  - Updates payroll record: `isSalaryHold = true`
  - Shows RED highlight in UI

#### **Phase 3: Last Working Day Processing (MANUAL ONLY)**

**3.1 Manual LWD Trigger (HR) - PRIMARY METHOD**

**Route**: `POST /final-settlement/trigger/:userId`
**Service**: `finalSettlementService.triggerFinalSettlement()`

**Actions**:
- HR manually triggers when LWD is reached (or before/after)
- Validates: resignation.status = 'Approved', resignation.isActive = true
- Sets user.active = false
- Creates Final Settlement Draft with auto-calculated values
- Sends email notification to HR + Employee
- Returns created settlement draft

**Note**: This is the ONLY way to trigger final settlement

#### **Phase 4: Final Settlement Worksheet**

**4.1 Get Final Settlement Data**

**Route**: `GET /final-settlement/:userId`
**Service**: `finalSettlementService.getFinalSettlement()`

**Response Structure**:
```typescript
{
  // Basic Info (Read-only)
  basicInfo: {
    resignationDate: Date,
    approvedLastWorkingDay: Date,
    reason: string,
    employeeName: string,
    employeeCode: string
  },
  
  // Notice Period Decision (Radio Buttons - HR selects one)
  noticePeriodDecision: {
    selected: 'recover' | 'no-recovery' | 'buyout' | null,
    options: {
      recover: {
        label: 'Apply Notice Period & Recover Shortfall',
        default: true
      },
      noRecovery: {
        label: 'No Notice Period (Pay only actual days worked)'
      },
      buyout: {
        label: 'Buyout (Employee pays to leave early)'
      }
    }
  },
  
  // Notice Period Details (Visible for 'recover' & 'buyout')
  noticePeriodDetails: {
    requiredNoticePeriod: number, // Auto: user.noticePeriod
    actualNoticeServed: number, // Auto: calculated
    shortfallDays: number, // Auto: required - actual
    recoveryAmount: number, // Auto: (monthlyGross/30) × shortfall, editable
    buyoutAmount: number // Manual entry (only for buyout option)
  },
  
  // Salary & Days
  salaryAndDays: {
    lastSalaryMonth: string, // Auto: last paid month
    totalDaysInMonth: number, // Auto
    actualWorkingDays: number, // Auto: from attendance
    plElTaken: number, // Auto: from leave summary
    lopDays: number, // Auto: calculated, editable (can increase)
    effectivePayableDays: number // Auto: calculated, editable
  },
  
  // Leave Encashment
  leaveEncashment: {
    remainingLeaveBalance: number, // Auto: from leave summary
    perDayRate: number, // Auto: (Basic+DA)/30, editable
    encashmentAmount: number // Auto: balance × perDayRate, editable (can set 0)
  },
  
  // Other Deductions
  otherDeductions: [{
    description: string, // Manual: e.g., "Asset Damage"
    amount: number // Manual: e.g., 20000
  }],
  
  // Other Additions (Optional)
  otherAdditions: [{
    description: string, // Manual: e.g., "Prorated Annual Bonus"
    amount: number // Manual: e.g., 5000
  }],
  
  // On-Hold Payrolls (NEW - Payrolls that were held due to resignation)
  onHoldPayrolls: [{
    payrollId: ObjectId, // Reference to Payroll record
    month: number, // 1-12
    year: number,
    monthYear: string, // "YYYY-MM"
    netSalary: number, // Net salary from that payroll
    status: string, // Draft, PendingApproval, InPayment, etc.
    monthlyGross: number
  }],
  totalOnHoldAmount: number, // Sum of all on-hold payroll net salaries
  includeOnHoldPayrolls: boolean, // NEW: HR can choose to include on-hold payrolls in final settlement
  
  // Final Calculation
  finalCalculation: {
    totalPayable: number, // Auto: sum of all payable amounts
    totalDeduction: number, // Auto: sum of all deductions
    netAmount: number // Auto: totalPayable - totalDeduction
    // Positive = Pay employee, Negative = Employee pays company
  },
  isNegativeAmount: boolean, // NEW: true if netAmount < 0 (employee owes money)
  
  // Status & Tracking
  status: 'Draft' | 'Confirmed',
  canEdit: boolean, // true if Draft, false if Confirmed
  initiatedAt: Date, // NEW: When final settlement was first initiated
  initiatedBy: ObjectId // NEW: Who initiated it (HR user)
}
```

**4.2 Save Final Settlement Draft**

**Route**: `PUT /final-settlement/:userId`
**Service**: `finalSettlementService.saveFinalSettlement()`

**Request Body**: All editable fields from above structure

**Actions**:
- Validates data
- Updates final settlement record
- Recalculates auto-fields
- Returns updated settlement

**4.3 Preview & Confirm Final Settlement**

**Route**: `POST /final-settlement/:userId/confirm`
**Service**: `finalSettlementService.confirmFinalSettlement()`

**Actions**:
1. Validates all required fields
2. Locks settlement (status: 'Confirmed', canEdit: false)
3. Generates PDF document
4. Sends email to employee with PDF
5. Sends email to admin with PDF
6. Processes payroll:
   - If LWD month payroll exists: Update status
   - If LWD month payroll doesn't exist: Create new payroll record
7. Marks `resignation.finalSettlementDone = true`
8. Returns confirmation details

**4.4 Cancel Final Settlement (Only if Draft)**

**Route**: `DELETE /final-settlement/:userId`
**Service**: `finalSettlementService.cancelFinalSettlement()`

**Actions**:
- Only allowed if status = 'Draft'
- Deletes final settlement record
- Resets user.active = true (if needed)
- Logs cancellation

---

## 3. Data Models & Schema Changes

### 3.1 User Model Updates

**File**: `src/models/user.model.ts`

**New Fields in Resignation Object**:
```typescript
resignations: [{
  // ... existing fields
  salaryHold: boolean, // NEW: Default true when approved
  salaryHoldReason?: string, // NEW: Reason if HR unticks hold
  salaryHoldChangedAt?: Date, // NEW: When hold status changed
  salaryHoldChangedBy?: ObjectId, // NEW: Who changed it
}]
```

### 3.2 Payroll Model Updates

**File**: `src/models/payrolls.model.ts`

**New Fields**:
```typescript
{
  // ... existing fields
  isPendingResignation: boolean, // NEW: If employee has pending resignation
  preferredLastWorkingDay?: Date, // NEW: Preferred LWD from pending resignation
  isSalaryHold: boolean, // NEW: If this payroll was held (approved resignation)
  salaryHoldReason?: string, // NEW: Reason for hold
  isFinalSettlement: boolean, // NEW: If this is final settlement payroll
  finalSettlementId?: ObjectId, // NEW: Reference to final settlement
}
```

### 3.3 New Final Settlement Model

**File**: `src/models/final-settlement.model.ts` (NEW)

```typescript
import { Schema, Document, Types, model } from 'mongoose';

export interface IFinalSettlement extends Document {
  employeeId: Types.ObjectId; // ref: 'User'
  resignationId: Types.ObjectId; // Reference to resignation in User model
  
  // Basic Info (Read-only)
  resignationDate: Date;
  approvedLastWorkingDay: Date;
  reason: string;
  
  // Notice Period Decision
  noticePeriodDecision: 'recover' | 'no-recovery' | 'buyout';
  
  // Notice Period Details
  noticePeriodDetails: {
    requiredNoticePeriod: number; // From user.noticePeriod
    actualNoticeServed: number; // Calculated: approvedLastWorkingDay - resignationDate
    shortfallDays: number; // required - actual
    recoveryAmount: number; // (monthlyGross/30) × shortfall
    buyoutAmount?: number; // Only for buyout option
  };
  
  // Salary & Days
  salaryAndDays: {
    lastSalaryMonth: string; // Format: "YYYY-MM"
    totalDaysInMonth: number;
    actualWorkingDays: number;
    plElTaken: number;
    lopDays: number;
    effectivePayableDays: number;
  };
  
  // Leave Encashment
  leaveEncashment: {
    remainingLeaveBalance: number;
    perDayRate: number; // (Basic+DA)/30
    encashmentAmount: number; // balance × perDayRate
  };
  
  // Other Deductions
  otherDeductions: Array<{
    description: string;
    amount: number;
  }>;
  
  // Other Additions (Optional)
  otherAdditions: Array<{
    description: string;
    amount: number;
  }>;
  
  // On-Hold Payrolls (NEW - Payrolls that were held due to resignation)
  onHoldPayrolls: Array<{
    payrollId: Types.ObjectId;
    month: number;
    year: number;
    monthYear: string;
    netSalary: number;
    status: string;
    monthlyGross: number;
  }>;
  totalOnHoldAmount: number;
  includeOnHoldPayrolls: boolean; // HR can choose to include on-hold payrolls
  
  // Final Calculation
  finalCalculation: {
    totalPayable: number;
    totalDeduction: number;
    netAmount: number; // Positive = Pay employee, Negative = Employee pays company
  };
  isNegativeAmount: boolean; // NEW: true if netAmount < 0 (employee owes money)
  
  // Status & Tracking
  status: 'Draft' | 'Confirmed';
  canEdit: boolean;
  initiatedAt?: Date; // NEW: When final settlement was first initiated
  initiatedBy?: Types.ObjectId; // NEW: Who initiated it (ref: 'User')
  pdfUrl?: string; // Generated PDF URL
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId; // ref: 'User'
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const finalSettlementSchema = new Schema<IFinalSettlement>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resignationId: { type: Schema.Types.ObjectId, required: true },
    
    resignationDate: { type: Date, required: true },
    approvedLastWorkingDay: { type: Date, required: true },
    reason: { type: String, required: true },
    
    noticePeriodDecision: {
      type: String,
      enum: ['recover', 'no-recovery', 'buyout'],
      required: true
    },
    
    noticePeriodDetails: {
      requiredNoticePeriod: { type: Number, required: true },
      actualNoticeServed: { type: Number, required: true },
      shortfallDays: { type: Number, required: true },
      recoveryAmount: { type: Number, default: 0 },
      buyoutAmount: { type: Number }
    },
    
    salaryAndDays: {
      lastSalaryMonth: { type: String, required: true },
      totalDaysInMonth: { type: Number, required: true },
      actualWorkingDays: { type: Number, required: true },
      plElTaken: { type: Number, required: true },
      lopDays: { type: Number, required: true },
      effectivePayableDays: { type: Number, required: true }
    },
    
    leaveEncashment: {
      remainingLeaveBalance: { type: Number, required: true },
      perDayRate: { type: Number, required: true },
      encashmentAmount: { type: Number, required: true }
    },
    
    otherDeductions: [{
      description: { type: String, required: true },
      amount: { type: Number, required: true }
    }],
    
    otherAdditions: [{
      description: { type: String, required: true },
      amount: { type: Number, required: true }
    }],
    
    // On-Hold Payrolls
    onHoldPayrolls: [{
      payrollId: { type: Schema.Types.ObjectId, ref: 'Payroll', required: true },
      month: { type: Number, required: true },
      year: { type: Number, required: true },
      monthYear: { type: String, required: true },
      netSalary: { type: Number, required: true },
      status: { type: String, required: true },
      monthlyGross: { type: Number, required: true }
    }],
    totalOnHoldAmount: { type: Number, default: 0 },
    includeOnHoldPayrolls: { type: Boolean, default: false }, // HR can choose to include
    
    finalCalculation: {
      totalPayable: { type: Number, required: true },
      totalDeduction: { type: Number, required: true },
      netAmount: { type: Number, required: true }
    },
    
    status: {
      type: String,
      enum: ['Draft', 'Confirmed'],
      default: 'Draft'
    },
    canEdit: { type: Boolean, default: true },
    pdfUrl: { type: String },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

finalSettlementSchema.index({ employeeId: 1, status: 1 });
finalSettlementSchema.index({ approvedLastWorkingDay: 1 });

export const FinalSettlement = model<IFinalSettlement>('FinalSettlement', finalSettlementSchema);
```

---

## 4. Service Methods & Implementation

### 4.1 User Service Updates

**File**: `src/services/user.service.ts`

#### **Updated Method: `approveResignation()`**

```typescript
async approveResignation(
  userId: string,
  approverId: string,
  data: {
    remarks?: string;
    noticePeriodDays: number;
    approvedLastWorkingDay: Date;
  },
): Promise<any> {
  // ... existing validation code ...
  
  // Update the resignation details
  resignation.status = 'Approved';
  resignation.remarks = data.remarks || resignation.remarks;
  resignation.approvedBy = new Types.ObjectId(approverId);
  resignation.approvedAt = new Date();
  resignation.noticePeriodDays = data.noticePeriodDays;
  resignation.approvedLastWorkingDay = data.approvedLastWorkingDay;
  resignation.isActive = true;
  
  // NEW: Set default salary hold
  resignation.salaryHold = true; // Default: hold salary
  resignation.salaryHoldChangedAt = new Date();
  resignation.salaryHoldChangedBy = new Types.ObjectId(approverId);
  
  await user.save();
  
  // ... existing email code ...
  
  return { resignation: user.resignations };
}
```

#### **New Method: `updateSalaryHold()`**

```typescript
async updateSalaryHold(
  userId: string,
  data: {
    salaryHold: boolean;
    reason?: string;
    month?: number;
    year?: number;
  },
  changedBy: string
): Promise<any> {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  
  const activeResignation = (user.resignations ?? []).find(
    (r) => r.status === 'Approved' && r.isActive
  );
  
  if (!activeResignation) {
    throw new Error('No active approved resignation found');
  }
  
  // Update salary hold status
  activeResignation.salaryHold = data.salaryHold;
  activeResignation.salaryHoldReason = data.reason;
  activeResignation.salaryHoldChangedAt = new Date();
  activeResignation.salaryHoldChangedBy = new Types.ObjectId(changedBy);
  
  await user.save();
  
  return { resignation: activeResignation };
}
```

### 4.2 Payroll Service Updates

**File**: `src/services/payroll.service.ts`

#### **Updated Method: `initiatePayroll()`**

```typescript
async initiatePayroll(
  month: string,
  year: number,
  userIds: string[],
): Promise<IInitiatePayroll> {
  // ... existing validation code ...
  
  // Fetch employees and salary assignments
  const [allEmployees, salaryAssignments] = await Promise.all([
    User.find({
      _id: filteredUserIds.length ? { $in: filteredUserIds } : { $exists: true },
      joiningDate: { $lt: lastDayOfMonth }
    }).lean(),
    SalaryAssignment.find({
      employeeId: filteredUserIds.length ? { $in: filteredUserIds } : { $exists: true },
      effectiveFrom: { $lte: lastDayOfMonth },
      effectiveTo: { $gte: firstDayOfMonth }
    })
      .populate('employeeId', '_id')
      .populate('salaryStructureId')
      .lean(),
  ]);
  
  // NEW: Filter employees based on resignation status
  // IMPORTANT: We CREATE payroll records even if salaryHold = true, but mark them
  const eligibleEmployees = allEmployees.filter((emp) => {
    // Check for PENDING resignation (not yet approved)
    const pendingResignation = (emp.resignations || []).find(
      (r: any) => r.status === 'Pending' && r.isActive
    );
    
    // Check for APPROVED resignation
    const approvedResignation = (emp.resignations || []).find(
      (r: any) => r.status === 'Approved' && r.isActive
    );
    
    // If PENDING resignation exists, INCLUDE but mark with isPendingResignation flag
    // HR can see and decide whether to process or hold
    if (pendingResignation) {
      return true; // Include, will be marked with isPendingResignation = true
    }
    
    // If no resignation at all, include normally
    if (!approvedResignation) {
      return true; // No resignation, include in payroll
    }
    
    // If resignation APPROVED
    const lwd = new Date(approvedResignation.approvedLastWorkingDay);
    const monthEnd = new Date(year, monthNumber, 0);
    
    // If LWD has passed or equals month end, exclude (final settlement handles)
    if (lwd <= monthEnd) {
      return false;
    }
    
    // If LWD is in future, INCLUDE in payroll (regardless of salaryHold)
    // The payroll record will be marked with isSalaryHold flag
    return true;
  });
  
  // Validate employee-salary assignment consistency
  const employeeIds = eligibleEmployees.map((emp) => emp._id.toString());
  // ... rest of existing code ...
}
```

#### **New Method: `updateSalaryHold()`**

```typescript
async updateSalaryHold(
  employeeId: string,
  month: number,
  year: number,
  salaryHold: boolean,
  reason: string,
  changedBy: string
): Promise<any> {
  // Update user's resignation record
  await this.context.container.userService.updateSalaryHold(
    employeeId,
    { salaryHold, reason, month, year },
    changedBy
  );
  
  // Update existing payroll record (if exists) with isSalaryHold flag
  const existingPayroll = await Payroll.findOne({
    employeeId: new Types.ObjectId(employeeId),
    month,
    year,
    status: { $nin: ['Cancelled'] }
  });
  
  if (existingPayroll) {
    existingPayroll.isSalaryHold = salaryHold;
    existingPayroll.salaryHoldReason = reason;
    await existingPayroll.save();
  }
  
  return { success: true, message: 'Salary hold status updated' };
}
```

#### **Updated Method: `getPayrollSummary()`**

```typescript
async getPayrollSummary(
  month: number,
  year: number,
  status?: PayrollStatus[],
  country?: string
): Promise<{
  // ... existing return type ...
  exportableDetails: Array<{
    // ... existing fields ...
    resignationStatus?: 'Approved' | null;
    salaryHold?: boolean;
    approvedLastWorkingDay?: Date;
    highlightColor?: 'red' | null;
    tags?: string[];
  }>;
}> {
  // ... existing aggregation code ...
  
  // Enhance exportableDetails with resignation info
  const exportableDetails = records.map((record: any) => {
    const employee = employees.find((emp) => emp._id.toString() === record.employeeId.toString());
    const activeResignation = (employee?.resignations || []).find(
      (r: any) => r.status === 'Approved' && r.isActive
    );
    
    const activeBank = employee?.bankDetails?.find((bank: any) => bank.isActive) || null;
    
    return {
      _id: record._id,
      employeeId: record.employeeId,
      employeeName: employee?.name || 'Unknown',
      bankAccountNumber: activeBank?.accountNumber || 'N/A',
      ifscCode: activeBank?.ifscCode || 'N/A',
      bankName: activeBank?.bankName || 'N/A',
      monthlyGross: Math.round(record.monthlyGross),
      netSalary: Math.round(record.netSalary),
      presentDays: record.presentDays,
      totalDaysInMonth: record.totalDaysInMonth,
      lopDays: record.LOPDays,
      payableDays: record.payableDays,
      overtimeHours: record.overtimeHours || 0,
      overtimePay: Math.round(record.overtimePay || 0),
      status: record.status,
      // NEW FIELDS:
      // Check for pending resignation first
      const pendingResignation = (employee?.resignations || []).find(
        (r: any) => r.status === 'Pending' && r.isActive
      );
      
      // Check for approved resignation
      const approvedResignation = (employee?.resignations || []).find(
        (r: any) => r.status === 'Approved' && r.isActive
      );
      
      // Determine resignation status
      let resignationStatus: 'Pending' | 'Approved' | null = null;
      if (pendingResignation) {
        resignationStatus = 'Pending';
      } else if (approvedResignation) {
        resignationStatus = 'Approved';
      }
      
      // Determine highlight color and tags
      let highlightColor: 'red' | 'orange' | null = null;
      let tags: string[] = [];
      
      if (record.isPendingResignation) {
        highlightColor = 'orange';
        tags = ['Pending Resignation'];
      } else if (record.isSalaryHold) {
        highlightColor = 'red';
        tags = ['Resigned – Salary Hold'];
      }
      
      return {
        _id: record._id,
        employeeId: record.employeeId,
        employeeName: employee?.name || 'Unknown',
        bankAccountNumber: activeBank?.accountNumber || 'N/A',
        ifscCode: activeBank?.ifscCode || 'N/A',
        bankName: activeBank?.bankName || 'N/A',
        monthlyGross: Math.round(record.monthlyGross),
        netSalary: Math.round(record.netSalary),
        presentDays: record.presentDays,
        totalDaysInMonth: record.totalDaysInMonth,
        lopDays: record.LOPDays,
        payableDays: record.payableDays,
        overtimeHours: record.overtimeHours || 0,
        overtimePay: Math.round(record.overtimePay || 0),
        status: record.status,
        // NEW FIELDS:
        resignationStatus,
        isPendingResignation: record.isPendingResignation || false,
        isSalaryHold: record.isSalaryHold || false,
        salaryHold: approvedResignation?.salaryHold || false,
        preferredLastWorkingDay: pendingResignation?.preferredLastWorkingDay || null,
        approvedLastWorkingDay: approvedResignation?.approvedLastWorkingDay || null,
        highlightColor,
        tags
      };
    };
  });
  
  // ... rest of existing code ...
}
```

### 4.3 New Final Settlement Service

**File**: `src/services/final-settlement.service.ts` (NEW)

```typescript
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { FinalSettlement, IFinalSettlement } from '../models/final-settlement.model';
import { User, Payroll, LeaveSummary } from '../models';
import { Types } from 'mongoose';

export class FinalSettlementService extends BaseService {
  protected context: RequestContext;

  constructor(context: RequestContext) {
    super(context);
    this.context = context;
  }

  /**
   * Manual trigger for final settlement (HR only)
   * HR manually triggers this when LWD is reached
   */
  async triggerFinalSettlement(userId: string): Promise<IFinalSettlement> {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Find active approved resignation
    const resignation = (user.resignations || []).find(
      (r: any) => r.status === 'Approved' && r.isActive && !r.finalSettlementDone
    );
    
    if (!resignation) {
      throw new Error('No active approved resignation found for final settlement');
    }
    
    // Check if final settlement already exists
    const existingSettlement = await FinalSettlement.findOne({
      employeeId: user._id,
      status: { $in: ['Draft', 'Confirmed'] }
    });
    
    if (existingSettlement) {
      throw new Error('Final settlement already exists for this employee');
    }
    
    // Set user inactive
    await User.updateOne(
      { _id: user._id },
      { $set: { active: false } }
    );
    
    // Create final settlement draft
    const settlement = await this.createFinalSettlementDraft(
      user._id.toString(),
      resignation
    );
    
    // NEW: Track when final settlement was initiated
    settlement.initiatedAt = new Date();
    // Note: initiatedBy can be set by the route handler (from authenticated user)
    await settlement.save();
    
    // Send notifications
    await this.sendLWDNotification(user, settlement);
    
    return settlement;
  }

  /**
   * Create final settlement draft with auto-calculated values
   */
  async createFinalSettlementDraft(
    userId: string,
    resignation: any
  ): Promise<IFinalSettlement> {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Get last salary month (last completed payroll)
    const lastPayroll = await Payroll.findOne({
      employeeId: user._id,
      status: 'Completed'
    })
      .sort({ year: -1, month: -1 })
      .lean();
    
    const lastSalaryMonth = lastPayroll
      ? `${lastPayroll.year}-${String(lastPayroll.month).padStart(2, '0')}`
      : null;
    
    // NEW: Get all on-hold payrolls (isSalaryHold = true, not yet completed)
    // These are payrolls that were created but held due to resignation
    const onHoldPayrolls = await Payroll.find({
      employeeId: user._id,
      isSalaryHold: true,
      status: { $in: ['Draft', 'PendingApproval', 'InPayment', 'Failed', 'RetryPending'] }
    })
      .sort({ year: -1, month: -1 })
      .lean();
    
    // Calculate total on-hold amount
    const totalOnHoldAmount = onHoldPayrolls.reduce((sum, payroll) => {
      return sum + (payroll.netSalary || 0);
    }, 0);
    
    // Get leave balance
    const leaveSummary = await LeaveSummary.findOne({
      userId: user._id,
      year: new Date().getFullYear()
    }).lean();
    
    const remainingLeaveBalance = leaveSummary?.annualLeaveBalance || 0;
    
    // Calculate notice period details
    const resignationDate = new Date(resignation.submittedAt);
    const approvedLWD = new Date(resignation.approvedLastWorkingDay);
    const actualNoticeServed = Math.ceil(
      (approvedLWD.getTime() - resignationDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const requiredNoticePeriod = user.noticePeriod || resignation.noticePeriodDays || 0;
    const shortfallDays = Math.max(0, requiredNoticePeriod - actualNoticeServed);
    
    // Get salary assignment for calculations
    const salaryAssignment = await SalaryAssignment.findOne({
      employeeId: user._id,
      effectiveFrom: { $lte: approvedLWD },
      $or: [
        { effectiveTo: { $gte: approvedLWD } },
        { effectiveTo: null }
      ]
    })
      .populate('salaryStructureId')
      .lean();
    
    const monthlyGross = salaryAssignment?.monthlyGross || 0;
    const basicPercentage = salaryAssignment?.salaryStructureId?.fixedEarnings?.basicPercentage || 0;
    const daPercentage = salaryAssignment?.salaryStructureId?.fixedEarnings?.daPercentage || 0;
    const basic = (basicPercentage / 100) * monthlyGross;
    const da = (daPercentage / 100) * basic;
    const perDayRate = (basic + da) / 30;
    
    // Calculate working days for LWD month
    const lwdMonth = approvedLWD.getMonth() + 1;
    const lwdYear = approvedLWD.getFullYear();
    const { workingDays, weekendDays, holidayDays } = await this.getWorkingDaysInMonth(
      user._id,
      lwdYear,
      lwdMonth
    );
    
    // Get attendance for LWD month
    const attendance = await this.getMonthlyAttendance(
      user._id,
      this.getMonthName(lwdMonth),
      lwdYear
    );
    
    const totalDaysInMonth = new Date(lwdYear, lwdMonth, 0).getDate();
    const actualWorkingDays = attendance.presentDays;
    const plElTaken = await this.fetchApprovedLeaves(user._id, lwdYear, lwdMonth);
    const lopDays = Math.max(0, totalDaysInMonth - (attendance.presentDays + weekendDays + holidayDays + plElTaken));
    const effectivePayableDays = actualWorkingDays + plElTaken;
    
    // Create settlement draft
    const settlement = new FinalSettlement({
      employeeId: user._id,
      resignationId: resignation._id || new Types.ObjectId(),
      resignationDate: resignation.submittedAt,
      approvedLastWorkingDay: approvedLWD,
      reason: resignation.summary,
      
      noticePeriodDecision: 'recover', // Default
      
      noticePeriodDetails: {
        requiredNoticePeriod,
        actualNoticeServed,
        shortfallDays,
        recoveryAmount: shortfallDays > 0 ? Math.round((monthlyGross / 30) * shortfallDays) : 0,
        buyoutAmount: 0
      },
      
      salaryAndDays: {
        lastSalaryMonth: lastSalaryMonth || `${lwdYear}-${String(lwdMonth).padStart(2, '0')}`,
        totalDaysInMonth,
        actualWorkingDays,
        plElTaken,
        lopDays,
        effectivePayableDays
      },
      
      leaveEncashment: {
        remainingLeaveBalance,
        perDayRate: Math.round(perDayRate),
        encashmentAmount: Math.round(remainingLeaveBalance * perDayRate)
      },
      
      otherDeductions: [],
      otherAdditions: [],
      
      // NEW: Store on-hold payrolls information
      onHoldPayrolls: onHoldPayrolls.map((payroll: any) => ({
        payrollId: payroll._id,
        month: payroll.month,
        year: payroll.year,
        monthYear: payroll.monthYear,
        netSalary: payroll.netSalary,
        status: payroll.status,
        monthlyGross: payroll.monthlyGross
      })),
      totalOnHoldAmount: Math.round(totalOnHoldAmount),
      includeOnHoldPayrolls: false, // Default: not included, HR can choose
      
      finalCalculation: {
        totalPayable: Math.round((monthlyGross / totalDaysInMonth) * effectivePayableDays + (remainingLeaveBalance * perDayRate)),
        totalDeduction: Math.round((monthlyGross / 30) * shortfallDays),
        netAmount: 0 // Will be calculated
      }
    });
    
    // Calculate net amount
    settlement.finalCalculation.netAmount =
      settlement.finalCalculation.totalPayable - settlement.finalCalculation.totalDeduction;
    
    await settlement.save();
    return settlement;
  }

  /**
   * Get final settlement for HR worksheet
   * Includes on-hold payrolls information
   */
  async getFinalSettlement(userId: string): Promise<IFinalSettlement | null> {
    const settlement = await FinalSettlement.findOne({
      employeeId: userId,
      status: { $in: ['Draft', 'Confirmed'] }
    })
      .populate('employeeId', 'name employeeCode')
      .populate('confirmedBy', 'name')
      .lean();
    
    if (!settlement) {
      return null;
    }
    
    // If settlement doesn't have on-hold payrolls, fetch them
    if (!settlement.onHoldPayrolls || settlement.onHoldPayrolls.length === 0) {
      const onHoldPayrolls = await Payroll.find({
        employeeId: userId,
        isSalaryHold: true,
        status: { $in: ['Draft', 'PendingApproval', 'InPayment', 'Failed', 'RetryPending'] }
      })
        .sort({ year: -1, month: -1 })
        .lean();
      
      settlement.onHoldPayrolls = onHoldPayrolls.map((payroll: any) => ({
        payrollId: payroll._id,
        month: payroll.month,
        year: payroll.year,
        monthYear: payroll.monthYear,
        netSalary: payroll.netSalary,
        status: payroll.status,
        monthlyGross: payroll.monthlyGross
      }));
      
      settlement.totalOnHoldAmount = onHoldPayrolls.reduce((sum: number, payroll: any) => {
        return sum + (payroll.netSalary || 0);
      }, 0);
    }
    
    return settlement;
  }

  /**
   * Save final settlement draft
   */
  async saveFinalSettlement(
    userId: string,
    data: Partial<IFinalSettlement>,
    savedBy: string
  ): Promise<IFinalSettlement> {
    const settlement = await FinalSettlement.findOne({
      employeeId: userId,
      status: 'Draft'
    });
    
    if (!settlement) {
      throw new Error('No draft settlement found');
    }
    
    // Update editable fields
    if (data.noticePeriodDecision) {
      settlement.noticePeriodDecision = data.noticePeriodDecision;
    }
    
    if (data.noticePeriodDetails) {
      Object.assign(settlement.noticePeriodDetails, data.noticePeriodDetails);
    }
    
    if (data.salaryAndDays) {
      Object.assign(settlement.salaryAndDays, data.salaryAndDays);
    }
    
    if (data.leaveEncashment) {
      Object.assign(settlement.leaveEncashment, data.leaveEncashment);
    }
    
    if (data.otherDeductions) {
      settlement.otherDeductions = data.otherDeductions;
    }
    
    if (data.otherAdditions) {
      settlement.otherAdditions = data.otherAdditions;
    }
    
    // NEW: Update includeOnHoldPayrolls flag
    if (data.includeOnHoldPayrolls !== undefined) {
      settlement.includeOnHoldPayrolls = data.includeOnHoldPayrolls;
    }
    
    // Recalculate final calculation
    this.recalculateFinalAmount(settlement);
    
    await settlement.save();
    return settlement;
  }

  /**
   * Recalculate final amounts based on notice period decision
   */
  private recalculateFinalAmount(settlement: IFinalSettlement): void {
    const { noticePeriodDecision, noticePeriodDetails, salaryAndDays, leaveEncashment, otherDeductions, otherAdditions } = settlement;
    
    // Calculate salary payable
    const user = await User.findById(settlement.employeeId);
    const salaryAssignment = await SalaryAssignment.findOne({
      employeeId: settlement.employeeId,
      effectiveFrom: { $lte: settlement.approvedLastWorkingDay }
    })
      .populate('salaryStructureId')
      .lean();
    
    const monthlyGross = salaryAssignment?.monthlyGross || 0;
    const salaryPayable = (monthlyGross / salaryAndDays.totalDaysInMonth) * salaryAndDays.effectivePayableDays;
    
    // Calculate leave encashment
    const leaveEncashmentAmount = leaveEncashment.encashmentAmount;
    
    // Calculate total payable
    let totalPayable = salaryPayable + leaveEncashmentAmount;
    
    // Add other additions (bonus/incentives)
    if (otherAdditions && otherAdditions.length > 0) {
      totalPayable += otherAdditions.reduce((sum, a) => sum + a.amount, 0);
    }
    
    // NEW: Add on-hold payrolls if HR chooses to include them
    if (settlement.includeOnHoldPayrolls && settlement.onHoldPayrolls && settlement.onHoldPayrolls.length > 0) {
      totalPayable += settlement.totalOnHoldAmount || 0;
    }
    
    // Calculate total deduction
    let totalDeduction = 0;
    
    // Add other deductions
    totalDeduction += otherDeductions.reduce((sum, d) => sum + d.amount, 0);
    
    // Add notice period recovery/buyout based on decision
    if (noticePeriodDecision === 'recover') {
      totalDeduction += noticePeriodDetails.recoveryAmount;
    } else if (noticePeriodDecision === 'buyout') {
      totalDeduction += noticePeriodDetails.buyoutAmount || 0;
    }
    // 'no-recovery' means no deduction for notice period
    
    // Calculate net amount
    let netAmount = totalPayable - totalDeduction;
    
    // NEW: Handle negative amount - HR can choose to set to 0 or keep negative
    // For now, we allow negative (employee pays company)
    // HR can manually adjust deductions in worksheet to make it 0 if needed
    
    settlement.finalCalculation = {
      totalPayable: Math.round(totalPayable),
      totalDeduction: Math.round(totalDeduction),
      netAmount: Math.round(netAmount) // Can be negative (employee pays) or positive (company pays)
    };
    
    // NEW: Add flag to indicate if amount is negative
    settlement.isNegativeAmount = netAmount < 0;
    
    // Note: HR can manually adjust deductions to make netAmount = 0 if needed
  }

  /**
   * Confirm final settlement
   */
  async confirmFinalSettlement(
    userId: string,
    confirmedBy: string
  ): Promise<{
    settlement: IFinalSettlement;
    payrollRecord?: any;
    pdfUrl: string;
  }> {
    const settlement = await FinalSettlement.findOne({
      employeeId: userId,
      status: 'Draft'
    });
    
    if (!settlement) {
      throw new Error('No draft settlement found');
    }
    
    // Lock settlement
    settlement.status = 'Confirmed';
    settlement.canEdit = false;
    settlement.confirmedAt = new Date();
    settlement.confirmedBy = new Types.ObjectId(confirmedBy);
    
    // Generate PDF
    const pdfUrl = await this.generateFinalSettlementPDF(settlement);
    settlement.pdfUrl = pdfUrl;
    
    await settlement.save();
    
    // Process payroll
    const payrollRecord = await this.processFinalSettlementPayroll(settlement);
    
    // NEW: If on-hold payrolls are included, mark them as completed
    if (settlement.includeOnHoldPayrolls && settlement.onHoldPayrolls && settlement.onHoldPayrolls.length > 0) {
      const payrollIds = settlement.onHoldPayrolls.map((p: any) => p.payrollId);
      await Payroll.updateMany(
        { _id: { $in: payrollIds } },
        { 
          $set: { 
            status: 'Completed',
            paymentConfirmedAt: new Date(),
            isSalaryHold: false // Remove hold flag
          }
        }
      );
    }
    
    // Update user resignation
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          'resignations.$[elem].finalSettlementDone': true
        }
      },
      {
        arrayFilters: [{ 'elem._id': settlement.resignationId }]
      }
    );
    
    // Send emails
    await this.sendFinalSettlementEmails(settlement);
    
    return {
      settlement,
      payrollRecord,
      pdfUrl
    };
  }

  /**
   * Process payroll for final settlement
   * IMPORTANT: This creates/updates payroll for the LWD month (e.g., Jan)
   * Even though Jan payroll was EXCLUDED from normal payroll generation,
   * final settlement will CREATE the payroll record for that month
   * 
   * Example: LWD = Jan 31
   * - Jan payroll was EXCLUDED from normal payroll generation
   * - Final settlement (triggered on Feb 1) CREATES payroll for Jan month
   */
  private async processFinalSettlementPayroll(settlement: IFinalSettlement): Promise<any> {
    const lwd = new Date(settlement.approvedLastWorkingDay);
    const month = lwd.getMonth() + 1;
    const year = lwd.getFullYear();
    
    // Check if payroll exists for LWD month
    // Note: Usually it won't exist because LWD month was excluded from normal payroll
    const existingPayroll = await Payroll.findOne({
      employeeId: settlement.employeeId,
      month,
      year
    });
    
    if (existingPayroll) {
      // Rare case: Update existing payroll with final settlement
      existingPayroll.isFinalSettlement = true;
      existingPayroll.finalSettlementId = settlement._id;
      existingPayroll.netSalary = settlement.finalCalculation.netAmount;
      // Update other fields as needed
      await existingPayroll.save();
      return existingPayroll;
    } else {
      // Normal case: CREATE NEW payroll record for LWD month
      // This is what happens: Jan payroll was excluded, but final settlement creates it
      const user = await User.findById(settlement.employeeId);
      const salaryAssignment = await SalaryAssignment.findOne({
        employeeId: settlement.employeeId,
        effectiveFrom: { $lte: lwd }
      })
        .populate('salaryStructureId')
        .lean();
      
      const newPayroll = new Payroll({
        employeeId: settlement.employeeId,
        salaryAssignmentId: salaryAssignment?._id,
        monthlyGross: salaryAssignment?.monthlyGross || 0,
        attendanceAdjustGross: settlement.finalCalculation.totalPayable,
        netSalary: settlement.finalCalculation.netAmount,
        month,
        year,
        monthYear: `${year}-${String(month).padStart(2, '0')}`,
        totalDaysInMonth: settlement.salaryAndDays.totalDaysInMonth,
        presentDays: settlement.salaryAndDays.actualWorkingDays,
        LOPDays: settlement.salaryAndDays.lopDays,
        payableDays: settlement.salaryAndDays.effectivePayableDays,
        status: 'Completed', // Auto-complete final settlement
        isFinalSettlement: true,
        finalSettlementId: settlement._id,
        country: user?.country || 'IN',
        // ... other required fields
      });
      
      await newPayroll.save();
      return newPayroll;
    }
  }

  /**
   * Generate PDF for final settlement
   */
  private async generateFinalSettlementPDF(settlement: IFinalSettlement): Promise<string> {
    // Similar to payslip PDF generation
    // Use DOCX template, replace placeholders, convert to PDF
    // Upload to GCP Cloud Storage
    // Return URL
    // Implementation similar to payslipService.generatePayslipPDF()
    return 'gcp-url-here';
  }

  /**
   * Send final settlement emails
   */
  private async sendFinalSettlementEmails(settlement: IFinalSettlement): Promise<void> {
    const user = await User.findById(settlement.employeeId);
    if (!user) return;
    
    // Send to employee
    await emailService.sendEmail({
      body: {
        to: user.email,
        subject: 'Final Settlement Confirmed',
        html: generateEmailTemplate('finalSettlementEmail', {
          employeeName: user.name,
          netAmount: settlement.finalCalculation.netAmount,
          pdfUrl: settlement.pdfUrl
        })
      }
    });
    
    // Send to admin
    const hrEmail = process.env.HR_EMAIL || 'hr@company.com';
    await emailService.sendEmail({
      body: {
        to: hrEmail,
        subject: `Final Settlement Confirmed - ${user.name}`,
        html: generateEmailTemplate('finalSettlementAdminEmail', {
          employeeName: user.name,
          netAmount: settlement.finalCalculation.netAmount,
          pdfUrl: settlement.pdfUrl
        })
      }
    });
  }

  // Helper methods (similar to payroll service)
  private async getWorkingDaysInMonth(userId: Types.ObjectId, year: number, month: number) {
    // Implementation similar to payrollService.getWorkingDaysInMonth()
  }

  private async getMonthlyAttendance(userId: Types.ObjectId, monthName: string, year: number) {
    // Implementation similar to payrollService.getMonthlyAttendance()
  }

  private async fetchApprovedLeaves(userId: Types.ObjectId, year: number, month: number) {
    // Implementation similar to payrollService.fetchApprovedLeaves()
  }

  private getMonthName(monthNumber: number): string {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNumber - 1] || 'Unknown';
  }

  private async sendLWDNotification(user: any, settlement: IFinalSettlement): Promise<void> {
    // Send notification emails when LWD is reached
  }
}
```

---

## 5. API Routes & Endpoints

### 5.1 Resignation Routes (Updates)

**File**: `src/routes/user-resignation.routes.ts` (or add to `user.routes.ts`)

#### **Existing Routes** (No changes needed):
- `POST /users/:id/resignation/apply`
- `POST /users/:id/resignation/approve`
- `POST /users/:id/resignation/reject`
- `POST /users/:id/resignation/withdraw`

#### **New Route: Update Salary Hold**

```typescript
// POST /users/:id/resignation/salary-hold
fastify.post(
  '/:id/resignation/salary-hold',
  {
    onRequest: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['salaryHold'],
        properties: {
          salaryHold: { type: 'boolean' },
          reason: { type: 'string' },
          month: { type: 'number' },
          year: { type: 'number' }
        }
      }
    }
  },
  async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { salaryHold, reason, month, year } = request.body;
      const userId = request.user._id.toString();
      
      const result = await request.container!.userService.updateSalaryHold(
        id,
        { salaryHold, reason, month, year },
        userId
      );
      
      return reply.send({
        success: true,
        data: result
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: { message: error.message }
      });
    }
  }
);
```

### 5.2 Payroll Routes (Updates)

**File**: `src/routes/payroll.routes.ts`

#### **Updated Route: Generate Payroll**
- Already exists, but logic updated to check resignation status

#### **New Route: Update Salary Hold from Payroll**

```typescript
// POST /payroll/update-salary-hold
fastify.post(
  '/update-salary-hold',
  {
    onRequest: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['employeeId', 'month', 'year', 'salaryHold'],
        properties: {
          employeeId: { type: 'string' },
          month: { type: 'number' },
          year: { type: 'number' },
          salaryHold: { type: 'boolean' },
          reason: { type: 'string' }
        }
      }
    }
  },
  async (request, reply) => {
    try {
      const { employeeId, month, year, salaryHold, reason } = request.body;
      const userId = request.user._id.toString();
      
      const result = await request.container!.payrollService.updateSalaryHold(
        employeeId,
        month,
        year,
        salaryHold,
        reason,
        userId
      );
      
      return reply.send({
        success: true,
        data: result
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: { message: error.message }
      });
    }
  }
);
```

### 5.3 Final Settlement Routes (NEW)

**File**: `src/routes/final-settlement.routes.ts` (NEW)

```typescript
import { FastifyInstance } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from '../middleware/auth';

export const finalSettlementRoutes: RouteHandler = async (
  fastify: FastifyInstance
): Promise<void> => {
  
  // Get final settlement worksheet
  fastify.get(
    '/:userId',
    {
      onRequest: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        const settlement = await request.container!.finalSettlementService.getFinalSettlement(userId);
        
        if (!settlement) {
          return reply.status(404).send({
            success: false,
            error: { message: 'Final settlement not found' }
          });
        }
        
        return reply.send({
          success: true,
          data: settlement
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );
  
  // Save final settlement draft
  fastify.put(
    '/:userId',
    {
      onRequest: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          properties: {
            noticePeriodDecision: {
              type: 'string',
              enum: ['recover', 'no-recovery', 'buyout']
            },
            noticePeriodDetails: { type: 'object' },
            salaryAndDays: { type: 'object' },
            leaveEncashment: { type: 'object' },
            otherDeductions: { type: 'array' },
            otherAdditions: { type: 'array' },
            includeOnHoldPayrolls: { type: 'boolean' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        const data = request.body as any;
        const savedBy = request.user._id.toString();
        
        const settlement = await request.container!.finalSettlementService.saveFinalSettlement(
          userId,
          data,
          savedBy
        );
        
        return reply.send({
          success: true,
          data: settlement
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );
  
  // Confirm final settlement
  fastify.post(
    '/:userId/confirm',
    {
      onRequest: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        const confirmedBy = request.user._id.toString();
        
        const result = await request.container!.finalSettlementService.confirmFinalSettlement(
          userId,
          confirmedBy
        );
        
        return reply.send({
          success: true,
          data: result
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );
  
  // Cancel final settlement (only if draft)
  fastify.delete(
    '/:userId',
    {
      onRequest: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        
        await request.container!.finalSettlementService.cancelFinalSettlement(userId);
        
        return reply.send({
          success: true,
          data: { message: 'Final settlement cancelled' }
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );
  
  // Manual trigger final settlement (HR)
  fastify.post(
    '/trigger/:userId',
    {
      onRequest: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        
        const user = await User.findById(userId);
        if (!user) {
          return reply.status(404).send({
            success: false,
            error: { message: 'User not found' }
          });
        }
        
        const resignation = (user.resignations || []).find(
          (r: any) => r.status === 'Approved' && r.isActive && !r.finalSettlementDone
        );
        
        if (!resignation) {
          return reply.status(400).send({
            success: false,
            error: { message: 'No active approved resignation found' }
          });
        }
        
        // Set user inactive
        await User.updateOne({ _id: userId }, { $set: { active: false } });
        
        // Create final settlement
        const settlement = await request.container!.finalSettlementService.createFinalSettlementDraft(
          userId,
          resignation
        );
        
        // Send notifications
        await request.container!.finalSettlementService.sendLWDNotification(user, settlement);
        
        return reply.send({
          success: true,
          data: settlement
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );
  
  // Final settlement is triggered manually by HR via POST /final-settlement/trigger/:userId
};
```

---

## 6. Calculation Logic

### 6.1 Final Settlement Calculations

#### **6.1.1 Notice Period Calculations**

**Required Notice Period:**
```
Required Notice Period = user.noticePeriod (from User model)
```

**Actual Notice Served:**
```
Actual Notice Served = approvedLastWorkingDay - resignationDate (in days)
```

**Shortfall Days:**
```
Shortfall Days = max(0, Required Notice Period - Actual Notice Served)
```

**Recovery Amount (Option 1: Recover):**
```
Recovery Amount = (Monthly Gross / 30) × Shortfall Days
```

**Buyout Amount (Option 3: Buyout):**
```
Buyout Amount = Manual entry by HR
```

#### **6.1.2 Salary & Days Calculations**

**Last Salary Month:**
```
Last Salary Month = Last completed payroll month (format: "YYYY-MM")
```

**Total Days in Month:**
```
Total Days in Month = Days in LWD month (28-31)
```

**Actual Working Days:**
```
Actual Working Days = Present days from attendance records in LWD month
```

**PL/EL Taken:**
```
PL/EL Taken = Sum of approved leave days in LWD month
```

**LOP Days:**
```
LOP Days = Total Days - (Present Days + Weekend Days + Holiday Days + PL/EL Taken)
HR can increase this value
```

**Effective Payable Days:**
```
Effective Payable Days = Actual Working Days + PL/EL Taken
HR can edit this value
```

#### **6.1.3 Leave Encashment Calculations**

**Remaining Leave Balance:**
```
Remaining Leave Balance = From LeaveSummary for current year
HR can reduce or set to 0
```

**Per Day Rate:**
```
Per Day Rate = (Basic + DA) / 30
HR can edit this value
```

**Encashment Amount:**
```
Encashment Amount = Remaining Leave Balance × Per Day Rate
HR can set to 0 or manual amount
```

#### **6.1.4 Final Calculation**

**Total Payable:**
```
Total Payable = Salary Payable + Leave Encashment Amount + Other Additions + On-Hold Payrolls (if included)

Where:
Salary Payable = (Monthly Gross / Total Days in Month) × Effective Payable Days
Leave Encashment Amount = From leave encashment section
Other Additions = Sum of bonus/incentives (prorated if applicable)
  - Optional field: HR can add prorated bonus or other additions
  - Example: Prorated annual bonus for LWD month
On-Hold Payrolls = Sum of net salaries from on-hold payrolls (if includeOnHoldPayrolls = true)
  - Only included if HR checks "Include On-Hold Payrolls" checkbox
  - Example: Dec payroll was on hold (isSalaryHold = true), HR includes it in final settlement
```

**Total Deduction:**
```
Total Deduction = Other Deductions + Notice Period Recovery/Buyout

Where:
Other Deductions = Sum of all otherDeductions[].amount
Notice Period Recovery = 
  - If noticePeriodDecision = 'recover': recoveryAmount
  - If noticePeriodDecision = 'buyout': buyoutAmount
  - If noticePeriodDecision = 'no-recovery': 0
```

**Net Amount:**
```
Net Amount = Total Payable - Total Deduction

If Net Amount > 0: Pay to employee
If Net Amount < 0: Recover from employee
```

### 6.2 Three Scenarios Logic

#### **Scenario 1: Recovery (Apply Notice Period & Recover Shortfall)**
- **Selected**: `noticePeriodDecision = 'recover'`
- **Calculation**:
  - If `shortfallDays > 0`: Calculate `recoveryAmount`
  - Add `recoveryAmount` to `totalDeduction`
- **Result**: Employee receives salary minus recovery amount

#### **Scenario 2: No Recovery (Pay only actual days worked)**
- **Selected**: `noticePeriodDecision = 'no-recovery'`
- **Calculation**:
  - No notice period recovery
  - Pay only for actual working days + PL/EL
- **Result**: Employee receives salary for days worked only

#### **Scenario 3: Buyout (Employee pays to leave early)**
- **Selected**: `noticePeriodDecision = 'buyout'`
- **Calculation**:
  - HR enters `buyoutAmount` manually
  - Add `buyoutAmount` to `totalDeduction`
- **Result**: Employee pays buyout amount to company

---

## 7. Email Notifications

### 7.1 Email Templates Required

1. **Resignation Applied** (Existing)
   - To: HR
   - Content: Employee name, resignation date, preferred LWD, reason

2. **Resignation Approved** (Existing - Enhanced)
   - To: Employee
   - Content: Approval date, approved LWD, notice period, remarks
   - **NEW**: Mention salary hold status

3. **LWD Reached Notification** (NEW)
   - To: HR + Employee
   - Content: LWD reached, final settlement draft created, link to worksheet

4. **Final Settlement Confirmed** (NEW)
   - To: Employee
   - Content: Final settlement confirmed, net amount, PDF attachment

5. **Final Settlement Admin Notification** (NEW)
   - To: Admin/HR
   - Content: Final settlement confirmed for employee, net amount, PDF attachment

6. **Salary Hold Removed** (NEW - Optional)
   - To: Employee
   - Content: Notification that salary hold has been removed, payroll will be processed normally
   - Triggered when: HR changes salaryHold from true to false

### 7.2 Email Service Integration

**File**: `src/services/email.service.ts`

Add methods:
- `sendLWDNotification()`
- `sendFinalSettlementEmail()`
- `sendFinalSettlementAdminEmail()`
- `sendSalaryHoldRemovedEmail()` (optional)

---

## 8. Integration Points Summary

### 8.1 Resignation → Payroll Integration

**Location**: `src/services/payroll.service.ts` - `initiatePayroll()` method

**Integration Logic**:
```typescript
// Check resignation status before processing

// 1. PENDING Resignation (Not yet approved)
if (resignation.status === 'Pending' && resignation.isActive) {
  // INCLUDE in payroll but mark with isPendingResignation = true
  // HR can see and decide whether to process or hold
  record.isPendingResignation = true;
  return record; // Include with warning
}

// 2. APPROVED Resignation
if (resignation.status === 'Approved' && resignation.isActive) {
  if (approvedLastWorkingDay <= payrollMonthEnd) {
    // EXCLUDE - final settlement will create payroll for this month
    return null;
  }
  // CRITICAL: ALWAYS INCLUDE if LWD is in future (regardless of salaryHold)
  // Mark with isSalaryHold flag - HR can see and untick hold to pay
  record.isSalaryHold = resignation.salaryHold || false;
  return record; // Include (can proceed through all stages)
}

// 3. No resignation - include normally
return record;
```

### 8.2 Payroll → Final Settlement Integration

**Location**: `src/services/final-settlement.service.ts` - `processFinalSettlementPayroll()` method

**Integration Logic**:
```typescript
// IMPORTANT: Final settlement CREATES payroll for LWD month
// Example: LWD = Jan 31
// - Jan payroll was EXCLUDED from normal payroll generation
// - Final settlement (triggered on Feb 1) CREATES payroll for Jan month

const lwd = new Date(settlement.approvedLastWorkingDay);
const month = lwd.getMonth() + 1; // Jan = 1
const year = lwd.getFullYear();

// Check if payroll exists for LWD month (usually it won't)
if (existingPayroll) {
  // Rare case: Update existing payroll with final settlement
  existingPayroll.isFinalSettlement = true;
  existingPayroll.netSalary = settlement.netAmount;
} else {
  // Normal case: CREATE NEW payroll record for LWD month
  // This payroll contains final settlement calculations
  // Status: Completed (auto)
  const newPayroll = new Payroll({
    employeeId: settlement.employeeId,
    month, // Jan
    year,
    netSalary: settlement.finalCalculation.netAmount,
    isFinalSettlement: true,
    status: 'Completed', // Auto-complete
    // ... other fields from settlement
  });
}
```

### 8.3 Manual Trigger Only (No Scheduled Job)

**Note**: Final settlement is triggered manually by HR only. No automated scheduled job is required.

**Manual Trigger Route**: `POST /final-settlement/trigger/:userId`

HR will manually trigger final settlement when:
- LWD is reached
- HR wants to process final settlement early
- HR needs to correct/update final settlement timing

---

## 9. Database Migration Required

### 9.1 User Model Migration

Add new fields to existing resignation documents:
```javascript
db.users.updateMany(
  { "resignations.status": "Approved" },
  {
    $set: {
      "resignations.$[elem].salaryHold": true,
      "resignations.$[elem].salaryHoldChangedAt": new Date(),
      "resignations.$[elem].salaryHoldChangedBy": { 
        $ifNull: ["$resignations.$[elem].approvedBy", null] 
      }
    }
  },
  { arrayFilters: [{ "elem.status": "Approved", "elem.isActive": true }] }
);
```

### 9.2 Payroll Model Migration

Add new fields to existing payroll documents:
```javascript
db.payrolls.updateMany(
  {},
  {
    $set: {
      isPendingResignation: false,
      isSalaryHold: false,
      isFinalSettlement: false
    }
  }
);
```

---

## 10. Frontend Integration Points

### 10.1 Payroll Draft Screen Updates

**Changes Required**:
1. **Display Enhancement**:
   - Show employees with PENDING resignation in ORANGE/YELLOW
   - Display tag: "Pending Resignation"
   - Show preferred LWD (if provided by employee)
   - Show employees with APPROVED resignation in RED
   - Display tag: "Resigned – Salary Hold"
   - Show checkbox: "Hold Salary" (auto-ticked if approved resignation)
   - Show approved LWD date

2. **Checkbox Functionality**:
   - If unchecked: Show reason input field
   - On save: Call `POST /payroll/update-salary-hold`
   - Update UI to reflect change

3. **Export Enhancement**:
   - Include resignation status in export
   - Include salary hold status
   - Include approved LWD

### 10.2 Final Settlement Worksheet Screen

**New Screen Required**:
1. **Layout**: Single page with all sections
2. **Sections**:
   - Basic Info (read-only)
   - Notice Period Decision (radio buttons)
   - Notice Period Details (conditional display)
   - Salary & Days (editable)
   - Leave Encashment (editable)
   - Other Deductions (add rows)
   - Other Additions (add rows - optional, for bonus/incentives)
   - Final Calculation (auto-calculated)
3. **Actions**:
   - Save Draft button
   - Preview & Confirm button
   - Cancel button (only if draft)

---

## 11. Testing Scenarios

### 11.1 Resignation Flow
1. Employee submits resignation → Status: Pending
2. HR approves → Status: Approved, salaryHold: true
3. Employee withdraws (before approval) → Status: Withdrawn
4. HR rejects → Status: Rejected

### 11.2 Payroll Integration
1. **Pending Resignation Scenario**:
   - Employee applies resignation in Nov (Pending status)
   - HR generates Dec payroll → Employee included with isPendingResignation = true (marked ORANGE)
   - HR can see "Pending Resignation" tag and preferred LWD
   - HR can decide to process or hold Dec payroll
   - HR approves resignation on Dec 20 → Status changes to Approved
   
2. **Approved Resignation Scenario**:
   - Generate payroll with approved resignation (salaryHold: true) → Payroll CREATED with isSalaryHold = true (marked RED)
   - Payroll can proceed through all stages (Draft → PendingApproval → InPayment → Completed)
   - HR can update salaryHold status → Updates payroll record isSalaryHold flag
   
3. **LWD Month Scenario**:
   - Generate payroll for LWD month → EXCLUDED from normal payroll
   - Final Settlement (triggered manually) → CREATES payroll for LWD month with final settlement calculations

### 11.3 Final Settlement
1. HR manually triggers final settlement (when LWD reached) → User inactive, settlement draft created
2. HR edits settlement → Save draft
3. HR confirms → PDF generated, emails sent, payroll processed
4. Cancel draft → Settlement deleted

### 11.4 Three Scenarios
1. Recovery scenario → Recovery amount deducted
2. No recovery scenario → No notice period deduction
3. Buyout scenario → Buyout amount deducted

---

## 12. File Structure Summary

### New Files to Create:
1. `src/models/final-settlement.model.ts` - Final settlement model
2. `src/services/final-settlement.service.ts` - Final settlement service
3. `src/routes/final-settlement.routes.ts` - Final settlement routes
4. `src/emails/templates/finalSettlementEmail.hbs` - Email template
5. `src/emails/templates/finalSettlementAdminEmail.hbs` - Admin email template

**Note**: No scheduled job file needed - final settlement is manual trigger only

### Files to Update:
1. `src/models/user.model.ts` - Add salaryHold fields to resignation
2. `src/models/payrolls.model.ts` - Add final settlement fields
3. `src/services/user.service.ts` - Update approveResignation(), add updateSalaryHold()
4. `src/services/payroll.service.ts` - Update initiatePayroll(), getPayrollSummary()
5. `src/routes/payroll.routes.ts` - Add update-salary-hold route
6. `src/routes/user.routes.ts` - Add salary-hold route (or user-resignation.routes.ts)
7. `src/container/index.ts` - Register finalSettlementService
8. `src/app.ts` - Register finalSettlementRoutes

---

**Document Generated**: Complete integration flow for Resignation → Payroll → Final Settlement with all implementation details, calculations, and service methods.

