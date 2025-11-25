# Frontend Implementation Guide - Leave Module Features (India Only)

## 📋 Overview

This guide provides complete frontend implementation details for the new leave module features:
1. **Half-Day Leave Application**
2. **Monthly/Quarterly Leave Release**
3. **Year-End Leave Carry-Forward**

All features are **India (IN) employees only**.

---

## 🔌 API Endpoints Reference

### Base URL
```
http://your-api-url.com
```

### Authentication
All endpoints require authentication via JWT token in cookies or Bearer token.

---

## 1️⃣ Half-Day Leave Application

### API Endpoint
```
POST /leaves
```

### Request Body
```typescript
interface HalfDayLeaveRequest {
  leaveTypeId: string;
  startDate: string;          // YYYY-MM-DD (same as endDate for half-day)
  endDate: string;            // YYYY-MM-DD (must equal startDate)
  leaveDuration: 'half-day';  // Required for half-day
  halfDayType: 'first-half' | 'second-half';  // Required
  noOfDays: 0.5;              // Must be 0.5
  reason: string;
  appliedTo: {
    _id: string;
    name: string;
  };
  remarks?: string;
}
```

### Example Request
```javascript
const applyHalfDayLeave = async (leaveData) => {
  const response = await fetch('/leaves', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // For cookie-based auth
    body: JSON.stringify({
      leaveTypeId: 'leaveType123',
      startDate: '2025-03-15',
      endDate: '2025-03-15', // Same as startDate
      leaveDuration: 'half-day',
      halfDayType: 'first-half', // or 'second-half'
      noOfDays: 0.5,
      reason: 'Personal work',
      appliedTo: {
        _id: 'manager123',
        name: 'Manager Name'
      }
    })
  });
  
  return await response.json();
};
```

### Response
```typescript
{
  success: true,
  data: {
    _id: string;
    userId: string;
    leaveTypeId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    leaveDuration: 'half-day';
    halfDayType: 'first-half';
    noOfDays: 0.5;
    status: 'Pending';
    reason: string;
    appliedTo: {
      _id: string;
      name: string;
    };
    createdAt: string;
    updatedAt: string;
  }
}
```

### Error Responses
```typescript
// If not India employee
{
  success: false,
  error: {
    message: 'Half-day leaves are only available for India employees'
  }
}

// If dates don't match
{
  success: false,
  error: {
    message: 'Half-day leaves must be on the same day (startDate = endDate)'
  }
}

// If overlapping half-day exists
{
  success: false,
  error: {
    message: 'A first-half half-day leave already exists for this date'
  }
}
```

---

## 🎨 Frontend Component Example

### React/TypeScript Component

```tsx
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';

interface HalfDayLeaveFormData {
  leaveTypeId: string;
  date: string;
  halfDayType: 'first-half' | 'second-half';
  reason: string;
  remarks?: string;
}

const HalfDayLeaveForm: React.FC<{ userId: string; country: string }> = ({ userId, country }) => {
  const { register, handleSubmit, formState: { errors }, watch } = useForm<HalfDayLeaveFormData>();
  const [loading, setLoading] = useState(false);
  
  // Only show for India employees
  if (country !== 'IN') {
    return null;
  }

  const onSubmit = async (data: HalfDayLeaveFormData) => {
    setLoading(true);
    try {
      const response = await fetch('/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leaveTypeId: data.leaveTypeId,
          startDate: data.date,
          endDate: data.date, // Same date for half-day
          leaveDuration: 'half-day',
          halfDayType: data.halfDayType,
          noOfDays: 0.5,
          reason: data.reason,
          appliedTo: {
            _id: 'manager-id', // Get from context
            name: 'Manager Name'
          },
          remarks: data.remarks
        })
      });
      
      const result = await response.json();
      if (result.success) {
        alert('Half-day leave applied successfully!');
      } else {
        alert(`Error: ${result.error.message}`);
      }
    } catch (error) {
      alert('Failed to apply leave');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="half-day-leave-form">
      <h2>Apply Half-Day Leave</h2>
      
      {/* Leave Type Select */}
      <div className="form-group">
        <label>Leave Type *</label>
        <select {...register('leaveTypeId', { required: true })}>
          <option value="">Select Leave Type</option>
          <option value="annual">Annual Leave</option>
          <option value="sick">Sick Leave</option>
        </select>
        {errors.leaveTypeId && <span className="error">Required</span>}
      </div>

      {/* Date Picker */}
      <div className="form-group">
        <label>Date *</label>
        <input 
          type="date" 
          {...register('date', { required: true })}
          min={new Date().toISOString().split('T')[0]} // No past dates
        />
        {errors.date && <span className="error">Required</span>}
      </div>

      {/* Half-Day Type Radio */}
      <div className="form-group">
        <label>Half-Day Type *</label>
        <div className="radio-group">
          <label>
            <input 
              type="radio" 
              value="first-half" 
              {...register('halfDayType', { required: true })}
            />
            First Half (Morning)
          </label>
          <label>
            <input 
              type="radio" 
              value="second-half" 
              {...register('halfDayType', { required: true })}
            />
            Second Half (Afternoon)
          </label>
        </div>
        {errors.halfDayType && <span className="error">Required</span>}
      </div>

      {/* Reason */}
      <div className="form-group">
        <label>Reason *</label>
        <textarea 
          {...register('reason', { required: true })}
          rows={4}
          placeholder="Enter reason for half-day leave"
        />
        {errors.reason && <span className="error">Required</span>}
      </div>

      {/* Remarks (Optional) */}
      <div className="form-group">
        <label>Remarks</label>
        <textarea 
          {...register('remarks')}
          rows={2}
          placeholder="Additional remarks (optional)"
        />
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Apply Half-Day Leave'}
      </button>
    </form>
  );
};

export default HalfDayLeaveForm;
```

---

## 2️⃣ Monthly/Quarterly Leave Release (Admin Only)

### API Endpoint
```
POST /leave-summary/release
```

### Request Body
```typescript
interface LeaveReleaseRequest {
  employeeIds: string[];        // Array of employee IDs
  releaseType: 'monthly' | 'quarterly';
  period: {
    month?: number;              // 1-12 (required for monthly)
    quarter?: number;            // 1-4 (required for quarterly)
    year: number;
  };
  leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
  daysReleased: number;          // Can be decimal (e.g., 4.5)
  notes?: string;
}
```

### Example Request
```javascript
const releaseLeaves = async (releaseData) => {
  const response = await fetch('/leave-summary/release', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      employeeIds: ['emp1', 'emp2', 'emp3'],
      releaseType: 'quarterly', // or 'monthly'
      period: {
        quarter: 1, // Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec
        year: 2025
      },
      leaveType: 'annual',
      daysReleased: 4.5, // Decimal supported!
      notes: 'Q1 2025 quarterly release'
    })
  });
  
  return await response.json();
};
```

### Response
```typescript
{
  success: true,
  data: {
    success: 2,  // Number of successful releases
    failed: [
      {
        employeeId: 'emp3',
        error: 'Leave releases are only available for India employees'
      }
    ],
    releases: [
      // Array of LeaveRelease objects
    ]
  }
}
```

### Get Release History
```
GET /leave-summary/release-history/:userId?year=2025
```

---

## 🎨 Frontend Component Example - Leave Release (Admin)

```tsx
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';

interface LeaveReleaseFormData {
  employeeIds: string[];
  releaseType: 'monthly' | 'quarterly';
  month?: number;
  quarter?: number;
  year: number;
  leaveType: string;
  daysReleased: number;
  notes?: string;
}

const LeaveReleaseForm: React.FC = () => {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<LeaveReleaseFormData>();
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const releaseType = watch('releaseType');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: LeaveReleaseFormData) => {
    setLoading(true);
    try {
      const period: any = { year: data.year };
      
      if (data.releaseType === 'monthly') {
        period.month = data.month;
      } else {
        period.quarter = data.quarter;
      }

      const response = await fetch('/leave-summary/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employeeIds: selectedEmployees,
          releaseType: data.releaseType,
          period,
          leaveType: data.leaveType,
          daysReleased: parseFloat(data.daysReleased.toString()),
          notes: data.notes
        })
      });

      const result = await response.json();
      if (result.success) {
        alert(`Successfully released to ${result.data.success} employees`);
        if (result.data.failed.length > 0) {
          console.warn('Failed releases:', result.data.failed);
        }
      }
    } catch (error) {
      alert('Failed to release leaves');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="leave-release-form">
      <h2>Release Leaves (India Employees Only)</h2>

      {/* Employee Selection (Multi-select) */}
      <div className="form-group">
        <label>Select Employees *</label>
        <EmployeeMultiSelect 
          selected={selectedEmployees}
          onChange={setSelectedEmployees}
          filterCountry="IN" // Only show India employees
        />
      </div>

      {/* Release Type */}
      <div className="form-group">
        <label>Release Type *</label>
        <select {...register('releaseType', { required: true })}>
          <option value="monthly">Monthly (1 month)</option>
          <option value="quarterly">Quarterly (3 months)</option>
        </select>
      </div>

      {/* Period Selection */}
      <div className="form-group">
        <label>Year *</label>
        <input 
          type="number" 
          {...register('year', { required: true, valueAsNumber: true })}
          defaultValue={new Date().getFullYear()}
          min={2020}
          max={2030}
        />
      </div>

      {/* Month or Quarter */}
      {releaseType === 'monthly' ? (
        <div className="form-group">
          <label>Month *</label>
          <select {...register('month', { required: releaseType === 'monthly', valueAsNumber: true })}>
            <option value="">Select Month</option>
            <option value={1}>January</option>
            <option value={2}>February</option>
            <option value={3}>March</option>
            <option value={4}>April</option>
            <option value={5}>May</option>
            <option value={6}>June</option>
            <option value={7}>July</option>
            <option value={8}>August</option>
            <option value={9}>September</option>
            <option value={10}>October</option>
            <option value={11}>November</option>
            <option value={12}>December</option>
          </select>
          {errors.month && <span className="error">Required</span>}
        </div>
      ) : (
        <div className="form-group">
          <label>Quarter *</label>
          <select {...register('quarter', { required: releaseType === 'quarterly', valueAsNumber: true })}>
            <option value="">Select Quarter</option>
            <option value={1}>Q1 (Jan-Mar)</option>
            <option value={2}>Q2 (Apr-Jun)</option>
            <option value={3}>Q3 (Jul-Sep)</option>
            <option value={4}>Q4 (Oct-Dec)</option>
          </select>
          {errors.quarter && <span className="error">Required</span>}
        </div>
      )}

      {/* Leave Type */}
      <div className="form-group">
        <label>Leave Type *</label>
        <select {...register('leaveType', { required: true })}>
          <option value="">Select Leave Type</option>
          <option value="annual">Annual</option>
          <option value="sick">Sick</option>
          <option value="compOff">Comp Off</option>
          <option value="otherPaid">Other Paid</option>
        </select>
      </div>

      {/* Days to Release (Decimal supported) */}
      <div className="form-group">
        <label>Days to Release *</label>
        <input 
          type="number" 
          step="0.5" 
          min="0.5"
          {...register('daysReleased', { 
            required: true, 
            valueAsNumber: true,
            min: 0.5 
          })}
          placeholder="e.g., 4.5"
        />
        <small>Supports decimals (e.g., 0.5, 1.5, 4.5)</small>
        {errors.daysReleased && <span className="error">Must be at least 0.5</span>}
      </div>

      {/* Notes */}
      <div className="form-group">
        <label>Notes</label>
        <textarea 
          {...register('notes')}
          rows={3}
          placeholder="Optional notes"
        />
      </div>

      <button type="submit" disabled={loading || selectedEmployees.length === 0}>
        {loading ? 'Releasing...' : 'Release Leaves'}
      </button>
    </form>
  );
};

export default LeaveReleaseForm;
```

---

## 3️⃣ Year-End Leave Carry-Forward (Admin Only)

### API Endpoint - Single Employee
```
POST /leave-summary/carry-forward
```

### Request Body
```typescript
interface CarryForwardRequest {
  employeeId: string;
  fromYear: number;
  toYear: number;
  leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
  daysCarriedForward: number;  // Admin-specified amount (can be decimal)
  notes?: string;
}
```

### Example Request
```javascript
const carryForwardLeave = async (carryForwardData) => {
  const response = await fetch('/leave-summary/carry-forward', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      employeeId: 'emp123',
      fromYear: 2024,
      toYear: 2025,
      leaveType: 'annual',
      daysCarriedForward: 10, // Admin enters this manually
      notes: 'Year-end carry-forward'
    })
  });
  
  return await response.json();
};
```

### Get Available Balance for Carry-Forward
```
GET /leave-summary/carry-forward-balance/:userId?year=2024
```

**Response:**
```typescript
{
  success: true,
  data: {
    annual: 15,      // Available balance
    sick: 5,
    compOff: 2,
    lossOfPay: 0,
    otherPaid: 0,
    otherUnpaid: 0
  }
}
```

### Batch Carry-Forward
```
POST /leave-summary/carry-forward/batch
```

**Request Body:**
```typescript
{
  employees: [
    {
      employeeId: 'emp1',
      leaveType: 'annual',
      daysCarriedForward: 10
    },
    {
      employeeId: 'emp2',
      leaveType: 'annual',
      daysCarriedForward: 5.5
    }
  ],
  fromYear: 2024,
  toYear: 2025,
  notes?: string
}
```

---

## 🎨 Frontend Component Example - Carry-Forward (Admin)

```tsx
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';

interface CarryForwardFormData {
  employeeId: string;
  fromYear: number;
  toYear: number;
  leaveType: string;
  daysCarriedForward: number;
  notes?: string;
}

interface AvailableBalance {
  annual?: number;
  sick?: number;
  compOff?: number;
  lossOfPay?: number;
  otherPaid?: number;
  otherUnpaid?: number;
}

const CarryForwardForm: React.FC = () => {
  const { register, handleSubmit, watch, formState: { errors }, setValue } = useForm<CarryForwardFormData>();
  const [availableBalance, setAvailableBalance] = useState<AvailableBalance>({});
  const [loading, setLoading] = useState(false);
  const employeeId = watch('employeeId');
  const fromYear = watch('fromYear');
  const leaveType = watch('leaveType');

  // Fetch available balance when employee and year change
  useEffect(() => {
    if (employeeId && fromYear) {
      fetchAvailableBalance(employeeId, fromYear);
    }
  }, [employeeId, fromYear]);

  const fetchAvailableBalance = async (userId: string, year: number) => {
    try {
      const response = await fetch(`/leave-summary/carry-forward-balance/${userId}?year=${year}`, {
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        setAvailableBalance(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  };

  const onSubmit = async (data: CarryForwardFormData) => {
    const available = availableBalance[data.leaveType as keyof AvailableBalance] || 0;
    
    if (data.daysCarriedForward > available) {
      alert(`Cannot carry forward more than available balance (${available} days)`);
      return;
    }

    if (data.toYear !== data.fromYear + 1) {
      alert('To Year must be From Year + 1');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/leave-summary/carry-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employeeId: data.employeeId,
          fromYear: data.fromYear,
          toYear: data.toYear,
          leaveType: data.leaveType,
          daysCarriedForward: parseFloat(data.daysCarriedForward.toString()),
          notes: data.notes
        })
      });

      const result = await response.json();
      if (result.success) {
        const forfeited = (availableBalance[data.leaveType as keyof AvailableBalance] || 0) - data.daysCarriedForward;
        alert(
          `Carry-forward processed!\n` +
          `Carried Forward: ${data.daysCarriedForward} days\n` +
          `Forfeited: ${forfeited} days`
        );
      } else {
        alert(`Error: ${result.error.message}`);
      }
    } catch (error) {
      alert('Failed to process carry-forward');
    } finally {
      setLoading(false);
    }
  };

  const currentBalance = availableBalance[leaveType as keyof AvailableBalance] || 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="carry-forward-form">
      <h2>Process Leave Carry-Forward (Year-End)</h2>

      {/* Employee Selection */}
      <div className="form-group">
        <label>Select Employee (India Only) *</label>
        <EmployeeSelect 
          value={employeeId}
          onChange={(id) => setValue('employeeId', id)}
          filterCountry="IN"
        />
        {errors.employeeId && <span className="error">Required</span>}
      </div>

      {/* From Year */}
      <div className="form-group">
        <label>From Year *</label>
        <input 
          type="number" 
          {...register('fromYear', { required: true, valueAsNumber: true })}
          defaultValue={2024}
          min={2020}
          max={2030}
        />
      </div>

      {/* To Year (Auto-calculated) */}
      <div className="form-group">
        <label>To Year *</label>
        <input 
          type="number" 
          {...register('toYear', { 
            required: true, 
            valueAsNumber: true,
            validate: (value, formValues) => value === formValues.fromYear + 1
          })}
          readOnly
          value={watch('fromYear') ? watch('fromYear') + 1 : ''}
        />
        <small>Automatically set to From Year + 1</small>
        {errors.toYear && <span className="error">Must be From Year + 1</span>}
      </div>

      {/* Leave Type */}
      <div className="form-group">
        <label>Leave Type *</label>
        <select {...register('leaveType', { required: true })}>
          <option value="">Select Leave Type</option>
          <option value="annual">Annual</option>
          <option value="sick">Sick</option>
          <option value="compOff">Comp Off</option>
          <option value="otherPaid">Other Paid</option>
        </select>
      </div>

      {/* Available Balance Display */}
      {leaveType && currentBalance > 0 && (
        <div className="balance-display">
          <strong>Available Balance: {currentBalance} days</strong>
        </div>
      )}

      {/* Days to Carry Forward (Manual Input) */}
      <div className="form-group">
        <label>Days to Carry Forward *</label>
        <input 
          type="number" 
          step="0.5"
          min="0"
          max={currentBalance}
          {...register('daysCarriedForward', { 
            required: true, 
            valueAsNumber: true,
            min: 0,
            max: currentBalance || 999
          })}
          placeholder={`Max: ${currentBalance} days`}
        />
        <small>
          Enter how many days to carry forward (will forfeit {currentBalance > 0 ? (currentBalance - (watch('daysCarriedForward') || 0)).toFixed(1) : 0} days)
        </small>
        {errors.daysCarriedForward && (
          <span className="error">
            {errors.daysCarriedForward.type === 'max' 
              ? `Cannot exceed available balance (${currentBalance} days)`
              : 'Required'
            }
          </span>
        )}
      </div>

      {/* Notes */}
      <div className="form-group">
        <label>Notes</label>
        <textarea 
          {...register('notes')}
          rows={3}
          placeholder="Optional notes"
        />
      </div>

      <button type="submit" disabled={loading || !employeeId || !leaveType}>
        {loading ? 'Processing...' : 'Process Carry-Forward'}
      </button>
    </form>
  );
};

export default CarryForwardForm;
```

---

## 📊 Example UI Layouts

### 1. Leave Application Form (Employee View)

```tsx
const LeaveApplicationPage: React.FC = () => {
  const [leaveType, setLeaveType] = useState<'full-day' | 'half-day'>('full-day');

  return (
    <div className="leave-application-page">
      <h1>Apply for Leave</h1>
      
      {/* Leave Type Toggle */}
      <div className="leave-type-toggle">
        <button 
          onClick={() => setLeaveType('full-day')}
          className={leaveType === 'full-day' ? 'active' : ''}
        >
          Full Day Leave
        </button>
        <button 
          onClick={() => setLeaveType('half-day')}
          className={leaveType === 'half-day' ? 'active' : ''}
        >
          Half Day Leave
        </button>
      </div>

      {/* Conditional Form Rendering */}
      {leaveType === 'half-day' ? (
        <HalfDayLeaveForm />
      ) : (
        <FullDayLeaveForm />
      )}
    </div>
  );
};
```

### 2. Leave Release Dashboard (Admin View)

```tsx
const LeaveReleaseDashboard: React.FC = () => {
  return (
    <div className="leave-release-dashboard">
      <h1>Leave Release Management</h1>
      
      <div className="release-tabs">
        <Tabs>
          <Tab label="Release Leaves">
            <LeaveReleaseForm />
          </Tab>
          <Tab label="Release History">
            <LeaveReleaseHistory />
          </Tab>
        </Tabs>
      </div>
    </div>
  );
};
```

### 3. Year-End Carry-Forward Page (Admin View)

```tsx
const YearEndCarryForwardPage: React.FC = () => {
  return (
    <div className="year-end-carry-forward">
      <h1>Year-End Leave Carry-Forward</h1>
      
      <div className="carry-forward-options">
        <Tabs>
          <Tab label="Single Employee">
            <CarryForwardForm />
          </Tab>
          <Tab label="Batch Process">
            <BatchCarryForwardForm />
          </Tab>
        </Tabs>
      </div>
    </div>
  );
};
```

---

## 🔍 Helper Functions

### Check if Employee is from India

```typescript
// In your employee/user context
const isIndiaEmployee = (employee: Employee): boolean => {
  return employee.country === 'IN';
};
```

### Format Quarter Display

```typescript
const formatQuarter = (quarter: number, year: number): string => {
  const quarterNames: { [key: number]: string } = {
    1: 'Q1 (Jan-Mar)',
    2: 'Q2 (Apr-Jun)',
    3: 'Q3 (Jul-Sep)',
    4: 'Q4 (Oct-Dec)'
  };
  return `${quarterNames[quarter]} ${year}`;
};
```

### Calculate Forfeited Days

```typescript
const calculateForfeitedDays = (
  availableBalance: number,
  daysCarriedForward: number
): number => {
  return Math.max(0, availableBalance - daysCarriedForward);
};
```

---

## ⚠️ Validation Rules Summary

### Half-Day Leave
- ✅ Employee must be from India (IN)
- ✅ startDate === endDate (same day)
- ✅ halfDayType must be specified
- ✅ noOfDays must be 0.5
- ✅ No overlapping half-days on same date with same type

### Leave Release
- ✅ All employees must be from India (IN)
- ✅ daysReleased > 0
- ✅ Supports decimals (0.5, 4.5, etc.)
- ✅ Valid month (1-12) for monthly release
- ✅ Valid quarter (1-4) for quarterly release

### Carry-Forward
- ✅ Employee must be from India (IN)
- ✅ toYear === fromYear + 1
- ✅ daysCarriedForward <= available balance
- ✅ Cannot process duplicate carry-forward
- ✅ daysCarriedForward >= 0

---

## 📱 Mobile Responsive Considerations

1. **Date Pickers**: Use native mobile date pickers
2. **Form Layout**: Stack form fields vertically on mobile
3. **Multi-select**: Use dropdown with checkboxes or chips
4. **Decimal Input**: Use `step="0.5"` for number inputs
5. **Validation Messages**: Show inline errors below fields

---

## 🎯 Next Steps

1. Create API service layer (axios/fetch wrapper)
2. Add loading states and error handling
3. Implement form validation
4. Add success/error toast notifications
5. Create reusable components
6. Add unit tests
7. Implement role-based access (admin vs employee)

---

*Frontend Implementation Guide v1.0*  
*Last Updated: January 2025*

