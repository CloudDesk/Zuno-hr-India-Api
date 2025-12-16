import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { Types } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { User } from '../models/user.model';
import { Shift, ShiftAssignment } from '../models/shift.model';
import { Leave } from '../models/leave.model';
import { SalaryAssignment } from '../models/salary-assignments.model';
import { SalaryStructure } from '../models/salary-structure.model';
import { AttendanceRecord } from '../models/attendance-record.model';
import { LOV } from '../models/lov.model';
import { HolidayCalendar } from '../models/holiday-calendar.model';
import { OptionalHolidayRequest } from '../models/optional-holiday-request.model';
import { LeaveSummaryService } from './leave-summary.service';

export type ExportableObject = 'user' | 'shift' | 'leave' | 'salary-assignment' | 'salary-structure' | 'attendance-record' | 'optional-holiday';

export interface IExportRequest {
  objects: ExportableObject[];
  filters?: {
    [key: string]: any;
  };
}

export interface IImportRow {
  rowNumber: number;
  [key: string]: any;
}

export interface IValidationError {
  rowNumber: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface IValidationResult {
  validRows: IImportRow[];
  invalidRows: IImportRow[];
  errors: IValidationError[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errors: number;
    warnings: number;
  };
}

export interface IImportRequest {
  objects: ExportableObject[];
  validRows: {
    [objectType: string]: IImportRow[];
  };
}

// Constants
const CONSTANTS = {
  BOOLEAN_YES: 'yes',
  BOOLEAN_NO: 'no',
  DEFAULT_COUNTRY: 'IN',
  DEFAULT_CURRENCY_INR: 'INR',
  DEFAULT_CURRENCY_AED: 'AED',
  DEFAULT_LICENSE_TYPE: 'employee',
  ATTENDANCE_RECORD_EXPORT_LIMIT: 10000,
  PASSWORD_MIN_LENGTH: 12,
  VALID_ROLES: ['admin', 'manager', 'staff', 'external'],
  VALID_COUNTRIES: ['IN', 'AE'],
  VALID_VISA_TYPES: ['Standard Employment Visa', 'Domestic Worker Visa', 'Green Visa'],
  DATE_FORMAT_ISO: 'YYYY-MM-DD',
  TIME_FORMAT: 'HH:mm'
} as const;

export class DataMigrationService extends BaseService {
  private leaveSummaryService: LeaveSummaryService;

  constructor(context: RequestContext) {
    super(context);
    this.leaveSummaryService = new LeaveSummaryService(context);
  }

  /**
   * Generate Excel template with headers only (for import)
   */
  async generateTemplate(objects: ExportableObject[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    for (const objectType of objects) {
      await this.createTemplateSheet(workbook, objectType);
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * Create template sheet with headers only
   */
  private async createTemplateSheet(
    workbook: ExcelJS.Workbook,
    objectType: ExportableObject
  ): Promise<void> {
    const sheetName = this.getSheetName(objectType);
    const worksheet = workbook.addWorksheet(sheetName);

    switch (objectType) {
      case 'user':
        this.createUserTemplate(worksheet);
        break;
      case 'shift':
        this.createShiftTemplate(worksheet);
        break;
      case 'leave':
        this.createLeaveTemplate(worksheet);
        break;
      case 'salary-assignment':
        this.createSalaryAssignmentTemplate(worksheet);
        break;
      case 'salary-structure':
        this.createSalaryStructureTemplate(worksheet);
        break;
      case 'attendance-record':
        this.createAttendanceRecordTemplate(worksheet);
        break;
      case 'optional-holiday':
        this.createOptionalHolidayTemplate(worksheet);
        break;
    }

    this.autoFitColumns(worksheet);
    this.addInstructionsRow(worksheet, objectType);
  }

  /**
   * Add instructions row below headers
   */
  private addInstructionsRow(worksheet: ExcelJS.Worksheet, objectType: ExportableObject): void {
    const instructions: { [key: string]: string[] } = {
      'user': [
        'Instructions:',
        '• Fields marked (Required) must be filled',
        '• Fields marked (Optional) can be left empty',
        '• Email must be unique',
        '• For AE users: Visa Type and Visa Expiry Date are required',
        '• Biometric ID only for non-IN/AE countries',
        '• Date formats: YYYY-MM-DD or DD/MM/YYYY',
        '• Boolean fields: Yes/No (case insensitive)'
      ],
      'shift': [
        'Instructions:',
        '• All time fields must be in HH:mm format (e.g., 09:00)',
        '• Shift window start must be <= shift start time',
        '• Shift window end must be > shift start time',
        '• For overnight shifts: end time must be < start time',
        '• Code must be unique'
      ],
      'leave': [
        'Instructions:',
        '• For half-day leaves: startDate = endDate, noOfDays = 0.5, halfDayType required',
        '• For full-day leaves: halfDayType must be empty',
        '• End date must be >= start date',
        '• Date formats: YYYY-MM-DD or DD/MM/YYYY'
      ],
      'salary-assignment': [
        'Instructions:',
        '• All numeric fields must be >= 0',
        '• Effective To must be > Effective From',
        '• If Is Active = Yes, other active assignments for same employee will be deactivated',
        '• Note: User Active status defaults to Yes, but can be set to No for historical data migration',
        '• Date formats: YYYY-MM-DD or DD/MM/YYYY'
      ],
      'salary-structure': [
        'Instructions:',
        '• All percentage fields must be between 0 and 100',
        '• Country must be IN or AE'
      ],
      'attendance-record': [
        'Instructions:',
        '• Shift Start and Shift End must be valid ISO DateTime format',
        '• Shift End must be > Shift Start',
        '• Shift Code should match the Shift ID',
        '• Date formats: YYYY-MM-DD for shiftDay, ISO DateTime for times'
      ],
      'optional-holiday': [
        'Instructions:',
        '• User ID must be valid and user must exist',
        '• Holiday Date must be an optional holiday in user\'s calendar',
        '• Holiday Name must match the optional holiday name in calendar',
        '• Status: Pending, Approved, Rejected, or Cancelled (default: Pending)',
        '• Year must match the holiday date year',
        '• Maximum 2 approved optional holidays per year per employee',
        '• Date formats: YYYY-MM-DD'
      ]
    };

    const instructionText = instructions[objectType];
    if (instructionText) {
      // Add empty row
      worksheet.addRow([]);
      // Add instructions
      instructionText.forEach((instruction) => {
        const row = worksheet.addRow([instruction]);
        if (instruction === 'Instructions:') {
          row.getCell(1).font = { bold: true };
        }
      });
    }
  }

  /**
   * Create User template
   */
  private createUserTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'Name (Required)',
      'Email (Required if Active=Yes, Optional if Active=No for historical data)',
      'Role (Required)',
      'Specific Role (Optional)',
      'Department ID (Required)',
      'Manager ID (Required)',
      'Employee No (Optional)',
      'Check-in ID (Optional)',
      'Biometric ID (Optional - Non-IN/AE only)',
      'Active (Optional - Default: Yes. Can be set to No for historical data migration)',
      'Joining Date (Required)',
      'Confirmation Date (Optional)',
      'Probation Date (Optional)',
      'Location (Optional)',
      'Phone (Optional)',
      'Emergency Contact (Optional)',
      'Address (Optional)',
      'Blood Group (Optional)',
      'Date of Birth (Required)',
      'Father\'s Name (Optional)',
      'Marital Status (Optional)',
      'Spouse Name (Optional)',
      'Separation Date (Optional)',
      'Notice Period (Optional)',
      'Personal Mail ID (Optional)',
      'Country (Required)',
      'Currency (Optional - Auto-set by Country)',
      'License Type (Optional - Default: employee)',
      'Portal Access (Optional - Default: Yes)',
      'Visa Type (Required for AE users)',
      'Visa Expiry Date (Required for AE users)',
      'Visa Is Active (Optional - Default: Yes)',
      'Client (Optional)',
      'Holiday Calendar ID (Optional)',
      'Shift ID (Optional - Required if creating shift assignment)'
      // Note: FCM Token is not included - it's set automatically when users log into the mobile app
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Full name of the user' },
      2: { required: false, note: 'Valid email address, must be unique. Required if Active=Yes, optional if Active=No (for historical data migration)' },
      3: { required: true, note: 'Must be one of: admin, manager, staff, external' },
      4: { required: false, note: 'Specific role designation' },
      5: { required: true, note: 'Must exist in Department LOV' },
      6: { required: true, note: 'Valid User ID of manager (Required)' },
      7: { required: false, note: 'Employee number, must be unique if provided' },
      8: { required: false, note: 'Check-in ID, must be unique if provided' },
      9: { required: false, note: 'Only for non-IN/AE countries, must be unique if provided' },
      10: { required: false, note: 'Yes/No, defaults to Yes. Can be set to No for historical data migration' },
      11: { required: true, note: 'Format: YYYY-MM-DD or DD/MM/YYYY (Required)' },
      12: { required: false, note: 'Format: YYYY-MM-DD or DD/MM/YYYY. Employee confirmation date (Optional)' },
      13: { required: false, note: 'Format: YYYY-MM-DD or DD/MM/YYYY. Employee probation date (Optional)' },
      14: { required: false, note: 'User location' },
      15: { required: false, note: 'Phone number' },
      16: { required: false, note: 'Emergency contact information' },
      17: { required: false, note: 'User address' },
      18: { required: false, note: 'Blood group' },
      19: { required: true, note: 'Format: YYYY-MM-DD or DD/MM/YYYY (Required)' },
      20: { required: false, note: 'Father\'s name' },
      21: { required: false, note: 'Single, Married, Divorced, or Widowed' },
      22: { required: false, note: 'Spouse name (if married)' },
      23: { required: false, note: 'Format: YYYY-MM-DD or DD/MM/YYYY. Employee separation date' },
      24: { required: false, note: 'Notice period in days (number)' },
      25: { required: false, note: 'Personal email address (must be valid format)' },
      26: { required: true, note: 'Required field. Must be IN or AE' },
      27: { required: false, note: 'INR for IN, AED for AE (auto-set if not provided)' },
      28: { required: false, note: 'employee or external, defaults to employee' },
      29: { required: false, note: 'Yes/No, defaults to Yes' },
      30: { required: false, note: 'Required for AE users: Standard Employment Visa, Domestic Worker Visa, or Green Visa' },
      31: { required: false, note: 'Required for AE users, must be future date, format: YYYY-MM-DD' },
      32: { required: false, note: 'Yes/No, defaults to Yes' },
      33: { required: false, note: 'Client assignment' },
      34: { required: false, note: 'Valid Holiday Calendar ID' },
      35: { required: false, note: 'Valid Shift ID. Required if shift-assignment is also being imported. Shift assignment will be created with joining date as start date and weekend [0,6]' }
    });
  }

  /**
   * Create Shift template
   */
  private createShiftTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'Name (Required)',
      'Code (Required)',
      'Start Time (Required)',
      'End Time (Required)',
      'Shift Window Start (Required)',
      'Shift Window End (Required)',
      'Valid From (Optional - Default: Today)',
      'Valid Till (Optional)',
      'Is Active (Optional - Default: No)',
      'Description (Optional)',
      'Grace Time (Minutes) (Optional - Default: 15)',
      'Is Overnight Shift (Optional - Default: No)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Shift name' },
      2: { required: true, note: 'Unique shift code (uppercase)' },
      3: { required: true, note: 'Format: HH:mm (e.g., 09:00)' },
      4: { required: true, note: 'Format: HH:mm (e.g., 18:00). For overnight shifts, must be < start time' },
      5: { required: true, note: 'Format: HH:mm, must be <= start time' },
      6: { required: true, note: 'Format: HH:mm, must be > start time' },
      7: { required: false, note: 'Format: YYYY-MM-DD' },
      8: { required: false, note: 'Format: YYYY-MM-DD' },
      9: { required: false, note: 'Yes/No, defaults to No' },
      10: { required: false, note: 'Shift description' },
      11: { required: false, note: 'Number between 0-60, defaults to 15' },
      12: { required: false, note: 'Yes/No, defaults to No. If Yes, end time must be < start time' }
    });
  }

  /**
   * Create Leave template
   */
  private createLeaveTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'User ID (Required)',
      'Leave Type ID (Required)',
      'Leave Type (Optional)',
      'Start Date (Required)',
      'End Date (Required)',
      'No of Days (Required for half-day: 0.5)',
      'Status (Optional - Default: Pending)',
      'Remarks (Optional)',
      'Reason (Optional)',
      'Applied To ID (Optional)',
      'Applied To Name (Optional)',
      'Approved By ID (Optional)',
      'Approved At (Optional)',
      'Leave Duration (Optional - Default: full-day)',
      'Half Day Type (Required for half-day leaves)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Valid User ID' },
      2: { required: true, note: 'Valid Leave Type ID from LOV' },
      3: { required: false, note: 'Leave type name' },
      4: { required: true, note: 'Format: YYYY-MM-DD. For half-day, must equal end date' },
      5: { required: true, note: 'Format: YYYY-MM-DD. Must be >= start date. For half-day, must equal start date' },
      6: { required: false, note: 'For half-day leaves, must be exactly 0.5' },
      7: { required: false, note: 'Pending, Approved, Rejected, or Cancelled' },
      8: { required: false, note: 'Additional remarks' },
      9: { required: false, note: 'Reason for leave' },
      10: { required: false, note: 'User ID to whom leave is applied' },
      11: { required: false, note: 'Name of person to whom leave is applied' },
      12: { required: false, note: 'User ID of approver' },
      13: { required: false, note: 'Format: YYYY-MM-DD' },
      14: { required: false, note: 'full-day or half-day. For half-day: startDate = endDate, noOfDays = 0.5, halfDayType required' },
      15: { required: false, note: 'Required for half-day leaves: first-half or second-half' }
    });
  }

  /**
   * Create Optional Holiday template
   */
  private createOptionalHolidayTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'User ID (Required)',
      'Holiday Date (Required)',
      'Holiday Name (Required)',
      'Year (Required)',
      'Status (Optional - Default: Pending)',
      'Reason (Optional)',
      'Remarks (Optional)',
      'Applied To ID (Optional)',
      'Applied To Name (Optional)',
      'Approved By ID (Optional)',
      'Approved At (Optional)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Valid User ID' },
      2: { required: true, note: 'Format: YYYY-MM-DD. Must be an optional holiday in user\'s calendar' },
      3: { required: true, note: 'Name of the optional holiday' },
      4: { required: true, note: 'Year of the holiday (must match holiday date year)' },
      5: { required: false, note: 'Pending, Approved, Rejected, or Cancelled' },
      6: { required: false, note: 'Reason for requesting optional holiday' },
      7: { required: false, note: 'Remarks from approver' },
      8: { required: false, note: 'User ID of manager/admin to approve' },
      9: { required: false, note: 'Name of manager/admin' },
      10: { required: false, note: 'User ID of approver (if status is Approved/Rejected)' },
      11: { required: false, note: 'Format: YYYY-MM-DD. Approval date' }
    });
  }

  /**
   * Create Salary Assignment template
   */
  private createSalaryAssignmentTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'Employee ID (Required)',
      'Salary Structure ID (Required)',
      'Monthly Gross (Required)',
      'Monthly Insurance (Required)',
      'Reimbursement (Required)',
      'Travel Allowance (Optional - Default: 0)',
      'Air Ticket Allowance (Optional - Default: 0)',
      'Medical Allowance (Optional - Default: 0)',
      'Is Active (Optional - Default: No)',
      'Effective From (Required)',
      'Effective To (Required)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Valid User ID of employee' },
      2: { required: true, note: 'Valid Salary Structure ID' },
      3: { required: true, note: 'Monthly gross salary (must be >= 0)' },
      4: { required: true, note: 'Monthly insurance amount (must be >= 0)' },
      5: { required: true, note: 'Reimbursement amount (must be >= 0)' },
      6: { required: false, note: 'Travel allowance (must be >= 0)' },
      7: { required: false, note: 'Air ticket allowance (must be >= 0)' },
      8: { required: false, note: 'Medical allowance (must be >= 0)' },
      9: { required: false, note: 'Yes/No, defaults to No. If Yes, deactivates other active assignments' },
      10: { required: true, note: 'Format: YYYY-MM-DD' },
      11: { required: true, note: 'Format: YYYY-MM-DD, must be > effective from' }
    });
  }

  /**
   * Create Salary Structure template
   */
  private createSalaryStructureTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'Name (Required)',
      'Country (Required)',
      'Basic Percentage (Optional - Default: 0)',
      'HRA Percentage (Optional - Default: 0)',
      'DA Percentage (Optional - Default: 0)',
      'Other Allowance Percentage (Optional - Default: 0)',
      'Travel Allowance Percentage (Optional - Default: 0)',
      'Reimbursement Percentage (Optional - Default: 0)',
      'EPF Employee Contribution (Optional - Default: 0)',
      'EPF Employer Contribution (Optional - Default: 0)',
      'EPF Max Limit (Optional - Default: 0)',
      'ESI Employee Contribution (Optional - Default: 0)',
      'ESI Employer Contribution (Optional - Default: 0)',
      'ESI Applicability Limit (Optional - Default: 0)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Salary structure name' },
      2: { required: true, note: 'IN or AE' },
      3: { required: false, note: 'Percentage (0-100)' },
      4: { required: false, note: 'Percentage (0-100)' },
      5: { required: false, note: 'Percentage (0-100)' },
      6: { required: false, note: 'Percentage (0-100)' },
      7: { required: false, note: 'Percentage (0-100)' },
      8: { required: false, note: 'Percentage (0-100)' },
      9: { required: false, note: 'EPF employee contribution percentage' },
      10: { required: false, note: 'EPF employer contribution percentage' },
      11: { required: false, note: 'EPF maximum limit' },
      12: { required: false, note: 'ESI employee contribution percentage' },
      13: { required: false, note: 'ESI employer contribution percentage' },
      14: { required: false, note: 'ESI applicability limit' }
    });
  }

  /**
   * Create Attendance Record template
   */
  private createAttendanceRecordTemplate(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'User ID (Required)',
      'Shift ID (Required)',
      'Shift Code (Required)',
      'Shift Day (Required)',
      'Shift Start (Required)',
      'Shift End (Required)',
      'First In (Optional)',
      'Last Out (Optional)',
      'Total Work Hours (Optional - Default: 0:00:00)',
      'Status (Optional - Default: complete)',
      'Is Within Window (Optional - Default: No)',
      'Is Late Entry (Optional - Default: No)',
      'Is Early Exit (Optional - Default: No)'
    ];
    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    // Add detailed notes to header cells
    this.addFieldRequirementNotes(worksheet, {
      1: { required: true, note: 'Valid User ID' },
      2: { required: true, note: 'Valid Shift ID' },
      3: { required: true, note: 'Shift code (should match Shift ID)' },
      4: { required: true, note: 'Format: YYYY-MM-DD' },
      5: { required: true, note: 'Format: ISO DateTime (e.g., 2025-01-15T09:00:00Z)' },
      6: { required: true, note: 'Format: ISO DateTime, must be > shift start' },
      7: { required: false, note: 'Format: ISO DateTime' },
      8: { required: false, note: 'Format: ISO DateTime' },
      9: { required: false, note: 'Format: HH:mm:ss (e.g., 08:30:00)' },
      10: { required: false, note: 'Attendance status' },
      11: { required: false, note: 'Yes/No' },
      12: { required: false, note: 'Yes/No' },
      13: { required: false, note: 'Yes/No' }
    });
  }

  /**
   * Export selected objects to Excel
   */
  async exportToExcel(request: IExportRequest): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    for (const objectType of request.objects) {
      await this.exportObject(workbook, objectType, request.filters);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as any);
  }

  /**
   * Export a single object type to Excel sheet
   */
  private async exportObject(
    workbook: ExcelJS.Workbook,
    objectType: ExportableObject,
    filters?: { [key: string]: any }
  ): Promise<void> {
    const sheetName = this.getSheetName(objectType);
    const worksheet = workbook.addWorksheet(sheetName);

    switch (objectType) {
      case 'user':
        await this.exportUsers(worksheet, filters);
        break;
      case 'shift':
        await this.exportShifts(worksheet, filters);
        break;
      case 'leave':
        await this.exportLeaves(worksheet, filters);
        break;
      case 'salary-assignment':
        await this.exportSalaryAssignments(worksheet, filters);
        break;
      case 'salary-structure':
        await this.exportSalaryStructures(worksheet, filters);
        break;
      case 'attendance-record':
        await this.exportAttendanceRecords(worksheet, filters);
        break;
      case 'optional-holiday':
        await this.exportOptionalHolidays(worksheet, filters);
        break;
    }
  }

  /**
   * Export Users to Excel
   */
  private async exportUsers(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'User ID',
      'Name',
      'Email',
      'Role',
      'Specific Role',
      'Department ID',
      'Manager ID',
      'Employee No',
      'Check-in ID',
      'Biometric ID',
      'Active',
      'Joining Date',
      'Confirmation Date',
      'Probation Date',
      'Location',
      'Phone',
      'Emergency Contact',
      'Address',
      'Blood Group',
      'Date of Birth',
      'Father\'s Name',
      'Marital Status',
      'Spouse Name',
      'Separation Date',
      'Notice Period',
      'Personal Mail ID',
      'Country',
      'Currency',
      'License Type',
      'Portal Access',
      'Visa Type',
      'Visa Expiry Date',
      'Visa Is Active',
      'Client',
      'Holiday Calendar ID',
      'FCM Token'  // Exported for reference (but not used in import - set automatically by mobile app)
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.active !== undefined) query.active = filters.active;
    if (filters?.country) query.country = filters.country;
    if (filters?.role) query.role = filters.role;
    if (filters?.departmentId) query.departmentId = filters.departmentId;

    const users = await User.find(query)
      .select('name email role specificRole departmentId managerId employeeCode checkinId biometricId active joiningDate confirmationDate probationDate location phone emergencyContact address bloodGroup dateOfBirth fatherName maritalStatus spouseName separationDate noticePeriod personalMailId country currency licenseType portalAccess visaDetails client holidayCalendarId fcmToken')
      .lean();

    for (const user of users) {
      const row = [
        user._id?.toString() || '',  // User ID as first column
        user.name || '',
        user.email || '',
        user.role || '',
        user.specificRole || '',
        user.departmentId || '',
        user.managerId?.toString() || '',
        user.employeeCode || '',
        user.checkinId || '',
        user.biometricId || '',
        user.active ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase(),
        user.joiningDate ? new Date(user.joiningDate).toISOString().split('T')[0] : '',
        user.confirmationDate ? new Date(user.confirmationDate).toISOString().split('T')[0] : '',
        user.probationDate ? new Date(user.probationDate).toISOString().split('T')[0] : '',
        user.location || '',
        user.phone || '',
        user.emergencyContact 
          ? (typeof user.emergencyContact === 'string' 
              ? user.emergencyContact 
              : user.emergencyContact.mobileNo || '')
          : '',
        user.address || '',
        user.bloodGroup || '',
        user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '',
        user.fatherName || '',
        user.maritalStatus || '',
        user.spouseName || '',
        user.separationDate ? new Date(user.separationDate).toISOString().split('T')[0] : '',
        user.noticePeriod || '',
        user.personalMailId || '',
        user.country || CONSTANTS.DEFAULT_COUNTRY,
        user.currency || CONSTANTS.DEFAULT_CURRENCY_INR,
        user.licenseType || CONSTANTS.DEFAULT_LICENSE_TYPE,
        user.portalAccess ? 'Yes' : 'No',
        user.visaDetails?.visaType || '',
        user.visaDetails?.visaExpiryDate ? new Date(user.visaDetails.visaExpiryDate).toISOString().split('T')[0] : '',
        user.visaDetails?.isActive ? 'Yes' : 'No',
        user.client || '',
        user.holidayCalendarId?.toString() || '',
        user.fcmToken || ''  // Exported for reference only (not imported - set by mobile app)
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Shifts to Excel
   */
  private async exportShifts(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'Shift ID',
      'Name',
      'Code',
      'Start Time',
      'End Time',
      'Shift Window Start',
      'Shift Window End',
      'Valid From',
      'Valid Till',
      'Is Active',
      'Description',
      'Grace Time (Minutes)',
      'Is Overnight Shift'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.isActive !== undefined) query.isActive = filters.isActive;

    const shifts = await Shift.find(query).lean();

    for (const shift of shifts) {
      const row = [
        shift._id?.toString() || '',
        shift.name || '',
        shift.code || '',
        shift.startTime || '',
        shift.endTime || '',
        shift.shiftWindowStart || '',
        shift.shiftWindowEnd || '',
        shift.validFrom ? new Date(shift.validFrom).toISOString().split('T')[0] : '',
        shift.validTill ? new Date(shift.validTill).toISOString().split('T')[0] : '',
        shift.isActive ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase(),
        shift.description || '',
        shift.graceTimeInMinutes || 15,
        shift.isOvernightShift ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase()
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Leaves to Excel
   */
  private async exportLeaves(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'User ID',
      'Leave Type ID',
      'Leave Type',
      'Start Date',
      'End Date',
      'No of Days',
      'Status',
      'Remarks',
      'Reason',
      'Applied To ID',
      'Applied To Name',
      'Approved By ID',
      'Approved At',
      'Leave Duration',
      'Half Day Type'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.userId) query.userId = new Types.ObjectId(filters.userId);

    const leaves = await Leave.find(query).lean();

    for (const leave of leaves) {
      const row = [
        leave.userId?.toString() || '',
        leave.leaveTypeId?.toString() || '',
        leave.leaveType || '',
        leave.startDate ? new Date(leave.startDate).toISOString().split('T')[0] : '',
        leave.endDate ? new Date(leave.endDate).toISOString().split('T')[0] : '',
        leave.noOfDays || 0,
        leave.status || 'Pending',
        leave.remarks || '',
        leave.reason || '',
        leave.appliedTo?._id || '',
        leave.appliedTo?.name || '',
        leave.approvedById?.toString() || '',
        leave.approvedAt ? new Date(leave.approvedAt).toISOString().split('T')[0] : '',
        leave.leaveDuration || 'full-day',
        leave.halfDayType || ''
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Salary Assignments to Excel
   */
  private async exportSalaryAssignments(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'Employee ID',
      'Salary Structure ID',
      'Monthly Gross',
      'Monthly Insurance',
      'Reimbursement',
      'Travel Allowance',
      'Air Ticket Allowance',
      'Medical Allowance',
      'Is Active',
      'Effective From',
      'Effective To'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.employeeId) query.employeeId = new Types.ObjectId(filters.employeeId);
    if (filters?.isActive !== undefined) query.isActive = filters.isActive;

    const assignments = await SalaryAssignment.find(query).lean();

    for (const assignment of assignments) {
      const row = [
        assignment.employeeId?.toString() || '',
        assignment.salaryStructureId?.toString() || '',
        assignment.monthlyGross || 0,
        assignment.monthlyInsurance || 0,
        assignment.reimbursement || 0,
        assignment.travelAllowance || 0,
        assignment.airTicketAllowance || 0,
        assignment.medicalAllowance || 0,
        assignment.isActive ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase(),
        assignment.effectiveFrom ? new Date(assignment.effectiveFrom).toISOString().split('T')[0] : '',
        assignment.effectiveTo ? new Date(assignment.effectiveTo).toISOString().split('T')[0] : ''
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Salary Structures to Excel
   */
  private async exportSalaryStructures(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'Name',
      'Country',
      'Basic Percentage',
      'HRA Percentage',
      'DA Percentage',
      'Other Allowance Percentage',
      'Travel Allowance Percentage',
      'Reimbursement Percentage',
      'EPF Employee Contribution',
      'EPF Employer Contribution',
      'EPF Max Limit',
      'ESI Employee Contribution',
      'ESI Employer Contribution',
      'ESI Applicability Limit'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.country) query.country = filters.country;

    const structures = await SalaryStructure.find(query).lean();

    for (const structure of structures) {
      const row = [
        structure.name || '',
        structure.country || CONSTANTS.DEFAULT_COUNTRY,
        structure.fixedEarnings?.basicPercentage || 0,
        structure.fixedEarnings?.hraPercentage || 0,
        structure.fixedEarnings?.daPercentage || 0,
        structure.fixedEarnings?.otherAllowancePercentage || 0,
        structure.fixedEarnings?.travelAllowancePercentage || 0,
        structure.fixedEarnings?.reimbursementPercentage || 0,
        structure.statutoryDeductions?.epf?.employeeContribution || 0,
        structure.statutoryDeductions?.epf?.employerContribution || 0,
        structure.statutoryDeductions?.epf?.maxLimit || 0,
        structure.statutoryDeductions?.esi?.employeeContribution || 0,
        structure.statutoryDeductions?.esi?.employerContribution || 0,
        structure.statutoryDeductions?.esi?.applicabilityLimit || 0
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Attendance Records to Excel
   */
  private async exportAttendanceRecords(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'User ID',
      'Shift ID',
      'Shift Code',
      'Shift Day',
      'Shift Start',
      'Shift End',
      'First In',
      'Last Out',
      'Total Work Hours',
      'Status',
      'Is Within Window',
      'Is Late Entry',
      'Is Early Exit'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters?.shiftCode) query.shiftCode = filters.shiftCode;
    if (filters?.shiftDay) query.shiftDay = new Date(filters.shiftDay);

    const records = await AttendanceRecord.find(query)
      .limit(CONSTANTS.ATTENDANCE_RECORD_EXPORT_LIMIT) // Limit to prevent memory issues
      .lean();

    for (const record of records) {
      const row = [
        record.userId?.toString() || '',
        record.shiftId?.toString() || '',
        record.shiftCode || '',
        record.shiftDay ? new Date(record.shiftDay).toISOString().split('T')[0] : '',
        record.shiftStart ? new Date(record.shiftStart).toISOString() : '',
        record.shiftEnd ? new Date(record.shiftEnd).toISOString() : '',
        record.firstIn ? new Date(record.firstIn).toISOString() : '',
        record.lastOut ? new Date(record.lastOut).toISOString() : '',
        record.totalWorkHours || '0:00:00',
        record.status || '',
        record.isWithinWindow ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase(),
        record.isLateEntry ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase(),
        record.isEarlyExit ? CONSTANTS.BOOLEAN_YES.toUpperCase() : CONSTANTS.BOOLEAN_NO.toUpperCase()
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Export Optional Holidays to Excel
   */
  private async exportOptionalHolidays(worksheet: ExcelJS.Worksheet, filters?: any): Promise<void> {
    const headers = [
      'User ID',
      'Holiday Date',
      'Holiday Name',
      'Year',
      'Status',
      'Reason',
      'Remarks',
      'Applied To ID',
      'Applied To Name',
      'Approved By ID',
      'Approved At'
    ];

    worksheet.addRow(headers);
    this.styleHeaderRow(worksheet.getRow(1));

    const query: any = {};
    if (filters?.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters?.status) query.status = filters.status;
    if (filters?.year) query.year = filters.year;

    const requests = await OptionalHolidayRequest.find(query).lean();

    for (const request of requests) {
      const row = [
        request.userId?.toString() || '',
        request.holidayDate ? new Date(request.holidayDate).toISOString().split('T')[0] : '',
        request.holidayName || '',
        request.year || '',
        request.status || 'Pending',
        request.reason || '',
        request.remarks || '',
        request.appliedTo?._id || '',
        request.appliedTo?.name || '',
        request.approvedById?.toString() || '',
        request.approvedAt ? new Date(request.approvedAt).toISOString().split('T')[0] : ''
      ];
      worksheet.addRow(row);
    }

    this.autoFitColumns(worksheet);
  }

  /**
   * Parse Excel file and extract data for selected objects
   */
  async parseExcelFile(fileBuffer: Buffer, objects: ExportableObject[]): Promise<{ [objectType: string]: IImportRow[] }> {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS accepts Buffer, Uint8Array, or ArrayBuffer
    // @ts-ignore - ExcelJS Buffer type compatibility issue
    await workbook.xlsx.load(fileBuffer);

    const result: { [objectType: string]: IImportRow[] } = {};

    for (const objectType of objects) {
      const sheetName = this.getSheetName(objectType);
      const worksheet = workbook.getWorksheet(sheetName);

      if (!worksheet) {
        console.warn(`Sheet "${sheetName}" not found in Excel file`);
        result[objectType] = [];
        continue;
      }

      result[objectType] = await this.parseSheet(worksheet, objectType);
    }

    return result;
  }

  /**
   * Parse a single worksheet
   */
  private async parseSheet(worksheet: ExcelJS.Worksheet, objectType: ExportableObject): Promise<IImportRow[]> {
    const rows: IImportRow[] = [];
    let rowNumber = 2; // Start from row 2 (row 1 is header)

    worksheet.eachRow((row, index) => {
      if (index === 1) return; // Skip header row

      const rowData: IImportRow = { rowNumber };

      switch (objectType) {
        case 'user':
          this.parseUserRow(row, rowData);
          break;
        case 'shift':
          this.parseShiftRow(row, rowData);
          break;
        case 'leave':
          this.parseLeaveRow(row, rowData);
          break;
        case 'salary-assignment':
          this.parseSalaryAssignmentRow(row, rowData);
          break;
        case 'salary-structure':
          this.parseSalaryStructureRow(row, rowData);
          break;
        case 'attendance-record':
          this.parseAttendanceRecordRow(row, rowData);
          break;
        case 'optional-holiday':
          this.parseOptionalHolidayRow(row, rowData);
          break;
      }

      // Only add rows that have at least one non-empty field
      const hasData = Object.keys(rowData).some(key => key !== 'rowNumber' && rowData[key] !== undefined && rowData[key] !== '');
      if (hasData) {
        rows.push(rowData);
      }

      rowNumber++;
    });

    return rows;
  }

  /**
   * Parse User row
   */
  private parseUserRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.name = this.getCellValue(row, 1);
    rowData.email = this.getCellValue(row, 2);
    rowData.role = this.getCellValue(row, 3);
    rowData.specificRole = this.getCellValue(row, 4);
    rowData.departmentId = this.getCellValue(row, 5);
    rowData.managerId = this.getCellValue(row, 6);
    rowData.employeeNo = this.getCellValue(row, 7);
    rowData.checkinId = this.getCellValue(row, 8);
    rowData.biometricId = this.getCellValue(row, 9);
    rowData.active = this.parseBoolean(this.getCellValue(row, 10), true);
    rowData.joiningDate = this.getCellValue(row, 11);
    rowData.confirmationDate = this.getCellValue(row, 12); // Required
    rowData.probationDate = this.getCellValue(row, 13); // Required
    rowData.location = this.getCellValue(row, 14);
    rowData.phone = this.getCellValue(row, 15);
    rowData.emergencyContact = this.getCellValue(row, 16);
    rowData.address = this.getCellValue(row, 17);
    rowData.bloodGroup = this.getCellValue(row, 18);
    rowData.dateOfBirth = this.getCellValue(row, 19);
    rowData.fatherName = this.getCellValue(row, 20);
    rowData.maritalStatus = this.getCellValue(row, 21);
    rowData.spouseName = this.getCellValue(row, 22);
    rowData.separationDate = this.getCellValue(row, 23);
    rowData.noticePeriod = this.getCellValue(row, 24);
    rowData.personalMailId = this.getCellValue(row, 25);
    rowData.country = this.getCellValue(row, 26);
    rowData.currency = this.getCellValue(row, 27) || CONSTANTS.DEFAULT_CURRENCY_INR;
    rowData.licenseType = this.getCellValue(row, 28) || CONSTANTS.DEFAULT_LICENSE_TYPE;
    rowData.portalAccess = this.parseBoolean(this.getCellValue(row, 29), true);
    rowData.visaType = this.getCellValue(row, 30);
    rowData.visaExpiryDate = this.getCellValue(row, 31);
    rowData.visaIsActive = this.parseBoolean(this.getCellValue(row, 32), true);
    rowData.client = this.getCellValue(row, 33);
    rowData.holidayCalendarId = this.getCellValue(row, 34);
    rowData.shiftId = this.getCellValue(row, 35); // For automatic shift assignment creation
    // Note: FCM Token is not imported - it's set automatically when users log into the mobile app
  }

  /**
   * Parse Shift row
   */
  private parseShiftRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.name = this.getCellValue(row, 1);
    rowData.code = this.getCellValue(row, 2);
    rowData.startTime = this.getCellValue(row, 3);
    rowData.endTime = this.getCellValue(row, 4);
    rowData.shiftWindowStart = this.getCellValue(row, 5);
    rowData.shiftWindowEnd = this.getCellValue(row, 6);
    rowData.validFrom = this.getCellValue(row, 7);
    rowData.validTill = this.getCellValue(row, 8);
    rowData.isActive = this.parseBoolean(this.getCellValue(row, 9), false);
    rowData.description = this.getCellValue(row, 10);
    rowData.graceTimeInMinutes = this.getCellValue(row, 11);
    rowData.isOvernightShift = this.parseBoolean(this.getCellValue(row, 12), false);
  }

  /**
   * Parse Leave row
   */
  private parseLeaveRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.userId = this.getCellValue(row, 1);
    rowData.leaveTypeId = this.getCellValue(row, 2);
    rowData.leaveType = this.getCellValue(row, 3);
    rowData.startDate = this.getCellValue(row, 4);
    rowData.endDate = this.getCellValue(row, 5);
    rowData.noOfDays = this.getCellValue(row, 6);
    rowData.status = this.getCellValue(row, 7);
    rowData.remarks = this.getCellValue(row, 8);
    rowData.reason = this.getCellValue(row, 9);
    rowData.appliedToId = this.getCellValue(row, 10);
    rowData.appliedToName = this.getCellValue(row, 11);
    rowData.approvedById = this.getCellValue(row, 12);
    rowData.approvedAt = this.getCellValue(row, 13);
    rowData.leaveDuration = this.getCellValue(row, 14);
    rowData.halfDayType = this.getCellValue(row, 15);
  }

  /**
   * Parse Salary Assignment row
   */
  private parseSalaryAssignmentRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.employeeId = this.getCellValue(row, 1);
    rowData.salaryStructureId = this.getCellValue(row, 2);
    rowData.monthlyGross = this.getCellValue(row, 3);
    rowData.monthlyInsurance = this.getCellValue(row, 4);
    rowData.reimbursement = this.getCellValue(row, 5);
    rowData.travelAllowance = this.getCellValue(row, 6);
    rowData.airTicketAllowance = this.getCellValue(row, 7);
    rowData.medicalAllowance = this.getCellValue(row, 8);
    rowData.isActive = this.parseBoolean(this.getCellValue(row, 9), false);
    rowData.effectiveFrom = this.getCellValue(row, 10);
    rowData.effectiveTo = this.getCellValue(row, 11);
  }

  /**
   * Parse Salary Structure row
   */
  private parseSalaryStructureRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.name = this.getCellValue(row, 1);
    rowData.country = this.getCellValue(row, 2);
    rowData.basicPercentage = this.getCellValue(row, 3);
    rowData.hraPercentage = this.getCellValue(row, 4);
    rowData.daPercentage = this.getCellValue(row, 5);
    rowData.otherAllowancePercentage = this.getCellValue(row, 6);
    rowData.travelAllowancePercentage = this.getCellValue(row, 7);
    rowData.reimbursementPercentage = this.getCellValue(row, 8);
    rowData.epfEmployeeContribution = this.getCellValue(row, 9);
    rowData.epfEmployerContribution = this.getCellValue(row, 10);
    rowData.epfMaxLimit = this.getCellValue(row, 11);
    rowData.esiEmployeeContribution = this.getCellValue(row, 12);
    rowData.esiEmployerContribution = this.getCellValue(row, 13);
    rowData.esiApplicabilityLimit = this.getCellValue(row, 14);
  }

  /**
   * Parse Attendance Record row
   */
  private parseAttendanceRecordRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.userId = this.getCellValue(row, 1);
    rowData.shiftId = this.getCellValue(row, 2);
    rowData.shiftCode = this.getCellValue(row, 3);
    rowData.shiftDay = this.getCellValue(row, 4);
    rowData.shiftStart = this.getCellValue(row, 5);
    rowData.shiftEnd = this.getCellValue(row, 6);
    rowData.firstIn = this.getCellValue(row, 7);
    rowData.lastOut = this.getCellValue(row, 8);
    rowData.totalWorkHours = this.getCellValue(row, 9);
    rowData.status = this.getCellValue(row, 10);
    rowData.isWithinWindow = this.parseBoolean(this.getCellValue(row, 11), false);
    rowData.isLateEntry = this.parseBoolean(this.getCellValue(row, 12), false);
    rowData.isEarlyExit = this.parseBoolean(this.getCellValue(row, 13), false);
  }

  /**
   * Parse Optional Holiday row
   */
  private parseOptionalHolidayRow(row: ExcelJS.Row, rowData: IImportRow): void {
    rowData.userId = this.getCellValue(row, 1);
    rowData.holidayDate = this.getCellValue(row, 2);
    rowData.holidayName = this.getCellValue(row, 3);
    rowData.year = this.getCellValue(row, 4);
    rowData.status = this.getCellValue(row, 5);
    rowData.reason = this.getCellValue(row, 6);
    rowData.remarks = this.getCellValue(row, 7);
    rowData.appliedToId = this.getCellValue(row, 8);
    rowData.appliedToName = this.getCellValue(row, 9);
    rowData.approvedById = this.getCellValue(row, 10);
    rowData.approvedAt = this.getCellValue(row, 11);
  }

  /**
   * Validate imported data
   */
  async validateImportData(
    parsedData: { [objectType: string]: IImportRow[] },
    objects: ExportableObject[]
  ): Promise<{ [objectType: string]: IValidationResult }> {
    const results: { [objectType: string]: IValidationResult } = {};

    console.log('🔍 [Validation Service] Starting validation for objects:', objects);

    for (const objectType of objects) {
      const rows = parsedData[objectType] || [];
      console.log(`🔍 [Validation Service] Validating ${objectType}: ${rows.length} rows`);

      switch (objectType) {
        case 'user':
          results[objectType] = await this.validateUsers(rows);
          break;
        case 'shift':
          results[objectType] = await this.validateShifts(rows);
          break;
        case 'leave':
          results[objectType] = await this.validateLeaves(rows);
          break;
        case 'salary-assignment':
          results[objectType] = await this.validateSalaryAssignments(rows);
          break;
        case 'salary-structure':
          results[objectType] = await this.validateSalaryStructures(rows);
          break;
        case 'attendance-record':
          results[objectType] = await this.validateAttendanceRecords(rows);
          break;
        case 'optional-holiday':
          results[objectType] = await this.validateOptionalHolidays(rows);
          break;
      }

      // Log validation result for this object type
      if (results[objectType]) {
        const result = results[objectType];
        console.log(`✅ [Validation Service] ${objectType} validation complete:`, {
          valid: result.summary.validRows,
          invalid: result.summary.invalidRows,
          errors: result.summary.errors,
          warnings: result.summary.warnings
        });
      }
    }

    console.log('✅ [Validation Service] All validations completed');
    return results;
  }

  /**
   * Validate User rows
   */
  private async validateUsers(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Track duplicates within file
    const emailMap = new Map<string, number[]>();
    const employeeNoMap = new Map<string, number[]>();
    const checkinIdMap = new Map<string, number[]>();
    const biometricIdMap = new Map<string, number[]>();
    const userShiftMap = new Map<string, number[]>(); // Track user+shift combinations

    // First pass: Detect duplicates within file
    for (const row of rows) {
      if (row.email) {
        const email = row.email.toLowerCase().trim();
        if (!emailMap.has(email)) emailMap.set(email, []);
        emailMap.get(email)!.push(row.rowNumber);
      }
      if (row.employeeNo) {
        const empNo = row.employeeNo.trim();
        if (!employeeNoMap.has(empNo)) employeeNoMap.set(empNo, []);
        employeeNoMap.get(empNo)!.push(row.rowNumber);
      }
      if (row.checkinId) {
        const checkin = row.checkinId.trim();
        if (!checkinIdMap.has(checkin)) checkinIdMap.set(checkin, []);
        checkinIdMap.get(checkin)!.push(row.rowNumber);
      }
      if (row.biometricId && row.country?.trim() && row.country.trim() !== 'IN' && row.country.trim() !== 'AE') {
        const bio = row.biometricId.trim();
        if (!biometricIdMap.has(bio)) biometricIdMap.set(bio, []);
        biometricIdMap.get(bio)!.push(row.rowNumber);
      }
      // Track user+shift combinations for duplicate detection
      if (row.email && row.shiftId) {
        const email = row.email.toLowerCase().trim();
        const shiftId = row.shiftId.trim();
        const key = `${email}_${shiftId}`;
        if (!userShiftMap.has(key)) userShiftMap.set(key, []);
        userShiftMap.get(key)!.push(row.rowNumber);
      }
    }

    // Get all unique emails for batch database check (only for provided emails)
    const emails = [...new Set(rows.map(r => r.email?.toLowerCase().trim()).filter(Boolean))];
    const employeeNos = [...new Set(rows.map(r => r.employeeNo?.trim()).filter(Boolean))];
    const checkinIds = [...new Set(rows.map(r => r.checkinId?.trim()).filter(Boolean))];
    const biometricIds = [...new Set(rows.map(r => r.biometricId?.trim()).filter(Boolean))];

    // Batch check database for duplicates
    const existingUsers = await User.find({
      $or: [
        { email: { $in: emails } },
        { employeeCode: { $in: employeeNos } },
        { checkinId: { $in: checkinIds } },
        { biometricId: { $in: biometricIds } }
      ]
    }).select('email employeeCode checkinId biometricId').lean();

    const existingEmails = new Set(existingUsers.map(u => u.email?.toLowerCase()));
    const existingEmployeeNos = new Set(existingUsers.map(u => u.employeeCode).filter(Boolean));
    const existingCheckinIds = new Set(existingUsers.map(u => u.checkinId).filter(Boolean));
    const existingBiometricIds = new Set(existingUsers.map(u => u.biometricId).filter(Boolean));

    // Batch check departments, managers, and holiday calendars
    const departmentIds = [...new Set(rows.map(r => r.departmentId?.trim()).filter(Boolean))];
    const managerIds = [...new Set(rows.map(r => r.managerId?.trim()).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const holidayCalendarIds = [...new Set(rows.map(r => r.holidayCalendarId?.trim()).filter(Boolean).filter(id => this.isValidObjectId(id)))];

    const validDepartmentIds = new Set<string>();
    if (departmentIds.length > 0) {
      const departments = await LOV.find({
        type: 'department',
        'values.value': { $in: departmentIds },
        'values.isActive': true
      }).lean();
      departments.forEach(d => {
        d.values.filter(v => v.isActive).forEach(v => validDepartmentIds.add(v.value));
      });
    }

    const validManagerIds = new Set<string>();
    if (managerIds.length > 0) {
      const managers = await User.find({
        _id: { $in: managerIds.map(id => new Types.ObjectId(id)) }
      }).select('_id').lean();
      managers.forEach(m => validManagerIds.add(m._id.toString()));
    }

    const validHolidayCalendarIds = new Set<string>();
    if (holidayCalendarIds.length > 0) {
      const calendars = await HolidayCalendar.find({
        _id: { $in: holidayCalendarIds.map(id => new Types.ObjectId(id)) }
      }).select('_id').lean();
      calendars.forEach(c => validHolidayCalendarIds.add(c._id.toString()));
    }

    // Batch check shift IDs (if provided for automatic shift assignment)
    const shiftIds = [...new Set(rows.map(r => r.shiftId?.trim()).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const validShiftIds = new Map<string, { id: string; code: string }>();
    if (shiftIds.length > 0) {
      const shifts = await Shift.find({
        _id: { $in: shiftIds.map(id => new Types.ObjectId(id)) }
      }).select('_id code').lean();
      shifts.forEach(s => {
        validShiftIds.set(s._id.toString(), { id: s._id.toString(), code: s.code });
      });
    }

    // Second pass: Validate each row
    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      // Required fields
      if (!row.name?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'name',
          message: 'Name is required',
          severity: 'error'
        });
      }

      // Email validation: Required for active users, optional for inactive users (historical data)
      const isActive = row.active !== undefined ? row.active : true; // Default to true if not specified

      if (!row.email?.trim()) {
        if (isActive) {
          // Email is required for active users
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'email',
            message: 'Email is required for active users (Active=Yes)',
            severity: 'error'
          });
        }
        // If inactive, email is optional - no error (for historical data migration)
      } else {
        // Email format validation - accepts formats like: user@domain.com, user@domain.ae, user@subdomain.domain.com
        // Examples: pravinraja@clouddesk.ae, john@example.com, user.name@company.co.uk
        // Supports: standard emails, .ae domains, subdomains, and multi-part TLDs
        const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const trimmedEmail = row.email.trim();

        // Log for debugging
        console.log(`🔍 [Email Validation] Row ${row.rowNumber}: Validating email: "${trimmedEmail}"`);

        if (!emailRegex.test(trimmedEmail)) {
          console.error(`❌ [Email Validation] Row ${row.rowNumber}: Email failed regex test: "${trimmedEmail}"`);
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'email',
            message: 'Invalid email format. Expected format: user@domain.com or user@domain.ae',
            severity: 'error'
          });
        } else {
          console.log(`✅ [Email Validation] Row ${row.rowNumber}: Email format is valid: "${trimmedEmail}"`);
          // Check duplicate in database
          if (existingEmails.has(row.email.toLowerCase().trim())) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'email',
              message: 'Email already exists in database',
              severity: 'error'
            });
          }

          // Check duplicate within file
          const email = row.email.toLowerCase().trim();
          const duplicateRows = emailMap.get(email);
          if (duplicateRows && duplicateRows.length > 1) {
            const isFirst = duplicateRows[0] === row.rowNumber;
            if (!isFirst) {
              rowErrors.push({
                rowNumber: row.rowNumber,
                field: 'email',
                message: `Duplicate email found in row ${duplicateRows[0]}`,
                severity: 'error'
              });
            }
          }
        }
      }

      if (!row.role?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'role',
          message: 'Role is required',
          severity: 'error'
        });
      } else {
        if (!CONSTANTS.VALID_ROLES.includes(row.role.toLowerCase() as any)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'role',
            message: `Role must be one of: ${CONSTANTS.VALID_ROLES.join(', ')}`,
            severity: 'error'
          });
        }
      }

      if (!row.departmentId?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'departmentId',
          message: 'Department ID is required',
          severity: 'error'
        });
      } else if (!validDepartmentIds.has(row.departmentId.trim())) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'departmentId',
          message: 'Department not found or inactive',
          severity: 'error'
        });
      }

      // Manager validation (required)
      if (!row.managerId?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'managerId',
          message: 'Manager ID is required',
          severity: 'error'
        });
      } else {
        if (!this.isValidObjectId(row.managerId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'managerId',
            message: 'Invalid Manager ID format',
            severity: 'error'
          });
        } else if (!validManagerIds.has(row.managerId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'managerId',
            message: 'Manager not found',
            severity: 'error'
          });
        }
      }

      // Employee Number validation
      if (row.employeeNo?.trim()) {
        if (existingEmployeeNos.has(row.employeeNo.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'employeeNo',
            message: 'Employee number already exists in database',
            severity: 'error'
          });
        }

        const duplicateRows = employeeNoMap.get(row.employeeNo.trim());
        if (duplicateRows && duplicateRows.length > 1) {
          const isFirst = duplicateRows[0] === row.rowNumber;
          if (!isFirst) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'employeeNo',
              message: `Duplicate employee number found in row ${duplicateRows[0]}`,
              severity: 'error'
            });
          }
        }
      }

      // Check-in ID validation
      if (row.checkinId?.trim()) {
        if (existingCheckinIds.has(row.checkinId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'checkinId',
            message: 'Check-in ID already exists in database',
            severity: 'error'
          });
        }

        const duplicateRows = checkinIdMap.get(row.checkinId.trim());
        if (duplicateRows && duplicateRows.length > 1) {
          const isFirst = duplicateRows[0] === row.rowNumber;
          if (!isFirst) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'checkinId',
              message: `Duplicate check-in ID found in row ${duplicateRows[0]}`,
              severity: 'error'
            });
          }
        }
      }

      // Biometric ID validation (only for non-IN/AE countries)
      if (row.biometricId?.trim() && row.country?.trim() && row.country.trim() !== 'IN' && row.country.trim() !== 'AE') {
        if (existingBiometricIds.has(row.biometricId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'biometricId',
            message: 'Biometric ID already exists in database',
            severity: 'error'
          });
        }

        const duplicateRows = biometricIdMap.get(row.biometricId.trim());
        if (duplicateRows && duplicateRows.length > 1) {
          const isFirst = duplicateRows[0] === row.rowNumber;
          if (!isFirst) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'biometricId',
              message: `Duplicate biometric ID found in row ${duplicateRows[0]}`,
              severity: 'error'
            });
          }
        }
      }

      // Confirmation Date validation (optional)
      if (row.confirmationDate) {
        const confirmationDate = this.parseDate(row.confirmationDate);
        if (!confirmationDate) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'confirmationDate',
            message: 'Invalid confirmation date format. Expected: YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        }
      }

      // Probation Date validation (optional)
      if (row.probationDate) {
        const probationDate = this.parseDate(row.probationDate);
        if (!probationDate) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'probationDate',
            message: 'Invalid probation date format. Expected: YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        }
      }

      // Date of Birth validation (required)
      if (!row.dateOfBirth) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'dateOfBirth',
          message: 'Date of birth is required',
          severity: 'error'
        });
      } else {
        const dob = this.parseDate(row.dateOfBirth);
        if (!dob) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'dateOfBirth',
            message: 'Invalid date of birth format. Expected: YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        }
      }

      // Joining Date validation (required)
      if (!row.joiningDate) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'joiningDate',
          message: 'Joining date is required',
          severity: 'error'
        });
      } else {
        const date = this.parseDate(row.joiningDate);
        if (!date) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'joiningDate',
            message: 'Invalid joining date format. Expected: YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        }
      }

      // Country validation (required field)
      if (!row.country || !row.country.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'country',
          message: 'Country is required',
          severity: 'error'
        });
      } else if (!CONSTANTS.VALID_COUNTRIES.includes(row.country.trim())) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'country',
          message: `Country must be one of: ${CONSTANTS.VALID_COUNTRIES.join(', ')}`,
          severity: 'error'
        });
      }

      // Currency-country validation (country is required, so this will always run if currency is provided)
      if (row.country?.trim() && row.currency) {
        const expectedCurrency = row.country.trim() === 'AE' ? CONSTANTS.DEFAULT_CURRENCY_AED : CONSTANTS.DEFAULT_CURRENCY_INR;
        if (row.currency !== expectedCurrency) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'currency',
            message: `Currency ${row.currency} does not match country ${row.country.trim()}. Expected ${expectedCurrency}`,
            severity: 'warning'
          });
        }
      }

      // Holiday Calendar validation
      if (row.holidayCalendarId) {
        if (!this.isValidObjectId(row.holidayCalendarId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'holidayCalendarId',
            message: 'Invalid Holiday Calendar ID format',
            severity: 'error'
          });
        } else if (!validHolidayCalendarIds.has(row.holidayCalendarId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'holidayCalendarId',
            message: 'Holiday Calendar not found',
            severity: 'error'
          });
        }
      }

      // Shift ID validation (if provided - for automatic shift assignment)
      if (row.shiftId?.trim()) {
        if (!this.isValidObjectId(row.shiftId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftId',
            message: 'Invalid Shift ID format',
            severity: 'error'
          });
        } else if (!validShiftIds.has(row.shiftId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftId',
            message: 'Shift not found',
            severity: 'error'
          });
        } else {
          // Check for duplicate user+shift combination within file
          if (row.email) {
            const email = row.email.toLowerCase().trim();
            const shiftId = row.shiftId.trim();
            const key = `${email}_${shiftId}`;
            const duplicateRows = userShiftMap.get(key);
            if (duplicateRows && duplicateRows.length > 1) {
              const isFirst = duplicateRows[0] === row.rowNumber;
              if (!isFirst) {
                rowErrors.push({
                  rowNumber: row.rowNumber,
                  field: 'shiftId',
                  message: `Duplicate user+shift combination found in row ${duplicateRows[0]}. Same user cannot be assigned the same shift multiple times.`,
                  severity: 'error'
                });
              }
            }
          }

          // Store shift code for later use in shift assignment creation
          const shiftInfo = validShiftIds.get(row.shiftId.trim());
          if (shiftInfo) {
            (row as any).shiftCode = shiftInfo.code;
          }
        }
      }

      // Visa details validation (for AE users)
      const country = row.country?.trim() || '';
      const hasVisaType = row.visaType?.trim();
      const hasVisaExpiryDate = row.visaExpiryDate?.trim();

      if (country === 'AE') {
        // If any visa field is provided, all required fields must be present
        if (hasVisaType || hasVisaExpiryDate) {
          // If visa details are provided, both visaType and visaExpiryDate are required
          if (!hasVisaType) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'visaType',
              message: 'Visa type is required when visa details are provided for AE users',
              severity: 'error'
            });
          } else if (!CONSTANTS.VALID_VISA_TYPES.includes(hasVisaType)) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'visaType',
              message: `Visa type must be one of: ${CONSTANTS.VALID_VISA_TYPES.join(', ')}`,
              severity: 'error'
            });
          }

          if (!hasVisaExpiryDate) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'visaExpiryDate',
              message: 'Visa expiry date is required when visa details are provided for AE users',
              severity: 'error'
            });
          } else {
            const visaExpiryDate = this.parseDate(hasVisaExpiryDate);
            if (!visaExpiryDate) {
              rowErrors.push({
                rowNumber: row.rowNumber,
                field: 'visaExpiryDate',
                message: 'Invalid visa expiry date format (expected YYYY-MM-DD)',
                severity: 'error'
              });
            } else if (visaExpiryDate <= new Date()) {
              rowErrors.push({
                rowNumber: row.rowNumber,
                field: 'visaExpiryDate',
                message: 'Visa expiry date must be in the future',
                severity: 'error'
              });
            }
          }
        }
      } else {
        // For non-AE users, visa details should not be provided
        if (hasVisaType || hasVisaExpiryDate) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'visaDetails',
            message: 'Visa details are only applicable for AE (UAE) users',
            severity: 'warning'
          });
        }
      }

      // Optional date field validation
      if (row.dateOfBirth) {
        const date = this.parseDate(row.dateOfBirth);
        if (!date) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'dateOfBirth',
            message: 'Invalid date of birth format (expected YYYY-MM-DD or DD/MM/YYYY)',
            severity: 'error'
          });
        }
      }

      if (row.separationDate) {
        const date = this.parseDate(row.separationDate);
        if (!date) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'separationDate',
            message: 'Invalid separation date format (expected YYYY-MM-DD or DD/MM/YYYY)',
            severity: 'error'
          });
        }
      }

      // Marital Status validation
      if (row.maritalStatus?.trim()) {
        const validStatuses = ['Single', 'Married', 'Divorced', 'Widowed'];
        if (!validStatuses.includes(row.maritalStatus.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'maritalStatus',
            message: `Marital status must be one of: ${validStatuses.join(', ')}`,
            severity: 'error'
          });
        }
      }

      // Notice Period validation
      if (row.noticePeriod) {
        const noticePeriod = Number(row.noticePeriod);
        if (isNaN(noticePeriod) || noticePeriod < 0) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'noticePeriod',
            message: 'Notice period must be a non-negative number',
            severity: 'error'
          });
        }
      }

      // Personal Mail ID validation
      if (row.personalMailId?.trim()) {
        const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(row.personalMailId.trim())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'personalMailId',
            message: 'Invalid personal email format. Expected format: user@domain.com',
            severity: 'error'
          });
        }
      }

      // Categorize row
      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Shift rows
   */
  private async validateShifts(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Track duplicates within file
    const codeMap = new Map<string, number[]>();

    for (const row of rows) {
      if (row.code) {
        const code = row.code.toUpperCase().trim();
        if (!codeMap.has(code)) codeMap.set(code, []);
        codeMap.get(code)!.push(row.rowNumber);
      }
    }

    // Batch check database
    const codes = [...new Set(rows.map(r => r.code?.toUpperCase().trim()).filter(Boolean))];
    const existingShifts = await Shift.find({ code: { $in: codes } }).select('code').lean();
    const existingCodes = new Set(existingShifts.map(s => s.code?.toUpperCase()));

    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      // Required fields
      if (!row.name?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'name',
          message: 'Name is required',
          severity: 'error'
        });
      }

      if (!row.code?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'code',
          message: 'Code is required',
          severity: 'error'
        });
      } else {
        const code = row.code.toUpperCase().trim();
        if (existingCodes.has(code)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'code',
            message: 'Shift code already exists in database',
            severity: 'error'
          });
        }

        const duplicateRows = codeMap.get(code);
        if (duplicateRows && duplicateRows.length > 1) {
          const isFirst = duplicateRows[0] === row.rowNumber;
          if (!isFirst) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'code',
              message: `Duplicate shift code found in row ${duplicateRows[0]}`,
              severity: 'error'
            });
          }
        }
      }

      // Time format validation
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!row.startTime || !timeRegex.test(row.startTime)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'startTime',
          message: 'Start time must be in HH:mm format',
          severity: 'error'
        });
      }

      if (!row.endTime || !timeRegex.test(row.endTime)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'endTime',
          message: 'End time must be in HH:mm format',
          severity: 'error'
        });
      }

      // Validate shift window times (required fields)
      if (!row.shiftWindowStart?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftWindowStart',
          message: 'Shift window start time is required',
          severity: 'error'
        });
      } else if (!timeRegex.test(row.shiftWindowStart)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftWindowStart',
          message: 'Shift window start time must be in HH:mm format',
          severity: 'error'
        });
      }

      if (!row.shiftWindowEnd?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftWindowEnd',
          message: 'Shift window end time is required',
          severity: 'error'
        });
      } else if (!timeRegex.test(row.shiftWindowEnd)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftWindowEnd',
          message: 'Shift window end time must be in HH:mm format',
          severity: 'error'
        });
      }

      // Validate shift time logic (if all times are provided)
      if (row.startTime && row.endTime && row.shiftWindowStart && row.shiftWindowEnd &&
        timeRegex.test(row.startTime) && timeRegex.test(row.endTime) &&
        timeRegex.test(row.shiftWindowStart) && timeRegex.test(row.shiftWindowEnd)) {
        const startParts = row.startTime.split(':').map(Number);
        const endParts = row.endTime.split(':').map(Number);
        const windowStartParts = row.shiftWindowStart.split(':').map(Number);
        const windowEndParts = row.shiftWindowEnd.split(':').map(Number);

        const startMinutes = startParts[0] * 60 + startParts[1];
        const endMinutes = endParts[0] * 60 + endParts[1];
        const windowStartMinutes = windowStartParts[0] * 60 + windowStartParts[1];
        const windowEndMinutes = windowEndParts[0] * 60 + windowEndParts[1];

        const isOvernight = row.isOvernightShift !== undefined ? row.isOvernightShift : false;

        // Validate shift window start is before or equal to shift start
        if (windowStartMinutes > startMinutes) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftWindowStart',
            message: 'Shift window start time must be before or equal to shift start time',
            severity: 'error'
          });
        }

        // Validate shift window end is after shift start
        if (windowEndMinutes < startMinutes) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftWindowEnd',
            message: 'Shift window end time must be after shift start time',
            severity: 'error'
          });
        }

        // Validate shift end is after shift start for regular shifts
        if (!isOvernight && endMinutes <= startMinutes) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'endTime',
            message: 'Shift end time must be after shift start time for regular shifts',
            severity: 'error'
          });
        }

        // For overnight shifts, ensure end time is less than start time
        if (isOvernight && endMinutes > startMinutes) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'endTime',
            message: 'For overnight shifts, end time must be on the next day (less than start time)',
            severity: 'error'
          });
        }
      }

      // Date validation
      if (row.validFrom) {
        const date = this.parseDate(row.validFrom);
        if (!date) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'validFrom',
            message: 'Invalid valid from date format (expected YYYY-MM-DD)',
            severity: 'error'
          });
        }
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Leave rows
   */
  private async validateLeaves(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Batch validate user IDs and leave type IDs
    const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const leaveTypeIds = [...new Set(rows.map(r => r.leaveTypeId).filter(Boolean).filter(id => this.isValidObjectId(id)))];

    const [existingUsers, existingLeaveTypes] = await Promise.all([
      userIds.length > 0
        ? User.find({ _id: { $in: userIds.map(id => new Types.ObjectId(id)) } })
          .select('_id')
          .lean()
        : Promise.resolve([]),
      leaveTypeIds.length > 0
        ? LOV.find({ _id: { $in: leaveTypeIds.map(id => new Types.ObjectId(id)) } })
          .select('_id')
          .lean()
        : Promise.resolve([])
    ]);

    const validUserIds = new Set(existingUsers.map(u => u._id.toString()));
    const validLeaveTypeIds = new Set(existingLeaveTypes.map(lt => lt._id.toString()));

    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      // Required fields
      if (!row.userId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'User ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.userId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'Invalid User ID format',
          severity: 'error'
        });
      } else {
        // Check if user exists (using batch result)
        if (!validUserIds.has(row.userId)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'userId',
            message: 'User not found',
            severity: 'error'
          });
        }
      }

      if (!row.leaveTypeId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'leaveTypeId',
          message: 'Leave Type ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.leaveTypeId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'leaveTypeId',
          message: 'Invalid Leave Type ID format',
          severity: 'error'
        });
      } else {
        // Validate leave type exists in LOV (using batch result)
        if (!validLeaveTypeIds.has(row.leaveTypeId)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'leaveTypeId',
            message: 'Leave Type not found',
            severity: 'error'
          });
        }
      }

      // Date validation
      const startDate = row.startDate ? this.parseDate(row.startDate) : null;
      const endDate = row.endDate ? this.parseDate(row.endDate) : null;

      if (!startDate) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'startDate',
          message: 'Invalid start date format (expected YYYY-MM-DD)',
          severity: 'error'
        });
      }

      if (!endDate) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'endDate',
          message: 'Invalid end date format (expected YYYY-MM-DD)',
          severity: 'error'
        });
      }

      if (startDate && endDate && endDate < startDate) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'endDate',
          message: 'End date must be after start date',
          severity: 'error'
        });
      }

      // Half-day validation
      if (row.leaveDuration === 'half-day') {
        if (startDate && endDate && startDate.toDateString() !== endDate.toDateString()) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'endDate',
            message: 'Half-day leaves must have same start and end date',
            severity: 'error'
          });
        }

        if (!row.halfDayType) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'halfDayType',
            message: 'Half day type is required for half-day leaves',
            severity: 'error'
          });
        }

        // Validate noOfDays must be 0.5 for half-day leaves
        const noOfDays = row.noOfDays ? this.parseNumeric(row.noOfDays) : undefined;
        if (noOfDays === undefined || noOfDays !== 0.5) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'noOfDays',
            message: 'Half-day leaves must have noOfDays = 0.5',
            severity: 'error'
          });
        }
      }

      // For full-day leaves, halfDayType should not be set
      if (row.leaveDuration === 'full-day' && row.halfDayType) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'halfDayType',
          message: 'halfDayType should not be set for full-day leaves',
          severity: 'error'
        });
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Salary Assignment rows
   */
  private async validateSalaryAssignments(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Batch validate employee IDs and salary structure IDs
    const employeeIds = [...new Set(rows.map(r => r.employeeId).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const salaryStructureIds = [...new Set(rows.map(r => r.salaryStructureId).filter(Boolean).filter(id => this.isValidObjectId(id)))];

    const [existingEmployees, existingStructures] = await Promise.all([
      employeeIds.length > 0
        ? User.find({ _id: { $in: employeeIds.map(id => new Types.ObjectId(id)) } })
          .select('_id')
          .lean()
        : Promise.resolve([]),
      salaryStructureIds.length > 0
        ? SalaryStructure.find({ _id: { $in: salaryStructureIds.map(id => new Types.ObjectId(id)) } })
          .select('_id')
          .lean()
        : Promise.resolve([])
    ]);

    const validEmployeeIds = new Set(existingEmployees.map(e => e._id.toString()));
    const validSalaryStructureIds = new Set(existingStructures.map(s => s._id.toString()));

    // Validate each row
    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      if (!row.employeeId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'employeeId',
          message: 'Employee ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.employeeId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'employeeId',
          message: 'Invalid Employee ID format',
          severity: 'error'
        });
      } else if (!validEmployeeIds.has(row.employeeId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'employeeId',
          message: 'Employee not found',
          severity: 'error'
        });
      }

      if (!row.salaryStructureId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'salaryStructureId',
          message: 'Salary Structure ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.salaryStructureId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'salaryStructureId',
          message: 'Invalid Salary Structure ID format',
          severity: 'error'
        });
      } else if (!validSalaryStructureIds.has(row.salaryStructureId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'salaryStructureId',
          message: 'Salary Structure not found',
          severity: 'error'
        });
      }

      // Date validation
      const effectiveFrom = row.effectiveFrom ? this.parseDate(row.effectiveFrom) : null;
      const effectiveTo = row.effectiveTo ? this.parseDate(row.effectiveTo) : null;

      if (!effectiveFrom) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'effectiveFrom',
          message: 'Invalid effective from date format (expected YYYY-MM-DD)',
          severity: 'error'
        });
      }

      if (!effectiveTo) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'effectiveTo',
          message: 'Invalid effective to date format (expected YYYY-MM-DD)',
          severity: 'error'
        });
      }

      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'effectiveTo',
          message: 'Effective to date must be after effective from date',
          severity: 'error'
        });
      }

      // Validate all numeric fields are non-negative
      const numericFields = [
        { field: 'monthlyGross', name: 'Monthly Gross' },
        { field: 'monthlyInsurance', name: 'Monthly Insurance' },
        { field: 'reimbursement', name: 'Reimbursement' },
        { field: 'travelAllowance', name: 'Travel Allowance' },
        { field: 'airTicketAllowance', name: 'Air Ticket Allowance' },
        { field: 'medicalAllowance', name: 'Medical Allowance' }
      ];

      for (const { field, name } of numericFields) {
        if (row[field] !== undefined && row[field] !== '') {
          const value = this.parseNumeric(row[field]);
          if (value < 0) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field,
              message: `${name} cannot be negative`,
              severity: 'error'
            });
          }
        }
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Salary Structure rows
   */
  private async validateSalaryStructures(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      if (!row.name?.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'name',
          message: 'Name is required',
          severity: 'error'
        });
      }

      // Country is already validated in validateUsers, but double-check here for safety
      if (!row.country || !CONSTANTS.VALID_COUNTRIES.includes(row.country.trim())) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'country',
          message: `Country is required and must be one of: ${CONSTANTS.VALID_COUNTRIES.join(', ')}`,
          severity: 'error'
        });
      }

      // Percentage validation
      const percentageFields = ['basicPercentage', 'hraPercentage', 'daPercentage', 'otherAllowancePercentage'];
      for (const field of percentageFields) {
        const value = parseFloat(row[field]);
        if (isNaN(value) || value < 0 || value > 100) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field,
            message: `${field} must be a number between 0 and 100`,
            severity: 'error'
          });
        }
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Attendance Record rows
   */
  private async validateAttendanceRecords(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Batch validate user IDs and shift IDs
    const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const shiftIds = [...new Set(rows.map(r => r.shiftId).filter(Boolean).filter(id => this.isValidObjectId(id)))];

    const [existingUsers, existingShifts] = await Promise.all([
      userIds.length > 0
        ? User.find({ _id: { $in: userIds.map(id => new Types.ObjectId(id)) } })
          .select('_id')
          .lean()
        : Promise.resolve([]),
      shiftIds.length > 0
        ? Shift.find({ _id: { $in: shiftIds.map(id => new Types.ObjectId(id)) } })
          .select('_id code')
          .lean()
        : Promise.resolve([])
    ]);

    const validUserIds = new Set(existingUsers.map(u => u._id.toString()));
    const validShiftIds = new Set(existingShifts.map(s => s._id.toString()));
    const shiftCodes = new Set(existingShifts.map(s => s.code?.toUpperCase()).filter(Boolean));

    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      if (!row.userId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'User ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.userId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'Invalid User ID format',
          severity: 'error'
        });
      } else if (!validUserIds.has(row.userId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'User not found',
          severity: 'error'
        });
      }

      if (row.shiftId && !this.isValidObjectId(row.shiftId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftId',
          message: 'Invalid Shift ID format',
          severity: 'error'
        });
      } else if (row.shiftId && !validShiftIds.has(row.shiftId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftId',
          message: 'Shift not found',
          severity: 'error'
        });
      }

      if (!row.shiftCode) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftCode',
          message: 'Shift Code is required',
          severity: 'error'
        });
      } else if (row.shiftId && shiftCodes.size > 0 && !shiftCodes.has(row.shiftCode.toUpperCase())) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftCode',
          message: 'Shift Code does not match Shift ID',
          severity: 'warning'
        });
      }

      // Date validation
      const shiftDay = row.shiftDay ? this.parseDate(row.shiftDay) : null;
      if (!shiftDay) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftDay',
          message: 'Invalid shift day format (expected YYYY-MM-DD)',
          severity: 'error'
        });
      }

      // Validate shiftStart and shiftEnd (required DateTime fields)
      if (!row.shiftStart) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftStart',
          message: 'Shift start time is required',
          severity: 'error'
        });
      } else {
        const shiftStart = new Date(row.shiftStart);
        if (isNaN(shiftStart.getTime())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftStart',
            message: 'Invalid shift start time format',
            severity: 'error'
          });
        }
      }

      if (!row.shiftEnd) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'shiftEnd',
          message: 'Shift end time is required',
          severity: 'error'
        });
      } else {
        const shiftEnd = new Date(row.shiftEnd);
        if (isNaN(shiftEnd.getTime())) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'shiftEnd',
            message: 'Invalid shift end time format',
            severity: 'error'
          });
        } else if (row.shiftStart) {
          const shiftStart = new Date(row.shiftStart);
          if (!isNaN(shiftStart.getTime()) && shiftEnd <= shiftStart) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'shiftEnd',
              message: 'Shift end time must be after shift start time',
              severity: 'error'
            });
          }
        }
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Validate Optional Holidays
   */
  private async validateOptionalHolidays(rows: IImportRow[]): Promise<IValidationResult> {
    const validRows: IImportRow[] = [];
    const invalidRows: IImportRow[] = [];
    const errors: IValidationError[] = [];

    // Batch validate user IDs
    const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean).filter(id => this.isValidObjectId(id)))];
    const existingUsers = userIds.length > 0
      ? await User.find({ _id: { $in: userIds.map(id => new Types.ObjectId(id)) } })
        .select('_id holidayCalendarId')
        .lean()
      : [];

    const validUserIds = new Set(existingUsers.map(u => u._id.toString()));
    const userCalendarMap = new Map(existingUsers.map(u => [u._id.toString(), u.holidayCalendarId?.toString()]));

    // Batch fetch holiday calendars
    const calendarIds = [...new Set(Array.from(userCalendarMap.values()).filter(Boolean))];
    const calendars = calendarIds.length > 0
      ? await HolidayCalendar.find({ _id: { $in: calendarIds.map(id => new Types.ObjectId(id!)) } })
        .select('holidays')
        .lean()
      : [];

    const calendarHolidaysMap = new Map(
      calendars.map(cal => [
        cal._id.toString(),
        cal.holidays.filter((h: any) => h.type === 'optional')
      ])
    );

    for (const row of rows) {
      const rowErrors: IValidationError[] = [];

      // Validate userId
      if (!row.userId) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'User ID is required',
          severity: 'error'
        });
      } else if (!this.isValidObjectId(row.userId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'Invalid User ID format',
          severity: 'error'
        });
      } else if (!validUserIds.has(row.userId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'userId',
          message: 'User not found',
          severity: 'error'
        });
      }

      // Validate holidayDate
      if (!row.holidayDate) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'holidayDate',
          message: 'Holiday Date is required',
          severity: 'error'
        });
      } else {
        const holidayDate = this.parseDate(row.holidayDate);
        if (!holidayDate) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'holidayDate',
            message: 'Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        } else {
          // Validate date is in the past (for migration)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (holidayDate >= today) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'holidayDate',
              message: 'Holiday date must be in the past for migration',
              severity: 'error'
            });
          }

          // Validate it's an optional holiday in user's calendar
          if (row.userId && validUserIds.has(row.userId)) {
            const calendarId = userCalendarMap.get(row.userId);
            if (calendarId) {
              const optionalHolidays = calendarHolidaysMap.get(calendarId) || [];
              const holidayDateStr = holidayDate.toISOString().split('T')[0];
              const matchingHoliday = optionalHolidays.find((h: any) => {
                const hDateStr = new Date(h.date).toISOString().split('T')[0];
                return hDateStr === holidayDateStr;
              });

              if (!matchingHoliday) {
                rowErrors.push({
                  rowNumber: row.rowNumber,
                  field: 'holidayDate',
                  message: 'Date is not an optional holiday in user\'s calendar',
                  severity: 'error'
                });
              } else if (row.holidayName && row.holidayName.trim() !== matchingHoliday.name) {
                rowErrors.push({
                  rowNumber: row.rowNumber,
                  field: 'holidayName',
                  message: `Holiday name should be "${matchingHoliday.name}"`,
                  severity: 'warning'
                });
              }
            } else {
              rowErrors.push({
                rowNumber: row.rowNumber,
                field: 'userId',
                message: 'User does not have a holiday calendar assigned',
                severity: 'error'
              });
            }
          }
        }
      }

      // Validate holidayName
      if (!row.holidayName || !row.holidayName.trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'holidayName',
          message: 'Holiday Name is required',
          severity: 'error'
        });
      }

      // Validate year
      if (!row.year) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'year',
          message: 'Year is required',
          severity: 'error'
        });
      } else {
        const year = parseInt(row.year.toString());
        if (isNaN(year) || year < 2000 || year > 2100) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'year',
            message: 'Year must be a valid number between 2000 and 2100',
            severity: 'error'
          });
        } else if (row.holidayDate) {
          const holidayDate = this.parseDate(row.holidayDate);
          if (holidayDate && holidayDate.getFullYear() !== year) {
            rowErrors.push({
              rowNumber: row.rowNumber,
              field: 'year',
              message: `Year must match holiday date year (${holidayDate.getFullYear()})`,
              severity: 'error'
            });
          }
        }
      }

      // Validate status
      if (row.status) {
        const validStatuses = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
        if (!validStatuses.includes(row.status)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'status',
            message: `Status must be one of: ${validStatuses.join(', ')}`,
            severity: 'error'
          });
        }
      }

      // Validate appliedToId if provided
      if (row.appliedToId && !this.isValidObjectId(row.appliedToId)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'appliedToId',
          message: 'Invalid Applied To ID format',
          severity: 'error'
        });
      }

      // Validate approvedById if provided
      if (row.approvedById && !this.isValidObjectId(row.approvedById)) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'approvedById',
          message: 'Invalid Approved By ID format',
          severity: 'error'
        });
      }

      // Validate approvedAt if provided
      if (row.approvedAt) {
        const approvedAt = this.parseDate(row.approvedAt);
        if (!approvedAt) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'approvedAt',
            message: 'Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY',
            severity: 'error'
          });
        }
      }

      const hasErrors = rowErrors.some(e => e.severity === 'error');
      if (hasErrors) {
        invalidRows.push(row);
      } else {
        validRows.push(row);
      }

      errors.push(...rowErrors);
    }

    return {
      validRows,
      invalidRows,
      errors,
      summary: {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: invalidRows.length,
        errors: errors.filter(e => e.severity === 'error').length,
        warnings: errors.filter(e => e.severity === 'warning').length
      }
    };
  }

  /**
   * Confirm and insert valid data
   */
  async confirmAndInsert(
    request: IImportRequest
  ): Promise<{ [objectType: string]: { created: number; errors: string[] } }> {
    const results: { [objectType: string]: { created: number; errors: string[] } } = {};

    console.log('🔄 [Data Migration Insert] Starting insert for objects:', request.objects);
    console.log('📋 [Data Migration Insert] Valid rows per object:',
      Object.keys(request.validRows).map(key => ({ [key]: request.validRows[key]?.length || 0 }))
    );

    for (const objectType of request.objects) {
      const rows = request.validRows[objectType] || [];
      console.log(`🔄 [Data Migration Insert] Processing ${objectType}: ${rows.length} rows`);

      try {
        switch (objectType) {
          case 'user':
            results[objectType] = await this.insertUsers(rows);
            break;
          case 'shift':
            results[objectType] = await this.insertShifts(rows);
            break;
          case 'leave':
            results[objectType] = await this.insertLeaves(rows);
            break;
          case 'salary-assignment':
            results[objectType] = await this.insertSalaryAssignments(rows);
            break;
          case 'salary-structure':
            results[objectType] = await this.insertSalaryStructures(rows);
            break;
          case 'attendance-record':
            results[objectType] = await this.insertAttendanceRecords(rows);
            break;
          case 'optional-holiday':
            results[objectType] = await this.insertOptionalHolidays(rows);
            break;
        }
        console.log(`✅ [Data Migration Insert] ${objectType} completed:`, results[objectType]);
      } catch (error: any) {
        console.error(`❌ [Data Migration Insert] Error processing ${objectType}:`, error);
        results[objectType] = {
          created: 0,
          errors: [`Failed to process ${objectType}: ${error.message}`]
        };
      }
    }

    console.log('✅ [Data Migration Insert] All inserts completed. Results:', results);
    return results;
  }

  /**
   * Insert User records
   */
  private async insertUsers(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    // Import UserService to use its create method
    const { UserService } = await import('./user.service');
    const userService = new UserService(this.context);

    for (const row of rows) {
      try {
        // Use default password for imported users (users should change it after first login)
        const defaultPassword = '123456';

        // During data migration, active can be set to false for historical data
        // This is different from manual API creation where active is always true
        const isActive = row.active !== undefined ? row.active : true; // Default to true if not specified

        // Handle email: required for active users, optional for inactive users (historical data)
        let userEmail = row.email?.toLowerCase().trim();
        if (!userEmail) {
          if (isActive) {
            // Email is required for active users
            throw new Error('Email is required for active users (Active=Yes)');
          } else {
            // For inactive users (historical data), generate placeholder email
            const timestamp = Date.now();
            const employeeCode = row.employeeNo?.trim() || 'user';
            userEmail = `inactive-${employeeCode}-${timestamp}@placeholder.local`;
          }
        }

        // Prepare user data
        const userData: any = {
          name: row.name?.trim(),
          email: userEmail,
          password: defaultPassword,
          role: row.role?.toLowerCase().trim(),
          specificRole: row.specificRole?.trim() || undefined,
          departmentId: row.departmentId?.trim(),
          employeeCode: row.employeeNo?.trim() || undefined,
          checkinId: row.checkinId?.trim() || undefined,
          active: isActive, // Can be false for historical data migration
          joiningDate: row.joiningDate ? this.parseDate(row.joiningDate)! : new Date(),
          confirmationDate: row.confirmationDate ? this.parseDate(row.confirmationDate) : undefined, // Optional
          probationDate: row.probationDate ? this.parseDate(row.probationDate) : undefined, // Optional
          location: row.location?.trim() || undefined,
          phone: row.phone?.trim() || undefined,
          emergencyContact: row.emergencyContact?.trim() || undefined,
          address: row.address?.trim() || undefined,
          bloodGroup: row.bloodGroup?.trim() || undefined,
          dateOfBirth: row.dateOfBirth ? this.parseDate(row.dateOfBirth)! : undefined, // Required - validated earlier
          fatherName: row.fatherName?.trim() || undefined,
          maritalStatus: row.maritalStatus?.trim() || undefined,
          spouseName: row.spouseName?.trim() || undefined,
          separationDate: row.separationDate ? this.parseDate(row.separationDate) : undefined,
          noticePeriod: row.noticePeriod ? Number(row.noticePeriod) : undefined,
          personalMailId: row.personalMailId?.toLowerCase().trim() || undefined,
          country: row.country?.trim(),
          currency: row.currency || (row.country?.trim() === 'AE' ? CONSTANTS.DEFAULT_CURRENCY_AED : CONSTANTS.DEFAULT_CURRENCY_INR),
          licenseType: row.licenseType || CONSTANTS.DEFAULT_LICENSE_TYPE,
          portalAccess: row.portalAccess !== undefined ? row.portalAccess : true,
          client: row.client?.trim() || undefined,
          // Required fields for user creation - use empty strings as per UserService interface
          upcomingShiftAssignment: '',
          currentShiftAssignment: '',
          upcomingShiftAssignmentData: {},
          currentShiftAssignmentData: {}
        };

        // Get country once for use in multiple validations
        const country = row.country?.trim() || '';

        // Handle manager (required - validated earlier)
        if (!row.managerId || !this.isValidObjectId(row.managerId)) {
          throw new Error('Manager ID is required and must be valid');
        }
        const manager = await User.findById(row.managerId);
        if (!manager) {
          throw new Error('Manager not found');
        }
        userData.managerId = row.managerId;

        // Handle biometricId - UserService.create will handle IN/AE countries
        // Only set biometricId for non-IN/AE countries, UserService will remove it for IN/AE
        if (row.biometricId?.trim()) {
          if (country && country !== 'IN' && country !== 'AE') {
            userData.biometricId = row.biometricId.trim();
          }
          // For IN/AE, don't set biometricId at all - UserService will handle it
        }

        // Handle visa details (only for AE users, validated earlier)
        if (country === 'AE' && row.visaType && row.visaExpiryDate) {
          const visaExpiryDate = this.parseDate(row.visaExpiryDate);
          if (!visaExpiryDate) {
            throw new Error('Invalid visa expiry date format');
          }
          if (visaExpiryDate <= new Date()) {
            throw new Error('Visa expiry date must be in the future');
          }
          if (!CONSTANTS.VALID_VISA_TYPES.includes(row.visaType.trim())) {
            throw new Error(`Invalid visa type. Must be one of: ${CONSTANTS.VALID_VISA_TYPES.join(', ')}`);
          }

          userData.visaDetails = {
            visaType: row.visaType.trim(),
            visaExpiryDate: visaExpiryDate,
            isActive: row.visaIsActive !== undefined ? row.visaIsActive : true
          };
        }

        // Handle holiday calendar
        if (row.holidayCalendarId) {
          userData.holidayCalendarId = row.holidayCalendarId;
        }

        // Use UserService.create to ensure proper handling (biometricId, welcome email, etc.)
        const savedUser = await userService.create(userData);
        created++;

        // If shiftId is provided, create shift assignment automatically
        if (row.shiftId?.trim()) {
          try {
            const shiftId = row.shiftId.trim();
            const shift = await Shift.findById(shiftId).lean();

            if (!shift) {
              throw new Error(`Shift with ID ${shiftId} not found`);
            }

            const joiningDate = row.joiningDate ? this.parseDate(row.joiningDate) : new Date();
            if (!joiningDate) {
              throw new Error('Invalid joining date for shift assignment');
            }

            // Normalize joining date to start of day for comparison
            const normalizedJoiningDate = new Date(joiningDate);
            normalizedJoiningDate.setUTCHours(0, 0, 0, 0);
            const nextDay = new Date(normalizedJoiningDate);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);

            // Check if shift assignment already exists for this user, shift, and start date
            // Check for exact match on userId, shiftId, and startDate (within same day)
            const existingAssignment = await ShiftAssignment.findOne({
              userId: savedUser._id,
              shiftId: new Types.ObjectId(shiftId),
              startDate: {
                $gte: normalizedJoiningDate,
                $lt: nextDay
              }
            });

            if (existingAssignment) {
              console.log(`Shift assignment already exists for user ${savedUser._id.toString()} with shift ${shiftId} starting ${normalizedJoiningDate.toISOString()}, skipping creation`);
              // Skip creation but don't treat as error - assignment already exists
              // Continue to next iteration of the loop
            } else {

              // Calculate status based on start date
              const currentDate = new Date();
              const startDateTime = new Date(joiningDate);
              startDateTime.setHours(0, 0, 0, 0);

              let status: 'current' | 'upcoming' | 'past' = 'upcoming';
              if (startDateTime <= currentDate) {
                status = 'current';
              }

              // Create shift assignment with standard weekend [0, 6] (Sunday and Saturday)
              const shiftAssignment = new ShiftAssignment({
                userId: savedUser._id,
                shiftId: new Types.ObjectId(shiftId),
                shiftCode: shift.code,
                startDate: joiningDate,
                endDate: undefined, // No end date
                isActive: true,
                status: status,
                weekendDays: [0, 6], // Standard weekend: Sunday (0) and Saturday (6)
                assignedBy: this.context.user?._id || savedUser._id, // Use current admin user or the created user
                assignedAt: new Date()
              });

              await shiftAssignment.save();
            }
          } catch (shiftAssignmentError: any) {
            // Log error but don't fail user creation
            console.error(`Error creating shift assignment for user at row ${row.rowNumber}:`, shiftAssignmentError);
            errors.push(`Row ${row.rowNumber}: User created but shift assignment failed - ${shiftAssignmentError.message}`);
          }
        }
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        const errorDetails = error.stack ? `\nStack: ${error.stack.substring(0, 200)}` : '';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}${errorDetails}`);
        console.error(`Error inserting user at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Shift records
   */
  private async insertShifts(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const row of rows) {
      try {
        const shiftData: any = {
          name: row.name?.trim(),
          code: row.code?.toUpperCase().trim(),
          startTime: row.startTime?.trim(),
          endTime: row.endTime?.trim(),
          shiftWindowStart: row.shiftWindowStart?.trim(),
          shiftWindowEnd: row.shiftWindowEnd?.trim(),
          applicableForRoles: [], // Required field - empty array by default, can be assigned later
          validFrom: row.validFrom ? this.parseDate(row.validFrom) : new Date(),
          validTill: row.validTill ? this.parseDate(row.validTill) : undefined,
          isActive: row.isActive !== undefined ? row.isActive : false,
          description: row.description?.trim(),
          graceTimeInMinutes: row.graceTimeInMinutes ? this.parseNumeric(row.graceTimeInMinutes, 15) : 15,
          isOvernightShift: row.isOvernightShift !== undefined ? row.isOvernightShift : false
        };

        const shift = new Shift(shiftData);
        await shift.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting shift at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Leave records
   */
  private async insertLeaves(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const row of rows) {
      try {
        // Safety check - rows should already be validated, but double-check ObjectId format
        if (!this.isValidObjectId(row.userId) || !this.isValidObjectId(row.leaveTypeId)) {
          throw new Error('Invalid ObjectId format');
        }

        // For half-day leaves, ensure noOfDays is 0.5
        const leaveDuration = row.leaveDuration || 'full-day';
        let noOfDays = row.noOfDays ? this.parseNumeric(row.noOfDays) : undefined;
        if (leaveDuration === 'half-day') {
          noOfDays = 0.5; // Enforce 0.5 for half-day leaves
        }

        const leaveData: any = {
          userId: new Types.ObjectId(row.userId),
          leaveTypeId: new Types.ObjectId(row.leaveTypeId),
          leaveType: row.leaveType?.trim(),
          startDate: this.parseDate(row.startDate!),
          endDate: this.parseDate(row.endDate!),
          noOfDays: noOfDays,
          status: row.status || 'Pending',
          remarks: row.remarks?.trim(),
          reason: row.reason?.trim(),
          leaveDuration: leaveDuration,
          halfDayType: leaveDuration === 'half-day' ? row.halfDayType : undefined
        };

        if (row.appliedToId) {
          leaveData.appliedTo = {
            _id: row.appliedToId,
            name: row.appliedToName || ''
          };
        }

        if (row.approvedById) {
          if (!this.isValidObjectId(row.approvedById)) {
            throw new Error('Invalid approvedById format');
          }
          leaveData.approvedById = new Types.ObjectId(row.approvedById);
          if (row.approvedAt) {
            leaveData.approvedAt = this.parseDate(row.approvedAt);
          }
        }

        const leave = new Leave(leaveData);
        await leave.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting leave at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Salary Assignment records
   */
  private async insertSalaryAssignments(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const row of rows) {
      try {
        // Safety check - rows should already be validated
        if (!this.isValidObjectId(row.employeeId) || !this.isValidObjectId(row.salaryStructureId)) {
          throw new Error('Invalid ObjectId format');
        }

        // If setting as active, deactivate other assignments
        if (row.isActive) {
          await SalaryAssignment.updateMany(
            { employeeId: new Types.ObjectId(row.employeeId), isActive: true },
            { isActive: false }
          );
        }

        const assignmentData: any = {
          employeeId: new Types.ObjectId(row.employeeId),
          salaryStructureId: new Types.ObjectId(row.salaryStructureId),
          monthlyGross: this.parseNumeric(row.monthlyGross),
          monthlyInsurance: this.parseNumeric(row.monthlyInsurance),
          reimbursement: this.parseNumeric(row.reimbursement),
          travelAllowance: this.parseNumeric(row.travelAllowance),
          airTicketAllowance: this.parseNumeric(row.airTicketAllowance),
          medicalAllowance: this.parseNumeric(row.medicalAllowance),
          isActive: row.isActive !== undefined ? row.isActive : false,
          effectiveFrom: this.parseDate(row.effectiveFrom!),
          effectiveTo: this.parseDate(row.effectiveTo!)
        };

        const assignment = new SalaryAssignment(assignmentData);
        await assignment.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting salary assignment at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Salary Structure records
   */
  private async insertSalaryStructures(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const row of rows) {
      try {
        const structureData: any = {
          name: row.name?.trim(),
          country: row.country || CONSTANTS.DEFAULT_COUNTRY,
          fixedEarnings: {
            basicPercentage: this.parseNumeric(row.basicPercentage),
            hraPercentage: this.parseNumeric(row.hraPercentage),
            daPercentage: this.parseNumeric(row.daPercentage),
            otherAllowancePercentage: this.parseNumeric(row.otherAllowancePercentage),
            travelAllowancePercentage: this.parseNumeric(row.travelAllowancePercentage),
            reimbursementPercentage: this.parseNumeric(row.reimbursementPercentage)
          },
          statutoryDeductions: {
            epf: {
              employeeContribution: this.parseNumeric(row.epfEmployeeContribution),
              employerContribution: this.parseNumeric(row.epfEmployerContribution),
              maxLimit: this.parseNumeric(row.epfMaxLimit)
            },
            esi: {
              employeeContribution: this.parseNumeric(row.esiEmployeeContribution),
              employerContribution: this.parseNumeric(row.esiEmployerContribution),
              applicabilityLimit: this.parseNumeric(row.esiApplicabilityLimit)
            },
            professionalTax: {
              state: '',
              term: '',
              slabs: []
            }
          }
        };

        const structure = new SalaryStructure(structureData);
        await structure.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting salary structure at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Attendance Record records
   */
  private async insertAttendanceRecords(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (const row of rows) {
      try {
        // Safety check - rows should already be validated
        if (!this.isValidObjectId(row.userId) || !this.isValidObjectId(row.shiftId)) {
          throw new Error('Invalid ObjectId format');
        }

        // Parse and validate dates
        const shiftStart = row.shiftStart ? new Date(row.shiftStart) : null;
        const shiftEnd = row.shiftEnd ? new Date(row.shiftEnd) : null;
        const firstIn = row.firstIn ? new Date(row.firstIn) : null;
        const lastOut = row.lastOut ? new Date(row.lastOut) : null;

        if (!shiftStart || isNaN(shiftStart.getTime())) {
          throw new Error('Invalid shift start time');
        }
        if (!shiftEnd || isNaN(shiftEnd.getTime())) {
          throw new Error('Invalid shift end time');
        }
        if (shiftEnd <= shiftStart) {
          throw new Error('Shift end time must be after shift start time');
        }

        const recordData: any = {
          userId: new Types.ObjectId(row.userId),
          shiftId: new Types.ObjectId(row.shiftId),
          shiftCode: row.shiftCode?.trim(),
          shiftDay: this.parseDate(row.shiftDay!),
          shiftStart: shiftStart,
          shiftEnd: shiftEnd,
          firstIn: firstIn && !isNaN(firstIn.getTime()) ? firstIn : null,
          lastOut: lastOut && !isNaN(lastOut.getTime()) ? lastOut : null,
          totalWorkHours: row.totalWorkHours || '0:00:00',
          status: row.status || 'complete',
          isWithinWindow: row.isWithinWindow !== undefined ? row.isWithinWindow : false,
          isLateEntry: row.isLateEntry !== undefined ? row.isLateEntry : false,
          isEarlyExit: row.isEarlyExit !== undefined ? row.isEarlyExit : false
        };

        const record = new AttendanceRecord(recordData);
        await record.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting attendance record at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Insert Optional Holiday records
   */
  private async insertOptionalHolidays(rows: IImportRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    // Track approved optional holidays per user per year during import
    // Key: userId_year, Value: count of approved holidays
    const DEFAULT_MAX_OPTIONAL_HOLIDAYS_PER_YEAR = 0; // Default fallback value
    const maxAllowedByYear = new Map<string, number>(); // Key: userId_year -> max allowed from leave summary
    const approvedCountByYear = new Map<string, number>(); // Key: userId_year

    // Pre-populate with existing approved counts from database
    const userIds = new Set<string>();
    const years = new Set<number>();
    for (const row of rows) {
      if (row.userId && this.isValidObjectId(row.userId)) {
        userIds.add(row.userId);
        const year = parseInt(row.year?.toString() || '0');
        if (!isNaN(year)) {
          years.add(year);
        }
      }
    }

    // Get existing approved counts for all users and years in this import
    if (userIds.size > 0 && years.size > 0) {
      const existingApproved = await OptionalHolidayRequest.find({
        userId: { $in: Array.from(userIds).map(id => new Types.ObjectId(id)) },
        year: { $in: Array.from(years) },
        status: 'Approved',
      }).select('userId year').lean();

      for (const approved of existingApproved) {
        const key = `${approved.userId}_${approved.year}`;
        const currentCount = approvedCountByYear.get(key) || 0;
        approvedCountByYear.set(key, currentCount + 1);
      }
    }

    for (const row of rows) {
      try {
        if (!this.isValidObjectId(row.userId)) {
          throw new Error('Invalid User ID format');
        }

        const holidayDate = this.parseDate(row.holidayDate!);
        if (!holidayDate) {
          throw new Error('Invalid holiday date format');
        }

        const year = parseInt(row.year!.toString());
        if (isNaN(year)) {
          throw new Error('Invalid year');
        }

        // Get user to fetch holiday calendar and validate
        const user = await User.findById(row.userId).select('name email holidayCalendarId').lean();
        if (!user) {
          throw new Error('User not found');
        }

        // Get holiday calendar to validate holiday name
        let holidayName = row.holidayName?.trim();
        if (user.holidayCalendarId) {
          const calendar = await HolidayCalendar.findById(user.holidayCalendarId).lean();
          if (calendar) {
            const holidayDateStr = holidayDate.toISOString().split('T')[0];
            const matchingHoliday = calendar.holidays.find((h: any) => {
              const hDateStr = new Date(h.date).toISOString().split('T')[0];
              return hDateStr === holidayDateStr && h.type === 'optional';
            });
            if (matchingHoliday) {
              holidayName = matchingHoliday.name; // Use name from calendar
            }
          }
        }

        if (!holidayName) {
          throw new Error('Holiday name is required');
        }

        // Check for duplicate request
        const startOfDay = new Date(holidayDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(holidayDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const existingRequest = await OptionalHolidayRequest.findOne({
          userId: new Types.ObjectId(row.userId),
          holidayDate: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        });

        if (existingRequest) {
          errors.push(`Row ${row.rowNumber}: Optional holiday request already exists for this date`);
          continue;
        }

        // Prepare appliedTo if provided
        let appliedTo = undefined;
        if (row.appliedToId && this.isValidObjectId(row.appliedToId)) {
          const appliedToUser = await User.findById(row.appliedToId).select('name').lean();
          if (appliedToUser) {
            appliedTo = {
              _id: row.appliedToId,
              name: row.appliedToName?.trim() || appliedToUser.name || 'Manager',
            };
          }
        }

        // Check annual limit if status is Approved
        // Track count during import: 1 applied = 1 used, 2 applied = 0 remaining
        let finalStatus = row.status || 'Pending';
        if (finalStatus === 'Approved') {
          const userIdYearKey = `${row.userId}_${year}`;
          const currentApprovedCount = approvedCountByYear.get(userIdYearKey) || 0;

          // Get max allowed from leave summary (check cache first, then fetch if needed)
          let maxAllowed = maxAllowedByYear.get(userIdYearKey);
          if (maxAllowed === undefined) {
            try {
              const leaveSummary = await this.leaveSummaryService.getLeaveSummary(
                new Types.ObjectId(row.userId),
                year
              );
              maxAllowed = leaveSummary.restricted_holiday?.alloted;
              // Use value from leave summary, default to 0 if not set
              maxAllowed = maxAllowed !== undefined && maxAllowed !== null 
                ? maxAllowed 
                : DEFAULT_MAX_OPTIONAL_HOLIDAYS_PER_YEAR;
              maxAllowedByYear.set(userIdYearKey, maxAllowed);
            } catch (error) {
              console.error(`Error getting max optional holidays for user ${row.userId}, year ${year}:`, error);
              maxAllowed = DEFAULT_MAX_OPTIONAL_HOLIDAYS_PER_YEAR;
              maxAllowedByYear.set(userIdYearKey, maxAllowed);
            }
          }

          if (currentApprovedCount >= maxAllowed) {
            // Limit reached - change to Pending
            errors.push(`Row ${row.rowNumber}: Cannot approve - user already has ${currentApprovedCount} approved optional holidays for ${year}. Maximum is ${maxAllowed} per year. Changing status to Pending.`);
            finalStatus = 'Pending';
          } else {
            // Increment count for this user/year
            approvedCountByYear.set(userIdYearKey, currentApprovedCount + 1);
          }
        }

        // Prepare optional holiday data
        const optionalHolidayData: any = {
          userId: new Types.ObjectId(row.userId),
          holidayDate: holidayDate,
          holidayName: holidayName,
          year: year,
          status: finalStatus,
          reason: row.reason?.trim() || undefined,
          remarks: row.remarks?.trim() || undefined,
          appliedTo: appliedTo,
        };

        // If status is Approved, set approvedBy and approvedAt
        if (finalStatus === 'Approved') {
          if (row.approvedById && this.isValidObjectId(row.approvedById)) {
            const approver = await User.findById(row.approvedById).select('name email').lean();
            if (approver) {
              optionalHolidayData.approvedBy = {
                _id: new Types.ObjectId(row.approvedById),
                name: approver.name,
                email: approver.email,
              };
              optionalHolidayData.approvedById = new Types.ObjectId(row.approvedById);
            }
          }
          if (row.approvedAt) {
            const approvedAt = this.parseDate(row.approvedAt);
            if (approvedAt) {
              optionalHolidayData.approvedAt = approvedAt;
            }
          } else {
            optionalHolidayData.approvedAt = new Date();
          }
        }

        // If status is Rejected, set rejectedAt
        if (row.status === 'Rejected') {
          optionalHolidayData.rejectedAt = new Date();
        }

        // If status is Cancelled, set cancelledAt
        if (row.status === 'Cancelled') {
          optionalHolidayData.cancelledAt = new Date();
        }

        // Mark as migrated from manual import
        optionalHolidayData.migratedFrom = {
          source: 'manual',
        };

        // Create the optional holiday request
        const request = new OptionalHolidayRequest({
          ...optionalHolidayData,
          user: {
            name: user.name,
            email: user.email,
          },
        });

        await request.save();
        created++;
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error occurred';
        errors.push(`Row ${row.rowNumber}: ${errorMessage}`);
        console.error(`Error inserting optional holiday at row ${row.rowNumber}:`, error);
      }
    }

    return { created, errors };
  }

  /**
   * Helper methods
   */
  private getSheetName(objectType: ExportableObject): string {
    const names: { [key: string]: string } = {
      'user': 'Users',
      'shift': 'Shifts',
      'leave': 'Leaves',
      'salary-assignment': 'Salary Assignments',
      'salary-structure': 'Salary Structures',
      'attendance-record': 'Attendance Records',
      'optional-holiday': 'Optional Holidays'
    };
    return names[objectType] || objectType;
  }

  private styleHeaderRow(row: ExcelJS.Row): void {
    row.font = { bold: true };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }

  /**
   * Add field requirement notes to header cells
   */
  private addFieldRequirementNotes(worksheet: ExcelJS.Worksheet, fieldRequirements: { [columnIndex: number]: { required: boolean; note?: string } }): void {
    Object.entries(fieldRequirements).forEach(([colIndex, info]) => {
      const cell = worksheet.getCell(1, parseInt(colIndex));
      if (info.required) {
        cell.note = `Required field${info.note ? ` - ${info.note}` : ''}`;
        cell.font = { ...cell.font, color: { argb: 'FFFF0000' } }; // Red for required
      } else {
        cell.note = `Optional field${info.note ? ` - ${info.note}` : ''}`;
      }
    });
  }

  private autoFitColumns(worksheet: ExcelJS.Worksheet): void {
    worksheet.columns.forEach(column => {
      if (column.header) {
        column.width = Math.max(column.width || 0, column.header.toString().length + 2);
      }
    });
  }

  private getCellValue(row: ExcelJS.Row, columnIndex: number): string {
    const cell = row.getCell(columnIndex);

    // Use ExcelJS's text property which gives the formatted display value
    // This handles all cell types (string, number, date, formula, rich text, etc.)
    if (cell.text) {
      return cell.text.trim();
    }

    // Fallback to value if text is not available
    if (!cell.value) {
      return '';
    }

    // Handle different cell value types
    const value = cell.value;

    // If it's already a string, return it trimmed
    if (typeof value === 'string') {
      return value.trim();
    }

    // If it's a number, convert to string
    if (typeof value === 'number') {
      return value.toString().trim();
    }

    // If it's a boolean, convert to string
    if (typeof value === 'boolean') {
      return value.toString();
    }

    // If it's a Date object, format it
    if (value instanceof Date) {
      return value.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    }

    // If it's a rich text object (ExcelJS.RichText), extract the text
    if (value && typeof value === 'object' && 'richText' in value) {
      const richText = value as any;
      if (richText.richText && Array.isArray(richText.richText)) {
        return richText.richText.map((rt: any) => rt.text || '').join('').trim();
      }
    }

    // If it's an object with a text property (some ExcelJS cell types)
    if (value && typeof value === 'object' && 'text' in value) {
      return String((value as any).text).trim();
    }

    // Last resort: try toString, but check if it's [object Object]
    const stringValue = value.toString();
    if (stringValue === '[object Object]') {
      // Log warning for debugging
      console.warn(`⚠️ [Cell Value] Row ${row.number}, Column ${columnIndex}: Cell value is an object. Type:`, typeof value, 'Keys:', Object.keys(value || {}));
      return '';
    }

    return stringValue.trim();
  }

  /**
   * Safely parse a boolean value from cell
   */
  private parseBoolean(value: string, defaultValue: boolean = false): boolean {
    if (!value || typeof value !== 'string') return defaultValue;
    return value.toLowerCase().trim() === CONSTANTS.BOOLEAN_YES;
  }

  private parseDate(dateString: string): Date | null {
    if (!dateString || typeof dateString !== 'string') return null;

    const trimmed = dateString.trim();
    if (!trimmed) return null;

    // Try parsing as ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
    let date = new Date(trimmed);

    // If invalid, try common formats
    if (isNaN(date.getTime())) {
      // Try DD/MM/YYYY or MM/DD/YYYY
      const parts = trimmed.split(/[-\/]/);
      if (parts.length === 3) {
        // Assume YYYY-MM-DD format if first part is 4 digits
        if (parts[0].length === 4) {
          date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
        } else {
          // Assume DD/MM/YYYY
          date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
      }
    }

    // Final validation
    if (isNaN(date.getTime())) {
      console.warn(`Invalid date format: ${dateString}`);
      return null;
    }

    return date;
  }

  /**
   * Validate if a string is a valid MongoDB ObjectId
   */
  private isValidObjectId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;
  }

  /**
   * Safely parse a numeric value
   */
  private parseNumeric(value: any, defaultValue: number = 0): number {
    if (value === null || value === undefined || value === '') return defaultValue;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? defaultValue : parsed;
  }
}

