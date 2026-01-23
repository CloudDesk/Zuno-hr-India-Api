import { Types } from 'mongoose';
import {
    AttendanceRecord,
    HolidayCalendar,
    Leave,
    Overtime,
    Payroll,
    SalaryAssignment,
    ShiftAssignment,
    User,
} from '../models';
// Note: OptionalHolidayRequest import removed - restricted holidays are now handled via Leave model (leaveType: 'restricted_holiday')
import { TaxDeclaration } from '../models/tax-declaration';
import { PayrollStatus, } from './payroll-status.service';
import XLSX from "xlsx";
import { unlink } from 'fs/promises';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { DeductionQuery } from '../routes/payroll.routes';
import { getCurrentFinancialYear } from '../utilis/dates';
import { Parser } from "json2csv";

// Constants
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

const MONTH_SHORT_NAMES: Record<string, string> = {
    January: 'Jan',
    February: 'Feb',
    March: 'Mar',
    April: 'Apr',
    May: 'May',
    June: 'Jun',
    July: 'Jul',
    August: 'Aug',
    September: 'Sep',
    October: 'Oct',
    November: 'Nov',
    December: 'Dec',
};

interface PayrollRecord {
    employeeId: Types.ObjectId;
    salaryAssignmentId: Types.ObjectId;
    monthlyGross: number;
    attendanceAdjustedGross: number;
    totalDaysInMonth: number;
    payableDays: number;  // attendance.presentDays + attendance.weekendDays + attendance.holidayDays + approvedLeaves
    basic: number;
    hra: number;
    da: number;
    otherAllowance: number;
    travelAllowance: number;
    airTicketAllowance: number; // ✅ NEW: Air ticket allowance
    medicalAllowance: number; // ✅ NEW: Medical allowance
    reimbursementAllowance: number;
    epfEmployee: number;
    epfEmployer: number;
    esiEmployee: number;
    esiEmployer: number;
    professionalTax: number;
    incomeTax: number;
    totalDeductions: number;
    additionalDeduction: number;
    overtimeHours: number;
    overtimePay: number;
    leaveDeductions: number;
    reimbursement: number;
    bonus: number;
    netSalary: number;
    ctc: number;
    monthYear: string;
    month: number;
    year: number;
    processedAt: Date;
    status: PayrollStatus;
    presentDays: number;
    LOPDays: number;
    country: string; // 'AE' | 'IN'
    assigned: {
        basic: number;
        hra: number;
        da: number;
        otherAllowance: number;
        travelAllowance: number;
        airTicketAllowance: number; // ✅ NEW: Air ticket allowance
        medicalAllowance: number; // ✅ NEW: Medical allowance
        reimbursementAllowance: number;
    }
}

interface IInitiatePayroll {
    totalRecords: number;
    totalActiveEmployees: number;
    totalEmployees: number;
    totalGrossSalary: number;
    totalNetSalary: number;
    totalDeductions: number;
    totalPresentDays: number;
    totalLOPDays: number;
    totalPayableDays: number;
    status: PayrollStatus;
}
// Define an enum for consistent status tracking



/*
interface ExcelRow {
    "Payroll ID": string;
    "payrollId"?: string; // Added alias for consistency
    "ID"?: string; // Added to fix the error
    "Employee Name"?: string;
    "Net Salary"?: string | number;
    Status: "Completed" | "Failed";
    "UTR Number"?: string;
    "Failure Reason"?: string;
}

interface ValidatedRow {
    payrollId: string;
    employeeName?: string;
    status: PayrollStatus;
    utrNumber?: string;
    failureReason?: string;
    errors: string[];
}
*/

export class PayrollService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    /**
     * Get country-specific deduction rules
     * @param country - Employee's country code ('IN' | 'AE')
     * @returns Object with deduction rules for the country
     */
    private getCountryDeductionRules(country: string): {
        hasEPF: boolean;
        hasESI: boolean;
        hasProfessionalTax: boolean;
        hasIncomeTax: boolean;
        description: string;
    } {
        switch (country) {
            case 'IN':
                return {
                    hasEPF: true,
                    hasESI: true,
                    hasProfessionalTax: true,
                    hasIncomeTax: true,
                    description: 'India - Full statutory deductions apply'
                };
            case 'AE':
                return {
                    hasEPF: false,
                    hasESI: false,
                    hasProfessionalTax: false,
                    hasIncomeTax: false,
                    description: 'UAE - No statutory deductions'
                };
            default:
                // Default to India for backward compatibility
                return {
                    hasEPF: true,
                    hasESI: true,
                    hasProfessionalTax: true,
                    hasIncomeTax: true,
                    description: `Unknown country '${country}' - Defaulting to India rules`
                };
        }
    }

    /**
     * Validate salary structure for country-specific requirements
     * @param salaryStructure - Salary structure object
     * @param employeeCountry - Employee's country code
     * @param employeeId - Employee ID for error messages
     */
    private validateSalaryStructureForCountry(
        salaryStructure: any,
        employeeCountry: string,
        employeeId: Types.ObjectId
    ): void {
        const countryRules = this.getCountryDeductionRules(employeeCountry);
        console.log(countryRules, "countryRules")
        if (employeeCountry === 'IN') {
            // Indian employees require full salary structure
            if (!salaryStructure || !salaryStructure.statutoryDeductions) {
                throw new Error(`Salary structure with statutory deductions is required for Indian employees (Employee ID: ${employeeId})`);
            }

            // Validate required fields for Indian employees
            const requiredFields = [
                'epf.employeeContribution',
                'epf.employerContribution',
                'epf.maxLimit',
                'esi.employeeContribution',
                'esi.employerContribution',
                'esi.applicabilityLimit',
                'professionalTax.state',
                'professionalTax.term',
                'professionalTax.slabs'
            ];

            for (const field of requiredFields) {
                const fieldPath = field.split('.');
                let value = salaryStructure.statutoryDeductions;
                for (const path of fieldPath) {
                    value = value?.[path];
                    if (value === undefined) {
                        throw new Error(`Missing required field '${field}' in salary structure for Indian employee (Employee ID: ${employeeId})`);
                    }
                }
            }
        }

        // UAE employees don't need statutory deduction fields
        // They can use a simplified salary structure or the same structure (values will be ignored)
        console.log(`Salary structure validation passed for ${employeeCountry} employee (${employeeId})`);
    }

    private static stateTransitions: Record<PayrollStatus, PayrollStatus[]> = {
        [PayrollStatus.Draft]: [PayrollStatus.PendingApproval, PayrollStatus.Cancelled],
        [PayrollStatus.PendingApproval]: [PayrollStatus.InPayment, PayrollStatus.Cancelled],
        [PayrollStatus.InPayment]: [PayrollStatus.Completed, PayrollStatus.Failed],
        [PayrollStatus.Completed]: [],
        [PayrollStatus.Failed]: [PayrollStatus.Completed, PayrollStatus.Failed],
        [PayrollStatus.RetryPending]: [PayrollStatus.InPayment, PayrollStatus.Cancelled],
        [PayrollStatus.Cancelled]: [],
        // [PayrollStatus.Hold]: [PayrollStatus.Draft, PayrollStatus.PendingApproval, PayrollStatus.InPayment]
    };

    private static maxRetries = 3;

    private canTransition(currentStatus: PayrollStatus, newStatus: PayrollStatus): boolean {
        return PayrollService.stateTransitions[currentStatus]?.includes(newStatus) || false;
    }

    async getDeductions(query: DeductionQuery) {
        console.log(query, 'query getDeductions');
        const { month, financialYear, department, location, employeeId, exportFormat = "json" } = query;
        if (!month) {
            throw new Error(`Month is required`);
        }

        const monthOrder = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
        const monthIndex = monthOrder.indexOf(month);
        if (monthIndex === -1) {
            throw new Error(`Invalid month: ${month}. Must be one of: ${monthOrder.join(", ")}`);
        }

        const effectiveFY = financialYear || getCurrentFinancialYear();
        const [fyStartYear] = effectiveFY.split("-").map(Number);
        const payrollMonth = monthIndex + 4 <= 12 ? monthIndex + 4 : monthIndex - 8; // Map Apr-Mar to 4-12, 1-3
        const payrollYear = monthIndex + 4 <= 12 ? fyStartYear : fyStartYear + 1;


        // Build user query with filters
        const userQuery: any = { active: true };
        if (department) userQuery.departmentId = department;
        if (location) userQuery.location = location;
        if (employeeId) userQuery._id = new Types.ObjectId(employeeId);;

        // Fetch users with matching filters
        const users = await User.find(userQuery).select("_id name  departmentId location");
        console.log(users, "users")
        if (!users.length) {
            throw new Error("No active employees found for the given filters");
        }

        const employeeIds = users.map((user) => user._id);

        const payrollRecords = await Payroll.find({
            employeeId: { $in: employeeIds },
            month: payrollMonth,
            year: payrollYear,
            status: { $nin: ['Cancelled'] }
        }).select('employeeId professionalTax incomeTax salaryAssignmentId').lean();
        console.log(payrollRecords, 'payrollRecords getDeductions');

        // Fetch tax declarations for the financial year and employees
        const taxDeclarations = await TaxDeclaration.find({
            employeeId: { $in: employeeIds },
            financialYear: effectiveFY,
        }).lean();

        // Map payroll records by employeeId for quick lookup
        const payrollMap = new Map(payrollRecords.map((record) => [record.employeeId.toString(), record]));


        // Prepare deduction data
        const deductionData = users
            .map((user) => {
                const taxDeclaration = taxDeclarations.find(
                    (td) => td.employeeId.toString() === user._id.toString()
                );
                const payroll = payrollMap.get(user._id.toString());

                // Skip if no payroll or tax declaration data exists
                if (!payroll || !taxDeclaration) {
                    return null;
                }

                const monthlyDeduction = taxDeclaration.monthlyDeductions.find(
                    (deduction) => deduction.month === month && deduction.isProcessed
                );
                if (!monthlyDeduction) {
                    return null;
                }

                return {
                    employeeId: user._id.toString(),
                    name: user.name,
                    pan: 'N/A',
                    department: user.departmentId?.toString() || 'N/A',
                    location: user.location || 'N/A',
                    taxToBePaid: monthlyDeduction.actualDeduction || 0,
                    professionalTax: payroll.professionalTax || 0, // Use payroll's professionalTax
                    salaryAssignmentId: payroll.salaryAssignmentId?.toString() || 'N/A', // Include salaryAssignmentId
                    month,
                    financialYear: effectiveFY,
                };
            })
            .filter((data): data is NonNullable<typeof data> => data !== null);

        if (!deductionData.length) {
            throw new Error(`No processed deductions found for month ${month} in FY ${effectiveFY}`);
        }

        // Handle export formats
        if (exportFormat === 'csv') {
            const fields = [
                { label: 'Employee ID', value: 'employeeId' },
                { label: 'Name', value: 'name' },
                { label: 'PAN', value: 'pan' },
                { label: 'Department', value: 'department' },
                { label: 'Location', value: 'location' },
                { label: 'Tax to be Paid', value: 'taxToBePaid' },
                { label: 'Professional Tax', value: 'professionalTax' },
                { label: 'Salary Assignment ID', value: 'salaryAssignmentId' },
                { label: 'Month', value: 'month' },
                { label: 'Financial Year', value: 'financialYear' },
            ];
            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(deductionData);
            return csv;
        } else if (exportFormat === 'excel') {
            const worksheet = XLSX.utils.json_to_sheet(deductionData, {
                header: [
                    'employeeId',
                    'name',
                    'pan',
                    'department',
                    'location',
                    'taxToBePaid',
                    'professionalTax',
                    'salaryAssignmentId',
                    'month',
                    'financialYear',
                ],
            });
            const workbook: XLSX.WorkBook = { Sheets: { Deductions: worksheet }, SheetNames: ['Deductions'] };
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
            return excelBuffer;
        } else {
            // Default to JSON
            return deductionData;
        }

    }

    async deletePayroll(month: number, year: number, country?: string) {
        console.log(`Deleting payroll records for ${month}-${year}${country ? ` for country ${country}` : ''}`);
        // Delete all payroll records for the specified month and year
        const query: any = { month, year };
        if (country) {
            query.country = country;
        }
        const result = await Payroll.deleteMany(query);
        console.log(`Deleted ${result.deletedCount} payroll records for ${month}-${year}${country ? ` for country ${country}` : ''}`);
        return result.deletedCount > 0;
    }

    // Delete a single payroll record by ID (Only if status is Draft)
    async deletePayrollRecord(id: string) {
        if (!Types.ObjectId.isValid(id)) {
            throw new Error('Invalid Payroll ID');
        }

        const payroll = await Payroll.findById(id);

        if (!payroll) {
            throw new Error('Payroll record not found');
        }

        if (payroll.status !== PayrollStatus.Draft) {
            throw new Error(`Cannot delete payroll record with status '${payroll.status}'. Only 'Draft' records can be deleted.`);
        }

        await Payroll.findByIdAndDelete(id);
        return { success: true, message: 'Payroll record deleted successfully' };
    }

    async getUserIdsByFilters(
        filters: {
            departmentId?: string;
            role?: string;
            status?: string[]; // note: now it should be an array
            search?: string;
            country?: string;
        },
        monthYear: string, // format: YYYY-MM
        mode: 'excludeBlocked' | 'onlyCompleted' = 'excludeBlocked'
    ): Promise<string[]> {
        const query: any = {};
        const andConditions: any[] = [];
        const [year, month] = monthYear.split("-");

        const { departmentId, role, status, search, country } = filters;
        console.log(filters, 'filters getUserIdsByFilters');
        // 1. Department filter
        if (departmentId) {
            andConditions.push({ departmentId });
        }
        // 2. Role filter
        if (role) {
            andConditions.push({ role });
        }

        // 3. Month filter on joiningDate
        if (monthYear) {
            const [year, month] = monthYear.split('-').map(Number);
            const monthEnd = new Date(year, month, 0, 23, 59, 59, 999); // Last day of the month
            andConditions.push({ joiningDate: { $lte: monthEnd } });
        }

        // 4. Search filter (name/email)
        if (search) {
            andConditions.push({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ],
            });
        }
        // 5. Country filter
        if (country) {
            andConditions.push({ country });
        }
        // 6. Status filter
        if (status?.length) {
            const statusFilters: any[] = [];

            if (status.includes('Active')) {
                statusFilters.push({ active: true });
            }

            if (status.includes('On Hold')) {
                statusFilters.push({
                    active: true,
                    resignations: {
                        $elemMatch: {
                            status: 'Pending',
                            isActive: true,
                        },
                    },
                });
            }

            if (status.includes('Resigned')) {
                statusFilters.push({
                    resignations: {
                        $elemMatch: {
                            status: 'Approved',
                            isActive: true,
                        },
                    },
                });
            }

            if (statusFilters.length) {
                andConditions.push({ $or: statusFilters });
            }
        }
        if (andConditions.length > 0) {
            query.$and = andConditions;
        }
        console.log('Final query for user filter:', JSON.stringify(query, null, 2));

        const employees = await User.find(query, { _id: 1 });
        let employeeIds = employees.map((e) => e._id.toString())
        console.log('Filtered employee IDs:', employeeIds);
        let payrollRecords = await this.getPayrollRecordsForUsers(employeeIds, Number(month), Number(year));
        console.log(payrollRecords, 'payrollRecords getUserIdsByFilters');
        /*
         const blockedStatuses = ['Draft', 'PendingApproval', 'InPayment', 'Completed', 'Completed', 'Failed', 'RetryPending'];
         //    status: 'Draft' | 'PendingApproval' | 'InPayment' | 'Completed' | 'Failed' | 'RetryPending' | 'Cancelled';
         //    
         const blockedUserIds = new Set(
             payrollRecords
                 .filter((record) => blockedStatuses.includes(record.status))
                 .map((record) => record.employeeId.toString())
         );
         const finalUserIds = employeeIds.filter((id) => !blockedUserIds.has(id));
 
         */
        let finalUserIds: string[] = [];

        if (mode === 'excludeBlocked') {
            console.log("excludeBlocked")
            const blockedStatuses = ['Draft', 'PendingApproval', 'InPayment', 'Completed', 'Failed', 'RetryPending'];
            const blockedUserIds = new Set(
                payrollRecords
                    .filter((record) => blockedStatuses.includes(record.status))
                    .map((record) => record.employeeId.toString())
            );
            finalUserIds = employeeIds.filter((id) => !blockedUserIds.has(id));
        }

        else if (mode === 'onlyCompleted') {
            console.log("onlyCompleted")
            finalUserIds = payrollRecords
                .filter((record) => record.status === 'Completed')
                .map((record) => record.employeeId.toString());
        }

        console.log(finalUserIds, 'finalUserIds getUserIdsByFilters');

        return finalUserIds;
    }

    async getPayrollSummary(month: number, year: number, status?: PayrollStatus[], country?: string): Promise<{
        totalEmployees: number;
        totalGrossSalary: number;
        totalDeductions: number;
        totalNetSalary: number;
        totalPresentDays: number;
        totalLOPDays: number;
        totalPayableDays: number;
        statusBreakdown: Record<PayrollStatus, number>;
        failedRecords?: Array<{ employeeId: Types.ObjectId; failureReason?: string; retryCount?: number }>;
        exportableDetails: Array<{
            _id: Types.ObjectId;
            employeeId: Types.ObjectId;
            employeeName: string;
            bankAccountNumber: string;
            ifscCode: string;
            bankName: string;
            netSalary: number;
            presentDays: number;
            totalDaysInMonth: number;
            lopDays: number;
            payableDays: number;
            overtimeHours: number;
            overtimePay: number;
            status: PayrollStatus;
        }>;
    }> {
        console.log(`Fetching payroll summary for ${month}-${year}${status ? ` with status: ${status.join(', ')}` : ''}`);

        // Step 1: Fetch payroll data using aggregation for efficiency
        const query: any = { month, year };
        if (status && status.length > 0) {
            query.status = { $in: status };
        } else {
            query.status = { $nin: [PayrollStatus.Cancelled] };
        }

        // Add country filter if provided
        if (country) {
            query.country = country;
        }

        const payrollAggregation = await Payroll.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalEmployees: { $sum: 1 },
                    totalGrossSalary: { $sum: "$monthlyGross" },
                    totalDeductions: { $sum: "$totalDeductions" },
                    totalNetSalary: { $sum: "$netSalary" },
                    totalPresentDays: { $sum: "$presentDays" },
                    totalLOPDays: { $sum: "$LOPDays" },
                    totalPayableDays: { $sum: { $subtract: ["$totalDaysInMonth", "$LOPDays"] } },
                    statusBreakdown: {
                        $push: {
                            status: "$status",
                            count: { $sum: 1 }
                        }
                    },
                    failedRecords: {
                        $push: {
                            $cond: [
                                { $eq: ["$status", PayrollStatus.Failed] },
                                {
                                    employeeId: "$employeeId",
                                    failureReason: "$failureReason",
                                    retryCount: "$retryCount"
                                },
                                null
                            ]
                        }
                    },
                    records: { $push: "$$ROOT" }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalEmployees: 1,
                    totalGrossSalary: { $round: ["$totalGrossSalary", 0] },
                    totalDeductions: { $round: ["$totalDeductions", 0] },
                    totalNetSalary: { $round: ["$totalNetSalary", 0] },
                    totalPresentDays: 1,
                    totalLOPDays: 1,
                    totalPayableDays: 1,
                    statusBreakdown: {
                        $arrayToObject: {
                            $map: {
                                input: Object.values(PayrollStatus),
                                as: "status",
                                in: {
                                    k: "$$status",
                                    v: {
                                        $sum: {
                                            $map: {
                                                input: "$statusBreakdown",
                                                as: "sb",
                                                in: { $cond: [{ $eq: ["$$sb.status", "$$status"] }, "$$sb.count", 0] }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    failedRecords: {
                        $filter: {
                            input: "$failedRecords",
                            as: "record",
                            cond: { $ne: ["$$record", null] }
                        }
                    },
                    records: 1
                }
            }
        ]);

        if (!payrollAggregation.length) {
            throw new Error(`No payroll records found for ${month}-${year}${status ? ` with status ${status.join(', ')}` : ''}`);
        }

        const { totalEmployees, totalGrossSalary, totalDeductions, totalNetSalary, totalPresentDays, totalLOPDays, totalPayableDays, statusBreakdown, failedRecords, records } = payrollAggregation[0];

        // Step 2: Retrieve employee bank details for export
        const employeeIds = records.map((record: any) => record.employeeId);
        const employees = await User.find(
            { _id: { $in: employeeIds } },
            'name bankDetails'
        ).lean();

        const exportableDetails = records.map((record: any) => {
            const employee = employees.find((emp) => emp._id.toString() === record.employeeId.toString());
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
                status: record.status
            };
        });

        // Step 3: Return aggregated data
        return {
            totalEmployees,
            totalGrossSalary,
            totalDeductions,
            totalNetSalary,
            totalPresentDays,
            totalLOPDays,
            totalPayableDays,
            statusBreakdown,
            failedRecords: failedRecords || [],
            exportableDetails
        };
    }

    async getPayrollRecordsForUsers(
        userIds: string[],
        month: number,
        year: number
    ) {
        const objectIds = userIds.map(id => new Types.ObjectId(id));
        console.log(objectIds, 'objectIds getPayrollRecordsForUsers');
        const payrollRecords = await Payroll.find({
            employeeId: { $in: objectIds },
            month,
            year
        },
            { employeeId: 1, status: 1, paymentConfirmedAt: 1 }
        )
        console.log(payrollRecords, 'payrollRecords getPayrollRecordsForUsers');

        return payrollRecords;
    }

    async importPayrollPayments(
        file: {
            path: string;
            originalname: string;
            mimetype: string;
        },
        userId: string
    ): Promise<Array<{
        payrollId: string;
        employeeName: string;
        status: 'Completed' | 'Failed';
        utrNumber?: string;
        failureReason?: string;
        errors: string[];
    }>> {
        if (!userId) {
            throw new Error('User ID is required.');
        }

        if (!file || !file.path) {
            throw new Error('No file provided.');
        }

        if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            throw new Error('Invalid file format. Only .xlsx files are supported.');
        }
        try {
            console.log('Processing file:', file.originalname, 'userId:', userId);

            // Read Excel file
            const workbook = XLSX.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet, { raw: false }) as Array<any>;

            if (!rawData.length) {
                throw new Error('Excel file is empty.');
            }

            // Define column name mappings (case-insensitive)
            const columnMappings: Record<string, string[]> = {
                payrollId: ['payrollId', 'PayrollId', 'PAYROLLID', '_id', '_ID', 'id', 'ID'],
                employeeName: ['employeeName', 'EmployeeName', 'EMPLOYEENAME', 'employee_name', 'Employee_Name'],
                status: ['status', 'Status', 'STATUS'],
                utrNumber: ['utrNumber', 'UtrNumber', 'UTRNUMBER', 'utr_number', 'UTR_NUMBER'],
                failureReason: ['failureReason', 'FailureReason', 'FAILUREREASON', 'failure_reason', 'FAILURE_REASON'],
            };

            // Normalize data by mapping column names
            const normalizedData = rawData.map((row) => {
                const normalizedRow: Record<string, any> = {};
                for (const [key, aliases] of Object.entries(columnMappings)) {
                    for (const alias of aliases) {
                        if (row[alias] !== undefined) {
                            normalizedRow[key] = typeof row[alias] === 'string' ? row[alias].trim() : row[alias];
                            break;
                        }
                    }
                }
                return normalizedRow;
            });

            console.log('Normalized data:', normalizedData);



            const results: Array<{
                payrollId: string;
                employeeName: string;
                status: 'Completed' | 'Failed';
                utrNumber?: string;
                failureReason?: string;
                errors: string[];
            }> = [];

            // Validate each row
            for (const row of normalizedData) {
                console.log(row, 'row importPayrollPayments');
                const { payrollId, employeeName, status, utrNumber, failureReason } = row;
                const errors: string[] = [];

                // Validate required fields
                if (!payrollId) {
                    errors.push('Payroll ID is missing.');
                }
                if (!employeeName) {
                    errors.push('Employee name is missing.');
                }
                if (!status || !['Completed', 'Failed'].includes(status)) {
                    errors.push('Status must be either "Completed" or "Failed".');
                }

                // Validate payrollId and current status
                if (payrollId) {
                    const payroll = await Payroll.findById(payrollId);
                    console.log(payroll, "Payroll importPayrollPayments");
                    if (!payroll) {
                        errors.push('Payroll record not found.');
                    } else if (![PayrollStatus.InPayment, PayrollStatus.Failed].includes(payroll.status as PayrollStatus)) {
                        errors.push(`Current status must be "InPayment" or "Failed", found "${payroll.status}".`);
                    }

                }

                // Validate status-specific fields
                if (status === 'Completed' && !utrNumber) {
                    errors.push('UTR number is required for "Completed" status.');
                }
                if (status === 'Failed' && !failureReason) {
                    errors.push('Failure reason is required for "Failed" status.');
                }

                results.push({
                    payrollId: payrollId || '',
                    employeeName: employeeName || '',
                    status: status as 'Completed' | 'Failed',
                    utrNumber,
                    failureReason,
                    errors,
                });
            }
            console.log(results, 'results importPayrollPayments');
            return results;
        } catch (error: any) {
            throw new Error(`Failed to process Excel file: ${error.message}`);
        } finally {
            // Clean up uploaded file
            try {
                await unlink(file.path);
                console.log('Deleted file:', file.path);
            } catch (err) {
                console.error('Failed to delete file:', file.path, err);
            }
        }
    }


    async updatePayrollStatus(
        params: {
            id?: string,
            recordIds?: string[],
            status: PayrollStatus,
            userId: string,
            failureReason?: string,
            utrNumber?: string
        }
    ): Promise<{ updatedCount: number; failedRecords: Array<{ id: string; reason: string }> }> {
        const { id, recordIds, status, userId, failureReason, utrNumber } = params;
        console.log("updatePayrollStatus", params)
        // Validate input
        if (!id && (!recordIds || !recordIds.length)) {
            throw new Error('Either id or recordIds must be provided.');
        }
        if (!userId) {
            throw new Error('User ID is required.');
        }
        if (status === PayrollStatus.Failed && !failureReason) {
            throw new Error('Failure reason is required for Failed status.');
        }
        if (status === PayrollStatus.Completed && !utrNumber) {
            throw new Error('UTR number is required for Completed status.');
        }

        const idsToUpdate = id ? [id] : recordIds!;
        const failedRecords: Array<{ id: string; reason: string }> = [];
        let updatedCount = 0;

        // Fetch records
        const payrollRecords = await Payroll.find({
            _id: { $in: idsToUpdate.map(id => new Types.ObjectId(id)) }
        });

        if (!payrollRecords.length) {
            throw new Error('No payroll records found for the provided IDs.');
        }

        // Process each record
        for (const record of payrollRecords) {
            const currentStatus = record.status as PayrollStatus;

            // Block updates for Completed status
            if (currentStatus === PayrollStatus.Completed) {
                failedRecords.push({
                    id: record._id.toString(),
                    reason: 'Cannot modify payroll record with Completed status'
                });
                continue;
            }


            // Validate transition
            if (!this.canTransition(currentStatus, status)) {
                failedRecords.push({
                    id: record._id.toString(),
                    reason: `Invalid transition from ${currentStatus} to ${status}`
                });
                continue;
            }

            // Validate retry count for RetryPending
            if (status === PayrollStatus.RetryPending && (record.retryCount || 0) >= PayrollService.maxRetries) {
                failedRecords.push({
                    id: record._id.toString(),
                    reason: `Max retry attempts (${PayrollService.maxRetries}) reached`
                });
                continue;
            }

            // Prepare update payload
            const updatePayload: any = {
                status,
                statusHistory: [
                    ...(record.statusHistory || []),
                    {
                        status,
                        timestamp: new Date(),
                        reason: failureReason || `Status updated to ${status}`,
                        changedBy: new Types.ObjectId(userId)
                    }
                ]
            };

            // Handle specific status updates
            if (status === PayrollStatus.Failed) {
                updatePayload.failureReason = failureReason;
                updatePayload.retryCount = (record.retryCount || 0) + 1;
            } else if (status === PayrollStatus.Completed) {
                updatePayload.utrNumber = utrNumber;
                updatePayload.paymentConfirmedAt = new Date();
                updatePayload.failureReason = null;
                updatePayload.retryCount = 0;
            } else if (status === PayrollStatus.RetryPending) {
                updatePayload.failureReason = null;
            } else if (status === PayrollStatus.PendingApproval) {
                updatePayload.approvalDate = new Date();
                updatePayload.approvedBy = new Types.ObjectId(userId);
            }

            // Update record
            try {
                await Payroll.updateOne(
                    { _id: record._id },
                    { $set: updatePayload }
                );
                updatedCount++;
            } catch (error: any) {
                failedRecords.push({
                    id: record._id.toString(),
                    reason: `Failed to update: ${error.message}`
                });
            }
        }

        return {
            updatedCount,
            failedRecords
        };
    }

    async initiatePayroll(
        month: string,
        year: number,
        userIds: string[],
    ): Promise<IInitiatePayroll> {
        console.log('1 initiatePayroll', month, year, userIds);
        //1 Validate and normalize month
        const { monthName, monthNumber } = await this.validateMonth(month);
        console.log(monthName, monthNumber, 'month name number initiatePayroll');

        //2 Check if payroll already exists for the selected month, year, and userIds
        const existingPayroll = await Payroll.find({
            month: monthNumber,
            year,
            employeeId: userIds ? { $in: userIds } : { $exists: true },
            status: { $nin: ['Cancelled'] },
        }).lean();
        console.log(existingPayroll, 'existingPayroll initiatePayroll');
        // Skip users with existing payroll records
        const existingUserIds = existingPayroll.map((payroll) => payroll.employeeId.toString());
        const filteredUserIds = userIds?.filter((id) => !existingUserIds.includes(id)) || [];
        console.log(filteredUserIds, 'filteredUserIds initiatePayroll');
        // If no eligible users remain, throw an error
        if (userIds && filteredUserIds.length === 0) {
            throw new Error(`Payroll for ${monthName} ${year} already exists for all provided users`);
        }

        const firstDayOfMonth = new Date(`${year}-${monthNumber}-01`);
        const lastDayOfMonth = new Date(year, monthNumber, 0); // Last day of the month
        console.log(firstDayOfMonth, 'firstDayOfMonth initiatePayroll');
        console.log(lastDayOfMonth, 'lastDayOfMonth initiatePayroll');
        //3 Fetch data in parallel
        const [allEmployees, salaryAssignments] = await Promise.all([
            User.find({
                // active: true,
                _id: filteredUserIds.length ? { $in: filteredUserIds } : { $exists: true },
                joiningDate: { $lt: lastDayOfMonth }// Include employees who joined on or before the last day of the month
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
        console.log(salaryAssignments, '3 salaryAssignments initiatePayroll');
        console.log(allEmployees, '3 allEmployees initiatePayroll');
        // Validate employee-salary assignment consistency
        const employeeIds = allEmployees.map((emp) => emp._id.toString());
        const salaryAssignmentEmployeeIds = salaryAssignments.map((assignment) =>
            assignment.employeeId._id.toString()
        );
        const missingSalaryAssignments = employeeIds.filter(
            (id) => !salaryAssignmentEmployeeIds.includes(id)
        );

        if (missingSalaryAssignments.length > 0) {
            throw new Error(
                `Missing active salary assignments for employees with IDs: ${missingSalaryAssignments.join(', ')}`
            );
        }

        // 4. Map employees to their salary assignments
        const employeeSalaryMap = new Map(
            salaryAssignments.map((assignment) => [
                assignment.employeeId._id.toString(),
                assignment,
            ]),
        );
        console.log(employeeSalaryMap, '4 employeeSalaryMap initiatePayroll');

        //5. Process payroll records
        let payrollRecords = await this.processPayrollRecords(
            allEmployees,
            employeeSalaryMap,
            monthName,
            monthNumber,
            year,
        );
        console.log(payrollRecords, '5 payrollrecords initiatePayroll');
        if (!payrollRecords.length) {
            throw new Error('No eligible employees found for payroll processing');
        }
        payrollRecords = payrollRecords.map((record) => ({
            ...record,
            status: PayrollStatus.Draft,
        }));

        //6. Batch insert and calculate totals
        const [savedRecords, payrollSummary] = await Promise.all([
            Payroll.insertMany(payrollRecords),
            this.calculatePayrollSummary(payrollRecords)
        ]);
        console.log(savedRecords, "6 savedRecords initiatePayroll")
        //7. Calculate payrollsummary
        // const payrollSummary = this.calculatePayrollSummary(payrollRecords)
        // console.log(payrollSummary, '7 payrollSummar initiatePayroll');
        return {
            ...payrollSummary,
            totalActiveEmployees: allEmployees.length,
            status: PayrollStatus.Draft
        };
    }

    async batchUpdatePayrollStatus(params: {
        records: Array<{
            id: string;
            status: PayrollStatus;
            utrNumber?: string;
            failureReason?: string;
        }>;
        userId: string;
    }): Promise<{ updatedCount: number; failedRecords: Array<{ id: string; reason: string }> }> {
        const { records, userId } = params;

        let updatedCount = 0;
        const failedRecords: Array<{ id: string; reason: string }> = [];

        for (const record of records) {
            const { id, status, utrNumber, failureReason } = record;

            try {
                const payroll = await Payroll.findById(id);
                console.log(payroll, 'payroll batchUpdatePayrollStatus');
                if (!payroll) {
                    failedRecords.push({ id, reason: 'Record not found' });
                    continue;
                }

                if (!this.canTransition(payroll.status as PayrollStatus, status)) {
                    failedRecords.push({ id, reason: `Invalid transition from ${payroll.status} to ${status}` });
                    continue;
                }

                const updatePayload: any = {
                    status,
                    statusHistory: [
                        ...(payroll.statusHistory || []),
                        {
                            status,
                            timestamp: new Date(),
                            reason: failureReason || `Status updated to ${status}`,
                            changedBy: new Types.ObjectId(userId)
                        }
                    ]
                };
                console.log(updatePayload, "updatePayload batchUpdatePayrollStatus")
                if (status === PayrollStatus.Failed) {
                    if (!failureReason) {
                        failedRecords.push({ id, reason: 'Missing failure reason for Failed status' });
                        continue;
                    }
                    updatePayload.failureReason = failureReason;
                    updatePayload.retryCount = (payroll.retryCount || 0) + 1;
                }

                if (status === PayrollStatus.Completed) {
                    if (!utrNumber) {
                        failedRecords.push({ id, reason: 'Missing UTR number for Completed status' });
                        continue;
                    }
                    updatePayload.utrNumber = utrNumber;
                    updatePayload.paymentConfirmedAt = new Date();
                    // updatePayload.failureReason = null;
                    // updatePayload.retryCount = 0;
                }

                if (status === PayrollStatus.RetryPending) {
                    if ((payroll.retryCount || 0) >= PayrollService.maxRetries) {
                        failedRecords.push({ id, reason: `Max retry attempts (${PayrollService.maxRetries}) reached` });
                        continue;
                    }
                    updatePayload.failureReason = null;
                }

                console.log(updatePayload, "updatePayload")
                await Payroll.updateOne({ _id: id }, { $set: updatePayload });
                updatedCount++;

            } catch (error: any) {
                failedRecords.push({ id, reason: error.message });
            }
        }

        return { updatedCount, failedRecords };
    }


    //Processes payroll records for all employees in parallel.
    private async processPayrollRecords(
        employees: any[],
        salaryMap: Map<string, any>,
        monthName: string,
        monthNumber: number,
        year: number,
    ): Promise<PayrollRecord[]> {
        console.log(employees, salaryMap, monthName, monthNumber, year, '1 processPayrollRecords');
        const { daysInMonth } = this.getMonthBoundaries(year, monthNumber);
        console.log(daysInMonth, 'daysInMonth processPayrollRecords');
        const records = await Promise.all(
            employees.map(async (emp) => {
                console.log(emp, 'emp processPayrollRecords');
                const sa = salaryMap.get(emp._id.toString());
                console.log(sa, 'sa processPayrollRecords');
                if (!sa) return null;
                const [att, leaves, ot, workingDaysInfo] = await Promise.all([
                    this.getMonthlyAttendance(emp._id, monthName, year),
                    this.fetchApprovedLeaves(emp._id, year, monthNumber),
                    Overtime.findOne({ userId: emp._id, month: monthNumber, year }, 'hours').lean(),
                    this.getWorkingDaysInMonth(emp._id, year, monthNumber),
                ]);
                console.log(att, 'att processPayrollRecords', emp._id);
                console.log(leaves, 'leaves processPayrollRecords', emp._id);
                console.log(ot, 'ot processPayrollRecords', emp._id);
                console.log(workingDaysInfo, 'workingDaysInfo processPayrollRecords', emp._id);

                return this.calculatePayrollRecord(
                    emp,
                    sa,
                    att,
                    leaves,
                    ot?.hours || 0,
                    daysInMonth,
                    workingDaysInfo.workingDays,
                    monthName,
                    monthNumber,
                    year,
                );
            }),
        );
        console.log(records, '4 records processPayrollRecords');
        return records.filter((r): r is PayrollRecord => r !== null);
    }
    //Calculates a single payroll record for an employee.
    private async calculatePayrollRecord(
        employee: any,
        salaryAssignment: any,
        attendance: any,
        approvedLeaves: number,
        overtimeHours: number,
        daysInMonth: number,
        workingDays: number,
        monthName: string,
        monthNumber: number,
        year: number,
    ): Promise<PayrollRecord> {
        const employeeCountry = employee.country || 'IN';
        const countryRules = this.getCountryDeductionRules(employeeCountry);

        console.log(
            employee,
            salaryAssignment,
            attendance,
            approvedLeaves,
            overtimeHours,
            daysInMonth,
            workingDays,
            monthName,
            monthNumber,
            '1 calculatePayrollRecord',
        );
        console.log(`Processing payroll for ${employeeCountry} employee: ${employee.name} (${employee._id})`);
        console.log(`Country rules: ${countryRules.description}`);

        // Calculate Loss of Pay (LOP) days - days when employee was absent without approved leave
        const lopDays =
            daysInMonth -
            (attendance.presentDays + attendance.weekendDays + attendance.holidayDays + approvedLeaves);

        const monthlyGross = salaryAssignment.monthlyGross;
        const salaryStructure = salaryAssignment.salaryStructureId;
        // ✅ FIX: Cap payableDays at daysInMonth to prevent overpayment
        const payableDays = Math.min(
            daysInMonth,
            attendance.presentDays + attendance.weekendDays + attendance.holidayDays + approvedLeaves
        );
        const attendanceAdjustedGross = Math.round((payableDays / daysInMonth) * monthlyGross);

        console.log(monthlyGross, ' monthlyGross calculatePayrollRecord');
        console.log(salaryStructure, "salaryStructure calculatePayrollRecord");
        console.log(payableDays, 'payableDays calculatePayrollRecord');
        console.log(attendanceAdjustedGross, 'attendanceAdjustedGross calculatePayrollRecord');

        // ✅ UPDATED: Fixed allowances calculation based on country
        // UAE: Use fixed amounts from salary assignment (travel, air ticket, medical)
        // India: Use percentage from salary structure (backward compatible)
        const isUAE = employeeCountry === 'AE';

        const travelAllowanceFromAssignment = salaryAssignment.travelAllowance || 0;
        const airTicketAllowanceFromAssignment = salaryAssignment.airTicketAllowance || 0; // ✅ NEW
        const medicalAllowanceFromAssignment = salaryAssignment.medicalAllowance || 0; // ✅ NEW

        const travelAllowanceFromPercentage = Math.round(
            ((salaryStructure.fixedEarnings.travelAllowancePercentage ?? 0) / 100) * monthlyGross
        );

        // UAE uses fixed amounts, India uses percentage
        const travelAllowanceForAssigned = isUAE ? travelAllowanceFromAssignment : travelAllowanceFromPercentage;
        const airTicketAllowanceForAssigned = isUAE ? airTicketAllowanceFromAssignment : 0; // ✅ NEW: India doesn't use this
        const medicalAllowanceForAssigned = isUAE ? medicalAllowanceFromAssignment : 0; // ✅ NEW: India doesn't use this

        //actual Assign
        const assignedBasic = Math.round((salaryStructure.fixedEarnings.basicPercentage / 100) * monthlyGross);
        const assignedHra = Math.round((salaryStructure.fixedEarnings.hraPercentage / 100) * monthlyGross);
        const assignedDa = Math.round((salaryStructure.fixedEarnings.daPercentage / 100) * monthlyGross);

        // ✅ AUTO-CALCULATE Other Allowance for UAE
        // Other Allowance = Total Salary - (Basic + HRA + DA + Travel)
        // Note: Air Ticket & Medical are ANNUAL ONLY (not included in monthly)
        let assignedOtherAllowance: number;
        if (isUAE) {
            assignedOtherAllowance = Math.round(
                monthlyGross - (assignedBasic + assignedHra + assignedDa + travelAllowanceForAssigned)
            );
            // Validate that other allowance is not negative
            if (assignedOtherAllowance < 0) {
                throw new Error(`Invalid salary structure for employee ${employee.name}: Other Allowance would be negative (${assignedOtherAllowance}). Total of Basic + HRA + DA + Travel cannot exceed Monthly Gross.`);
            }
        } else {
            // India: Use percentage from structure (backward compatible)
            assignedOtherAllowance = Math.round(
                (salaryStructure.fixedEarnings.otherAllowancePercentage / 100) * monthlyGross,
            );
        }

        const assigned = {
            basic: assignedBasic,
            hra: assignedHra,
            da: assignedDa,
            otherAllowance: assignedOtherAllowance, // ✅ AUTO-CALCULATED for UAE
            travelAllowance: travelAllowanceForAssigned, // Country-specific: UAE=fixed, India=percentage
            airTicketAllowance: airTicketAllowanceForAssigned, // ✅ NEW: UAE only
            medicalAllowance: medicalAllowanceForAssigned, // ✅ NEW: UAE only
            reimbursementAllowance: Math.round(
                ((salaryStructure.fixedEarnings.reimbursementPercentage ?? 0) / 100) * monthlyGross,
            ),
        }

        // Earnings
        const basic = Math.round((salaryStructure.fixedEarnings.basicPercentage / 100) * attendanceAdjustedGross);
        const hra = Math.round((salaryStructure.fixedEarnings.hraPercentage / 100) * attendanceAdjustedGross);
        const da = Math.round((salaryStructure.fixedEarnings.daPercentage / 100) * basic);

        // ✅ COUNTRY-SPECIFIC: Fixed allowances calculation
        // UAE: Fixed amounts from assignment (PRORATED by attendance for monthly calculation)
        // India: Percentage from structure (prorated by attendance for consistency)
        const travelAllowanceFromPercentageProrated = Math.round(
            ((salaryStructure.fixedEarnings.travelAllowancePercentage ?? 0) / 100) * attendanceAdjustedGross
        );
        // ✅ FIX: Prorate UAE travel allowance by attendance to prevent negative other allowance
        const travelAllowance = isUAE
            ? Math.round((payableDays / daysInMonth) * travelAllowanceFromAssignment)
            : travelAllowanceFromPercentageProrated;
        const airTicketAllowance = isUAE ? airTicketAllowanceFromAssignment : 0; // ✅ Annual only, not in monthly
        const medicalAllowance = isUAE ? medicalAllowanceFromAssignment : 0; // ✅ Annual only, not in monthly

        // ✅ AUTO-CALCULATE Other Allowance for UAE (prorated by attendance)
        // Note: Air Ticket & Medical are ANNUAL ONLY (not included in monthly calculation)
        let otherAllowance: number;
        if (isUAE) {
            otherAllowance = Math.round(
                attendanceAdjustedGross - (basic + hra + da + travelAllowance)
            );
            // Validate that other allowance is not negative
            if (otherAllowance < 0) {
                throw new Error(`Invalid salary calculation for employee ${employee.name}: Other Allowance would be negative (${otherAllowance}). Check salary structure and allowances.`);
            }
        } else {
            // India: Use percentage from structure (backward compatible)
            otherAllowance = Math.round(
                (salaryStructure.fixedEarnings.otherAllowancePercentage / 100) * attendanceAdjustedGross,
            );
        }

        const reimbursementAllowance = Math.round(
            ((salaryStructure.fixedEarnings.reimbursementPercentage ?? 0) / 100) * attendanceAdjustedGross,
        );
        // ✅ UPDATED: Gross salary = Monthly components only (Air Ticket & Medical are annual only)
        const grossSalary = Math.round(basic + hra + da + otherAllowance + travelAllowance + reimbursementAllowance);

        console.log(basic, 'basic calculatePayrollRecord');
        console.log(hra, 'hra calculatePayrollRecord');
        console.log(otherAllowance, 'otherAllowance calculatePayrollRecord');
        console.log(da, 'da calculatePayrollRecord');
        console.log(grossSalary, 'grossSalary calculatePayrollRecord');

        const additionalDeduction = Math.round(
            ((salaryStructure.fixedEarnings.deductionPercentage ?? 0) / 100) * attendanceAdjustedGross,
        );

        // Deductions
        const resolvedDeductions = await this.calculateDeductions(
            basic,
            da,
            grossSalary,
            salaryStructure,
            attendance,
            approvedLeaves,
            monthName,
            monthNumber,
            year,
            employee._id,
            payableDays,
            daysInMonth,
            monthlyGross,
            employee.country || 'IN' // Pass employee's country, default to 'IN'
        );
        console.log(resolvedDeductions, 'resolvedDeductions calculatePayrollRecord');
        const totalDeductions = resolvedDeductions.totalDeductions + additionalDeduction;
        // Additional pay
        const overtimePay = Math.round(overtimeHours * (grossSalary / (workingDays * 8)));
        const totalOT = overtimePay;
        // ✅ UPDATED: Net Salary includes monthly components only (already attendance-adjusted)
        // Note: Air Ticket & Medical are ANNUAL ONLY (not included in monthly net salary)
        const netSalary = Math.round(
            attendanceAdjustedGross -
            resolvedDeductions.epfEmployee -
            resolvedDeductions.incomeTax -
            resolvedDeductions.professionalTax -
            additionalDeduction +
            totalOT
        );

        // ✅ COUNTRY-SPECIFIC CTC CALCULATION
        // UAE: CTC = (Monthly Salary × 12) + Air Ticket (annual) + Medical (annual) + Insurance (monthly × 12)
        // Note: Air Ticket & Medical are ANNUAL amounts, only added to CTC
        // India: CTC = Gross + Employer contributions (EPF, ESI) + overtime
        let ctc: number;
        if (isUAE) {
            // UAE: Annual CTC = Monthly components annualized + Annual allowances
            // Monthly components: Basic + HRA + Other + Travel
            const monthlyComponents = assignedBasic + assignedHra + assignedDa + assignedOtherAllowance + travelAllowanceForAssigned;

            ctc = Math.round(
                (monthlyComponents * 12) +              // Annualize monthly components
                airTicketAllowanceFromAssignment +      // ✅ Annual allowance (not multiplied)
                medicalAllowanceFromAssignment +        // ✅ Annual allowance (not multiplied)
                ((salaryAssignment.monthlyInsurance || 0) * 12) // Insurance annualized
            );
        } else {
            // India: Add employer contributions (travel allowance already in gross from structure percentage)
            ctc = Math.round(
                attendanceAdjustedGross +
                resolvedDeductions.epfEmployer +
                resolvedDeductions.esiEmployer +
                overtimePay
            );
        }

        return {
            employeeId: employee._id,
            salaryAssignmentId: salaryAssignment._id,
            monthlyGross,
            attendanceAdjustedGross,
            totalDaysInMonth: daysInMonth,
            payableDays,
            basic,
            hra,
            da,
            otherAllowance,
            travelAllowance,
            airTicketAllowance, // ✅ NEW: Air ticket allowance
            medicalAllowance, // ✅ NEW: Medical allowance
            reimbursementAllowance,
            epfEmployee: resolvedDeductions.epfEmployee,
            epfEmployer: resolvedDeductions.epfEmployer,
            esiEmployee: resolvedDeductions.esiEmployee,
            esiEmployer: resolvedDeductions.esiEmployer,
            professionalTax: resolvedDeductions.professionalTax,
            incomeTax: resolvedDeductions.incomeTax,
            totalDeductions,
            additionalDeduction,
            leaveDeductions: resolvedDeductions.leaveDeductions,
            overtimeHours,
            overtimePay,
            reimbursement: 0,
            bonus: 0,
            netSalary,
            ctc,
            monthYear: `${year}-${String(monthNumber).padStart(2, '0')}`,
            month: monthNumber,
            year,
            processedAt: new Date(),
            status: PayrollStatus.Draft,
            // Add new required fields
            presentDays: attendance.presentDays || 0,
            LOPDays: lopDays > 0 ? lopDays : 0,
            country: employee.country || 'IN', // Default to 'IN' if not specified
            assigned
        };
    }
    //Calculates all deductions for a payroll record.

    private async calculateDeductions(
        basic: number,
        da: number,
        grossSalary: number,
        salaryStructure: any,
        attendance: any,
        approvedLeaves: number,
        monthName: string,
        monthNumber: number,
        year: number,
        employeeId: Types.ObjectId,
        payableDays: number,//total payable days in month exclude the absents
        daysInMonth: number,//total days in month
        monthlyGross: number, //monthly gross salary
        employeeCountry: string = 'IN' // Default to India for backward compatibility
    ) {
        console.log(salaryStructure, approvedLeaves, 'calculateDeductions');
        console.log(`Processing deductions for employee country: ${employeeCountry}`);

        // Handle UAE employees - no statutory deductions
        if (employeeCountry === 'AE') {
            console.log('UAE employee detected - applying zero statutory deductions');

            // Calculate non-payable (deductible) days
            const unpaidLeaveDays = Math.max(daysInMonth - payableDays, 0);
            const unpaidLeaveRatio = unpaidLeaveDays / daysInMonth;
            const leaveDeductionAmount = Math.round(unpaidLeaveDays > 0 ? unpaidLeaveRatio * monthlyGross : 0);

            console.log(`UAE deductions - Leave deduction: ${leaveDeductionAmount}, Total deductions: ${leaveDeductionAmount}`);

            return {
                epfEmployee: 0,
                epfEmployer: 0,
                esiEmployee: 0,
                esiEmployer: 0,
                professionalTax: 0,
                incomeTax: 0, // Will be 0 if no tax declaration exists
                totalDeductions: leaveDeductionAmount,
                leaveDeductions: leaveDeductionAmount,
            };
        }

        // India employee calculations (existing logic)
        console.log('India employee detected - applying statutory deductions');

        // Validate salary structure for country-specific requirements
        this.validateSalaryStructureForCountry(salaryStructure, employeeCountry, employeeId);

        // EPF - Corrected calculation
        // When Basic >= ₹15,000, cap EPF at 12% of ₹15,000 = ₹1,800 (not 15000/12 = ₹1,250)
        const epfEmployee =
            (salaryStructure.statutoryDeductions.epf.employeeContribution / 100) * (basic + da);
        const epfEmployer =
            (salaryStructure.statutoryDeductions.epf.employerContribution / 100) * (basic + da);

        // Calculate max EPF contribution (12% of ₹15,000 ceiling)
        const maxEpfContribution =
            (salaryStructure.statutoryDeductions.epf.employeeContribution / 100) *
            salaryStructure.statutoryDeductions.epf.maxLimit;

        // Apply ceiling if basic >= maxLimit
        const finalEpfEmployee = Math.round(
            basic >= salaryStructure.statutoryDeductions.epf.maxLimit
                ? maxEpfContribution  // 12% × ₹15,000 = ₹1,800
                : epfEmployee
        );

        // Employer contribution should also be capped (EPF compliance)
        const finalEpfEmployer = Math.round(
            basic >= salaryStructure.statutoryDeductions.epf.maxLimit
                ? maxEpfContribution  // 12% × ₹15,000 = ₹1,800
                : epfEmployer
        );

        /*
            CORRECTED EPF CALCULATION:
            Example: Basic = ₹18,030
            - epfEmployee = (12/100) * 18030 = ₹2,163.60
            - maxEpfContribution = (12/100) * 15000 = ₹1,800
            - Since 18030 >= 15000: finalEpfEmployee = ₹1,800 ✓
            
            Example: Basic = ₹8,000
            - epfEmployee = (12/100) * 8000 = ₹960
            - Since 8000 < 15000: finalEpfEmployee = ₹960 ✓
        */
        console.log(epfEmployee, 'epfEmployee');
        console.log(epfEmployer, 'epfEmployer');
        console.log(maxEpfContribution, 'maxEpfContribution');
        console.log(finalEpfEmployee, 'finalEpfEmployee');
        console.log(finalEpfEmployer, 'finalEpfEmployer');

        // ESI
        const esiLimit = salaryStructure.statutoryDeductions.esi.applicabilityLimit;
        const esiEmployee = Math.round(
            grossSalary <= esiLimit
                ? (salaryStructure.statutoryDeductions.esi.employeeContribution / 100) * grossSalary
                : 0);
        const esiEmployer = Math.round(
            grossSalary <= esiLimit
                ? (salaryStructure.statutoryDeductions.esi.employerContribution / 100) * grossSalary
                : 0);
        console.log(esiLimit, 'esiLimit');
        console.log(esiEmployee, 'esiEmployee');
        console.log(esiEmployer, 'esoEmployer');
        // Professional Tax
        const professionalTax = Math.round(this.calculateProfessionalTax(
            monthlyGross,
            salaryStructure.statutoryDeductions.professionalTax,
            monthNumber,
        ));
        console.log(professionalTax, 'professionalTax');
        // Income Tax
        const incomeTax = Math.round(await this.calculateIncomeTax(employeeId, monthName, monthNumber, year));
        console.log(incomeTax, 'incomeTaxfinal');
        console.log('employeeIdemployeeId', employeeId);
        // Leave Deductions
        const { absentDays } = attendance;
        console.log(absentDays, 'absentDays', "", attendance, 'attendance');

        // const leaveDeductions =
        //     absentDays > approvedLeaves ? ((absentDays - approvedLeaves) / workingDays) * grossSalary : 0;


        // Calculate non-payable (deductible) days
        const unpaidLeaveDays = Math.max(daysInMonth - payableDays, 0);
        console.log(unpaidLeaveDays, 'unpaidLeaveDays', daysInMonth, 'daysInMonth', payableDays, 'payableDays');

        // Fraction of the month that is unpaid
        const unpaidLeaveRatio = unpaidLeaveDays / daysInMonth;

        // Compute leave deduction amount from gross salary
        const leaveDeductionAmount = Math.round(unpaidLeaveDays > 0 ? unpaidLeaveRatio * monthlyGross : 0);
        console.log(leaveDeductionAmount, 'leaveDeductionAmount');

        const totalDeductions = Math.round(finalEpfEmployee + professionalTax + incomeTax + leaveDeductionAmount);
        // const totalDeductions =
        // finalEpfEmployee + esiEmployee + professionalTax + incomeTax + leaveDeductionAmount;
        console.log(totalDeductions, 'totalDeductionsfinal');

        return {
            epfEmployee: finalEpfEmployee,
            epfEmployer: finalEpfEmployer,
            esiEmployee,
            esiEmployer,
            professionalTax,
            incomeTax,
            totalDeductions,
            leaveDeductions: leaveDeductionAmount,
        };
    }
    //Calculates professional tax based on salary slabs and term.
    private calculateProfessionalTax(
        grossSalary: number,
        ptConfig: any,
        monthNumber: number,
    ): number {
        const { term, slabs }: { term: keyof typeof applicableMonths; slabs: any[] } = ptConfig;

        if (!slabs?.length) return 0;

        const applicableMonths = {
            half_yearly: [2, 8],
            yearly: [4],
            monthly: Array.from({ length: 12 }, (_, i) => i + 1),
        };

        if (!applicableMonths[term]?.includes(monthNumber)) {
            return 0;
        }

        for (const slab of slabs) {
            if (grossSalary >= slab.fromAmount && (!slab.toAmount || grossSalary <= slab.toAmount)) {
                return slab.taxAmount;
            }
        }
        return 0;
    }
    //Calculates income tax deduction for the month and updates tax declaration.
    private async calculateIncomeTax(
        employeeId: Types.ObjectId,
        monthName: string,
        monthNumber: number,
        year: number,
    ): Promise<number> {
        const financialYear = monthNumber <= 3 ? `${year - 1}-${year}` : `${year}-${year + 1}`;
        const monthShortName = MONTH_SHORT_NAMES[monthName] || monthName;
        console.log('calculateIncomeTax', employeeId, financialYear, monthShortName);
        const taxDeclaration = await TaxDeclaration.findOne({
            employeeId,
            financialYear,
        }).lean();
        console.log(taxDeclaration, 'taxDeclaration calculateIncomeTax');
        if (!taxDeclaration) return 0;

        const monthlyDeduction = taxDeclaration.monthlyDeductions?.find(
            (md) => md.month === monthShortName && md.financialYear === financialYear && !md.isProcessed,
        );
        console.log(monthlyDeduction, 'monthlyDeduction calculateIncomeTax');
        if (!monthlyDeduction) return 0;

        const incomeTax = monthlyDeduction.plannedDeduction;

        await TaxDeclaration.updateOne(
            {
                _id: taxDeclaration._id,
                'monthlyDeductions.month': monthName,
                'monthlyDeductions.financialYear': financialYear,
            },
            {
                $set: {
                    'monthlyDeductions.$.isProcessed': true,
                    'monthlyDeductions.$.actualDeduction': incomeTax,
                    'monthlyDeductions.$.processedDate': new Date(),
                },
            },
        );

        return incomeTax;
    }
    //Calculates summary statistics for processed payroll records.
    private calculatePayrollSummary(payrollRecords: PayrollRecord[]) {
        return {
            totalRecords: payrollRecords.length,
            totalEmployees: payrollRecords.length,
            totalGrossSalary: Math.round(payrollRecords.reduce(
                (sum, record) => sum + record.attendanceAdjustedGross,
                0,
            )),
            totalNetSalary: Math.round(payrollRecords.reduce((sum, record) => sum + record.netSalary, 0)),
            totalDeductions: Math.round(payrollRecords.reduce((sum, record) => sum + record.totalDeductions, 0)),
            totalPresentDays: payrollRecords.reduce((sum, record) => sum + record.presentDays, 0),
            totalLOPDays: payrollRecords.reduce((sum, record) => sum + record.LOPDays, 0),
            totalPayableDays: payrollRecords.reduce((sum, record) => sum + record.payableDays, 0),
            status: PayrollStatus.Draft,
        };
    }
    //Validates and normalizes month input to name and number format.
    private async validateMonth(month: string): Promise<{ monthName: string; monthNumber: number }> {
        const monthNumber = parseInt(month);
        if (!isNaN(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
            return {
                monthName: MONTH_NAMES[monthNumber - 1],
                monthNumber,
            };
        }

        if (MONTH_NAMES.includes(month as any)) {
            return {
                monthName: month,
                monthNumber: MONTH_NAMES.indexOf(month as any) + 1,
            };
        }

        throw new Error('Invalid month provided');
    }

    // Counts approved leaves for an employee within a month.
    // Includes annual_leave, compOff, and restricted_holiday (optional holidays taken as leave)
    // NOTE: restricted_holiday is included here because optional holidays are paid leaves when taken
    private async fetchApprovedLeaves(employeeId: Types.ObjectId, year: number, monthNumber: number) {
        const { firstDay, lastDay } = this.getMonthBoundaries(year, monthNumber);
        console.log(firstDay, lastDay, 'firstDay, lastDay fetchApprovedLeaves');
        // Fetch approved ANNUAL LEAVES, COMP-OFF LEAVES, and RESTRICTED HOLIDAY LEAVES (optional holidays)
        // ✅ FIX: Include restricted_holiday in approvedLeaves to match business requirement
        // Optional holidays taken as leave should be paid, so they're included in approvedLeaves
        const leaves = await Leave.find({
            userId: employeeId,  // Use userId field from Leave model
            status: 'Approved',
            leaveType: { $in: ['annual', 'compOff', 'restricted_holiday'] }, // Annual leave + Comp-off + Optional holidays
            $or: [
                { startDate: { $gte: firstDay, $lte: lastDay } },
                { endDate: { $gte: firstDay, $lte: lastDay } },
            ],
        }).select('noOfDays leaveType').lean();
        console.log(leaves, 'leaves fetchApprovedLeaves');
        // Sum all noOfDays to get total leave days (supports decimals for half-day leaves)
        const totalLeaveDays = leaves.reduce((sum, leave) => sum + (leave.noOfDays || 0), 0);
        console.log(totalLeaveDays, `fetchApprovedLeaves - Total: ${totalLeaveDays} days from ${leaves.length} leaves (annual_leave + compOff + restricted_holiday)`);
        return totalLeaveDays;
    }

    // Retrieves attendance summary for an employee for a specific month.
    private async getMonthlyAttendance(employeeId: Types.ObjectId, monthName: string, year: number) {
        console.log('getMonthlyAttendance', employeeId, monthName, year);

        const monthNumber = parseInt(this.getMonthNumber(monthName));
        console.log(monthNumber, 'monthNumber');
        const { firstDay, lastDay, daysInMonth } = this.getMonthBoundaries(year, monthNumber);
        console.log(monthNumber, firstDay, lastDay, daysInMonth, '1 getMonthlyAttendance');

        // Get employee's weekend days first (needed to filter out weekend attendance)
        const { workingDays, weekendDays: weekendDaysCount, holidayDays } = await this.getWorkingDaysInMonth(
            employeeId,
            year,
            monthNumber,
        );
        console.log("getWorkingDaysInMonth before attendance", workingDays, weekendDaysCount, holidayDays);

        // Fetch shift assignment to get weekend day numbers (0=Sunday, 6=Saturday)
        const shiftAssignments = await ShiftAssignment.find(
            {
                userId: employeeId,
                $or: [
                    { endDate: { $exists: false }, startDate: { $lte: lastDay } },
                    { endDate: { $gte: firstDay }, startDate: { $lte: lastDay } },
                ],
            },
            'weekendDays',
        ).lean();

        const weekendDaysSet = new Set<number>();
        if (shiftAssignments.length === 0) {
            weekendDaysSet.add(0); // Default to Sunday
        } else {
            shiftAssignments.forEach((shift) => {
                (shift.weekendDays || []).forEach((day: number) => weekendDaysSet.add(day));
            });
        }
        const weekendDayNumbers = Array.from(weekendDaysSet);
        console.log('Weekend day numbers:', weekendDayNumbers);

        // Fetch attendance records including regularized ones
        // const attendanceRecords = await AttendanceRecord.aggregate([
        //     {
        //         $match: {
        //             userId: employeeId,
        //             shiftDay: {
        //                 $gte: firstDay,
        //                 $lte: lastDay,
        //             },
        //         },
        //     },
        //     {
        //         $addFields: {
        //             // Check if shiftDay falls on a weekend
        //             isWeekendDay: {
        //                 $in: [{ $dayOfWeek: '$shiftDay' }, weekendDayNumbers.map(d => d + 1)] // MongoDB dayOfWeek is 1-indexed (1=Sunday)
        //             },
        //             // Parse actualWorkHours (HH:mm:ss) into decimal hours
        //             actualWorkHoursNumeric: {
        //                 $cond: {
        //                     if: { $or: [{ $eq: ['$actualWorkHours', null] }, { $eq: ['$actualWorkHours', ''] }] },
        //                     then: 0,
        //                     else: {
        //                         $let: {
        //                             vars: {
        //                                 timeParts: { $split: ['$actualWorkHours', ':'] },
        //                             },
        //                             in: {
        //                                 $add: [
        //                                     { $toDouble: { $arrayElemAt: ['$$timeParts', 0] } }, // Hours
        //                                     {
        //                                         $divide: [
        //                                             { $toDouble: { $arrayElemAt: ['$$timeParts', 1] } }, // Minutes
        //                                             60,
        //                                         ],
        //                                     },
        //                                     {
        //                                         $divide: [
        //                                             { $toDouble: { $arrayElemAt: ['$$timeParts', 2] } }, // Seconds
        //                                             3600,
        //                                         ],
        //                                     },
        //                                 ],
        //                             },
        //                         },
        //                     },
        //                 },
        //             },
        //             // Parse excessHours (HH:mm:ss) into decimal hours
        //             excessHoursNumeric: {
        //                 $cond: {
        //                     if: { $or: [{ $eq: ['$excessHours', null] }, { $eq: ['$excessHours', ''] }] },
        //                     then: 0,
        //                     else: {
        //                         $let: {
        //                             vars: {
        //                                 timeParts: { $split: ['$excessHours', ':'] },
        //                             },
        //                             in: {
        //                                 $add: [
        //                                     { $toDouble: { $arrayElemAt: ['$$timeParts', 0] } }, // Hours
        //                                     {
        //                                         $divide: [
        //                                             { $toDouble: { $arrayElemAt: ['$$timeParts', 1] } }, // Minutes
        //                                             60,
        //                                         ],
        //                                     },
        //                                     {
        //                                         $divide: [
        //                                             { $toDouble: { $arrayElemAt: ['$$timeParts', 2] } }, // Seconds
        //                                             3600,
        //                                         ],
        //                                     },
        //                                 ],
        //                             },
        //                         },
        //                     },
        //                 },
        //             },
        //             isOutOfWindowPresent: {
        //                 $cond: [
        //                     {
        //                         $and: [
        //                             { $in: ['Out-Of-Window', '$attendanceStatus'] },
        //                             { $eq: ['$regularization.isRegularized', true] },
        //                             { $eq: ['$regularization.status', 'Approved'] },
        //                         ],
        //                     },
        //                     1,
        //                     0,
        //                 ],
        //             },
        //             isAbsent: {
        //                 $cond: [
        //                     {
        //                         $or: [
        //                             { $in: ['Absent', '$attendanceStatus'] },
        //                             {
        //                                 $and: [
        //                                     { $in: ['Out-Of-Window', '$attendanceStatus'] },
        //                                     {
        //                                         $not: {
        //                                             $and: [
        //                                                 { $eq: ['$regularization.isRegularized', true] },
        //                                                 { $eq: ['$regularization.status', 'Approved'] },
        //                                             ],
        //                                         },
        //                                     },
        //                                 ],
        //                             },
        //                         ],
        //                     },
        //                     1,
        //                     0,
        //                 ],
        //             },
        //             isOnLeave: {
        //                 $cond: [
        //                     {
        //                         $or: [
        //                             { $in: ['On-Leave', '$attendanceStatus'] },
        //                             {
        //                                 $and: [
        //                                     { $in: ['Override', '$attendanceStatus'] },
        //                                     { $in: ['On-Leave', '$attendanceStatus'] }
        //                                 ]
        //                             }
        //                         ]
        //                     },
        //                     1,
        //                     0
        //                 ],
        //             },
        //             // UPDATED: Only count as present if NOT a weekend day
        //             isPresent: {
        //                 $cond: [
        //                     {
        //                         $and: [
        //                             { $eq: ['$isWeekendDay', false] }, // ← SKIP WEEKENDS!
        //                             {
        //                                 $or: [
        //                                     { $in: ['Late', '$attendanceStatus'] },
        //                                     { $in: ['On-Time', '$attendanceStatus'] },
        //                                     { $in: ['Early-Exit', '$attendanceStatus'] },
        //                                     { $in: ['Present', '$attendanceStatus'] },
        //                                     {
        //                                         $and: [
        //                                             { $in: ['Override', '$attendanceStatus'] },
        //                                             { $in: ['Present', '$attendanceStatus'] },
        //                                         ],
        //                                     },
        //                                     {
        //                                         $and: [
        //                                             { $in: ['Out-Of-Window', '$attendanceStatus'] },
        //                                             { $eq: ['$regularization.isRegularized', true] },
        //                                             { $eq: ['$regularization.status', 'Approved'] },
        //                                         ],
        //                                     },
        //                                 ],
        //                             },
        //                         ],
        //                     },
        //                     1,
        //                     0,
        //                 ],
        //             },
        //             isLate: {
        //                 $cond: [
        //                     {
        //                         $and: [
        //                             { $eq: ['$isWeekendDay', false] },
        //                             { $in: ['Late', '$attendanceStatus'] }
        //                         ]
        //                     },
        //                     1,
        //                     0
        //                 ]
        //             },
        //             isEarlyExit: {
        //                 $cond: [
        //                     {
        //                         $and: [
        //                             { $eq: ['$isWeekendDay', false] },
        //                             { $in: ['Early-Exit', '$attendanceStatus'] }
        //                         ]
        //                     },
        //                     1,
        //                     0
        //                 ]
        //             },
        //         },
        //     },
        //     {
        //         $group: {
        //             _id: null,
        //             totalDays: { $sum: 1 },
        //             presentDays: { $sum: '$isPresent' },
        //             lateDays: { $sum: '$isLate' },
        //             earlyExitDays: { $sum: '$isEarlyExit' },
        //             absentDays: { $sum: '$isAbsent' },
        //             leaveDays: { $sum: '$isOnLeave' },
        //             weekendWorkDays: {
        //                 $sum: {
        //                     $cond: [
        //                         {
        //                             $and: [
        //                                 { $eq: ['$isWeekendDay', true] },
        //                                 {
        //                                     $or: [
        //                                         { $in: ['Late', '$attendanceStatus'] },
        //                                         { $in: ['On-Time', '$attendanceStatus'] },
        //                                         { $in: ['Early-Exit', '$attendanceStatus'] },
        //                                         { $in: ['Present', '$attendanceStatus'] },
        //                                     ]
        //                                 }
        //                             ]
        //                         },
        //                         1,
        //                         0
        //                     ]
        //                 }
        //             },
        //             totalWorkHours: { $sum: '$actualWorkHoursNumeric' },
        //             excessHours: { $sum: '$excessHoursNumeric' },
        //         },
        //     },
        // ]);
        // Fetch attendance records including regularized ones
        const rawRecords = await AttendanceRecord.find({
            userId: employeeId,
            shiftDay: {
                $gte: firstDay,
                $lte: lastDay,
            },
        }).select('shiftDay attendanceStatus status').lean();

        console.log('🔍 RAW ATTENDANCE RECORDS:', JSON.stringify(rawRecords, null, 2));
        console.log('🔍 Total raw records found:', rawRecords.length);
        const attendanceRecords = await AttendanceRecord.aggregate([
            // 1️⃣ Match employee & date range
            {
                $match: {
                    userId: employeeId,
                    shiftDay: {
                        $gte: firstDay,
                        $lte: lastDay,
                    },
                },
            },

            // 2️⃣ Detect weekend (SAFE: separate stage)
            {
                $addFields: {
                    isWeekendDay: {
                        $in: [
                            { $dayOfWeek: '$shiftDay' },
                            weekendDayNumbers.map(d => (d === 0 ? 1 : d + 1)) // JS → Mongo mapping
                        ],
                    },
                },
            },

            // 3️⃣ Convert time strings → decimal hours
            {
                $addFields: {
                    actualWorkHoursNumeric: {
                        $cond: {
                            if: { $or: [{ $eq: ['$actualWorkHours', null] }, { $eq: ['$actualWorkHours', ''] }] },
                            then: 0,
                            else: {
                                $let: {
                                    vars: { time: { $split: ['$actualWorkHours', ':'] } },
                                    in: {
                                        $add: [
                                            { $toDouble: { $arrayElemAt: ['$$time', 0] } },
                                            { $divide: [{ $toDouble: { $arrayElemAt: ['$$time', 1] } }, 60] },
                                            { $divide: [{ $toDouble: { $arrayElemAt: ['$$time', 2] } }, 3600] },
                                        ],
                                    },
                                },
                            },
                        },
                    },

                    excessHoursNumeric: {
                        $cond: {
                            if: { $or: [{ $eq: ['$excessHours', null] }, { $eq: ['$excessHours', ''] }] },
                            then: 0,
                            else: {
                                $let: {
                                    vars: { time: { $split: ['$excessHours', ':'] } },
                                    in: {
                                        $add: [
                                            { $toDouble: { $arrayElemAt: ['$$time', 0] } },
                                            { $divide: [{ $toDouble: { $arrayElemAt: ['$$time', 1] } }, 60] },
                                            { $divide: [{ $toDouble: { $arrayElemAt: ['$$time', 2] } }, 3600] },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },

            // 4️⃣ Attendance flags (SAFE: uses isWeekendDay)
            {
                $addFields: {
                    isPresent: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$isWeekendDay', false] },
                                    {
                                        $or: [
                                            { $in: ['Present', '$attendanceStatus'] },
                                            { $in: ['Late', '$attendanceStatus'] },
                                            { $in: ['On-Time', '$attendanceStatus'] },
                                            { $in: ['Early-Exit', '$attendanceStatus'] },
                                            {
                                                $and: [
                                                    { $in: ['Override', '$attendanceStatus'] },
                                                    { $in: ['Present', '$attendanceStatus'] },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // ✅ FIX: Check if half-day leave - if halfType exists AND has 'On-Leave', count as 0.5 instead of 1
                            {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$halfType', null] },
                                            { $ne: ['$halfType', ''] },
                                            { $in: ['On-Leave', '$attendanceStatus'] },
                                        ],
                                    },
                                    0.5,  // Half-day present (employee worked half-day, took leave for other half)
                                    1,    // Full day present
                                ],
                            },
                            0,
                        ],
                    },

                    isLate: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$isWeekendDay', false] },
                                    { $in: ['Late', '$attendanceStatus'] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },

                    isEarlyExit: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$isWeekendDay', false] },
                                    { $in: ['Early-Exit', '$attendanceStatus'] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },

                    isOnLeave: {
                        $cond: [{ $in: ['On-Leave', '$attendanceStatus'] }, 1, 0],
                    },

                    isAbsent: {
                        $cond: [
                            {
                                $or: [
                                    { $in: ['Absent', '$attendanceStatus'] },
                                    {
                                        $and: [
                                            { $in: ['Out-Of-Window', '$attendanceStatus'] },
                                            {
                                                $not: {
                                                    $and: [
                                                        { $eq: ['$regularization.isRegularized', true] },
                                                        { $eq: ['$regularization.status', 'Approved'] },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },

            // 5️⃣ Final aggregation
            {
                $group: {
                    _id: null,
                    totalDays: { $sum: 1 },
                    presentDays: { $sum: '$isPresent' },
                    lateDays: { $sum: '$isLate' },
                    earlyExitDays: { $sum: '$isEarlyExit' },
                    absentDays: { $sum: '$isAbsent' },
                    leaveDays: { $sum: '$isOnLeave' },

                    weekendWorkDays: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$isWeekendDay', true] },
                                        { $in: ['Present', '$attendanceStatus'] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },

                    totalWorkHours: { $sum: '$actualWorkHoursNumeric' },
                    excessHours: { $sum: '$excessHoursNumeric' },
                },
            },
        ]);
        console.log('****************');
        console.log(attendanceRecords, 'attendanceRecords');
        console.log('****************');
        const result = attendanceRecords[0] || {};
        // Calculate absentDays as totalDaysInMonth - (presentDays + holidayDays + weekendDays)
        // NOTE: presentDays ALREADY includes lateDays, earlyExitDays, and onTime days.
        const calculatedAbsentDays = Math.max(
            0,
            daysInMonth - (
                (result.presentDays || 0) +
                holidayDays +
                weekendDaysCount
            )
        );
        let response = {
            presentDays: result.presentDays || 0,
            absentDays: calculatedAbsentDays,
            lateDays: result.lateDays || 0,
            leaveDays: result.leaveDays || 0,
            weekendWorkDays: result.weekendWorkDays || 0, // New field to track weekend work
            totalWorkHours: result.totalWorkHours || 0,
            excessHours: result.excessHours || 0,
            weekendDays: weekendDaysCount || 0,
            holidayDays: holidayDays || 0,
        };
        console.log(response, 'response getMonthlyAttendance (weekend attendance excluded from presentDays)');
        return response
    }
    // Converts month name or number to two-digit string format.
    private getMonthNumber(month: string): string {
        const months: { [key: string]: string } = {
            January: '01',
            February: '02',
            March: '03',
            April: '04',
            May: '05',
            June: '06',
            July: '07',
            August: '08',
            September: '09',
            October: '10',
            November: '11',
            December: '12',
        };

        // If month is already a number (as string)
        if (/^\d+$/.test(month)) {
            const num = parseInt(month);
            return num < 10 ? `0${num}` : `${num}`;
        }

        return months[month] || '01';
    }

    //Gets the first day, last day, and total days of a month.
    private getMonthBoundaries(year: number, monthNumber: number) {
        // Create date for first day of month
        const firstDay = new Date(year, monthNumber - 1, 1);

        // Create date for last day of month
        const lastDay = new Date(year, monthNumber, 0);

        return {
            firstDay,
            lastDay,
            daysInMonth: lastDay.getDate(),
        };
    }

    // Calculates working days, weekend days, and holiday days in a month.
    private async getWorkingDaysInMonth(
        employeeId: Types.ObjectId,
        year: number,
        monthNumber: number,
    ) {
        const { firstDay, lastDay, daysInMonth } = this.getMonthBoundaries(year, monthNumber);
        console.log(firstDay, lastDay, daysInMonth, 'getWorkingDaysInMonth');
        let weekendDaysCount = 0,
            holidayDays = 0;

        // ✅ FIX: Fetch the user's holiday calendar for the specific year
        // Query holidayCalendarHistory for year-specific calendar
        const user = await User.findById(employeeId).select('holidayCalendarHistory').lean();
        let holidayCalendar = null;

        if (user?.holidayCalendarHistory && user.holidayCalendarHistory.length > 0) {
            // Find the active calendar for the specified year
            const historyEntry = user.holidayCalendarHistory.find(
                (entry: any) => entry.year === year && entry.isActive === true
            );

            if (historyEntry) {
                // Fetch the calendar details for this year
                holidayCalendar = await HolidayCalendar.findById(historyEntry.calendarId)
                    .select('holidays')
                    .lean();
            }
        }

        if (holidayCalendar) {
            const holidays = holidayCalendar.holidays || [];
            console.log(holidays, 'holidaysholidays');

            // Separate mandatory and optional holidays
            const mandatoryHolidays = holidays.filter((h: any) => {
                const holidayDate = new Date(h.date);
                return holidayDate.getFullYear() === year &&
                    holidayDate.getMonth() === monthNumber - 1 &&
                    h.type === 'mandatory';
            });

            // Count mandatory holidays
            const mandatoryHolidayCount = mandatoryHolidays.length;

            // ✅ FIX: Exclude approved restricted_holiday leaves from holidayDays
            // Restricted holidays (optional holidays) taken as leave are now counted in approvedLeaves
            // Only mandatory holidays are counted in holidayDays to prevent double-counting
            // Total holiday days = mandatory holidays only (approved restricted holidays are in approvedLeaves)
            holidayDays = mandatoryHolidayCount;

            console.log(`Holiday breakdown: ${mandatoryHolidayCount} mandatory holidays (approved restricted holidays counted in approvedLeaves)`);
        }

        console.log(holidayDays, 'holidayDays after holidayCalendarId');
        // Fetch shift assignments overlapping the target month
        const shiftAssignments = await ShiftAssignment.find(
            {
                userId: employeeId,
                $or: [
                    { endDate: { $exists: false }, startDate: { $lte: lastDay } },
                    { endDate: { $gte: firstDay }, startDate: { $lte: lastDay } },
                ],
            },
            'startDate endDate weekendDays',
        ).lean();
        console.log(shiftAssignments, "shiftAssignments getWorkingDaysInMonth");
        // Merge weekend days from applicable shift assignments
        const weekendDaysSet = new Set<number>();
        if (shiftAssignments.length === 0) {
            weekendDaysSet.add(0); // Default to Sunday
        } else {
            shiftAssignments.forEach((shift) => {
                const start = new Date(shift.startDate);
                const end = shift.endDate ? new Date(shift.endDate) : lastDay;
                // Only include weekend days if the shift overlaps the month
                if (start <= lastDay && end >= firstDay) {
                    (shift.weekendDays || []).forEach((day: number) => weekendDaysSet.add(day));
                }
            });
        }
        const weekendDays = Array.from(weekendDaysSet);
        console.log(weekendDays, 'weekendDays after shiftAssignments');

        // Calculate weekend days and working days
        // ✅ FIX: Use the holidayCalendar object fetched earlier (with year parameter)
        const holidayDates = holidayCalendar
            ? (holidayCalendar.holidays || []).map(
                (h: any) => new Date(h.date).toISOString().split('T')[0],
            )
            : [];

        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(year, monthNumber - 1, i);
            const dateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            if (holidayDates.includes(dateStr)) continue; // Skip holidays
            if (weekendDays.includes(d.getDay())) weekendDaysCount++;
        }
        const workingDays = daysInMonth - (weekendDaysCount + holidayDays);
        console.log('final workingdays', { workingDays, weekendDays: weekendDaysCount, holidayDays });
        return { workingDays, weekendDays: weekendDaysCount, holidayDays };
    }



}

// export const payrollService = new PayrollService();
/*
   async processPayrollStatus(
       month: number,
       year: number,
       status: 'Processing' | 'Cancelled' | 'Pending Approval',
   ) {
       if (!month || !year) {
           throw new Error('Month and Year are required');
       }
 
       // Fetch all payroll records for the given month and year
       const payrollRecords = await Payroll.find({
           month,
           year,
           status: { $nin: ['Cancelled'] },
       });
       console.log(payrollRecords, 'payrollRecords');
       if (!payrollRecords.length) {
           throw new Error('No payroll records found for the given month and year');
       }
 
       // Delegate to specific method based on status
       if (status === 'Pending Approval') {
           return this.updatePayrollStatusToPending(month, year, payrollRecords);
       } else if (status === 'Processing') {
           return this.updatePayrollStatusToProcess(month, year, payrollRecords);
       } else {
           // 'Cancelled'
           return this.updatePayrollStatusToCancelled(month, year, payrollRecords);
       }
   }
 
   async updatePayrollStatusToPending(month: number, year: number, payrollRecords: IPayroll[]) {
       // Validate status transition
       const statusValidation = PayrollStatusManager.validateStatusUpdate(
           payrollRecords.map((record) => record.toObject() as PayrollRecord),
           PayrollStatus.PendingApproval,
       );
       console.log(statusValidation, 'statusValidation');
       if (!statusValidation.isValid) {
           throw new Error(statusValidation.message);
       }
 
       // Update the status to "Pending Approval"
       const updatedPayroll = await Payroll.updateMany(
           { month, year },
           { $set: { status: PayrollStatus.PendingApproval } }, // Fixed to PendingApproval
       );
 
       // Get overall status
       const allStatuses = payrollRecords.map((record) => record.status);
       const overallStatus = PayrollStatusManager.determineOverallStatus(
           allStatuses as PayrollStatus[],
       );
 
       return {
           message: 'Payroll status updated to Pending Approval',
           updatedCount: updatedPayroll.modifiedCount,
           overallStatus,
       };
   }
 
   async updatePayrollStatusToCancelled(month: number, year: number, payrollRecords: IPayroll[]) {
       // Validate status transition
       const statusValidation = PayrollStatusManager.validateStatusUpdate(
           payrollRecords.map((record) => record.toObject() as PayrollRecord),
           PayrollStatus.Cancelled,
       );
       console.log(statusValidation, 'statusValidation');
       if (!statusValidation.isValid) {
           throw new Error(statusValidation.message);
       }
 
       // Update the status to "Cancelled"
       const updatedPayroll = await Payroll.updateMany(
           { month, year },
           { $set: { status: PayrollStatus.Cancelled } }, // Fixed to Cancelled
       );
 
       // Get overall status
       const allStatuses = payrollRecords.map((record) => record.status);
       const overallStatus = PayrollStatusManager.determineOverallStatus(
           allStatuses as PayrollStatus[],
       );
 
       return {
           message: 'Payroll status updated to Cancelled',
           updatedCount: updatedPayroll.modifiedCount,
           overallStatus,
       };
   }
 
   async updatePayrollStatusToProcess(month: number, year: number, payrollRecords: IPayroll[]) {
       // Validate status transition
       const statusValidation = PayrollStatusManager.validateStatusUpdate(
           payrollRecords.map((record) => record.toObject() as PayrollRecord),
           PayrollStatus.InPayment, // Correct for Processing
       );
       console.log(statusValidation, 'statusValidation');
       if (!statusValidation.isValid) {
           throw new Error(statusValidation.message);
       }
 
       // Update the status to "Processing"
       const updatedPayroll = await Payroll.updateMany(
           { month, year },
           { $set: { status: PayrollStatus.InPayment } }, // Correct for Processing
       );
 
       // Get overall status
       const allStatuses = payrollRecords.map((record) => record.status);
       const overallStatus = PayrollStatusManager.determineOverallStatus(
           allStatuses as PayrollStatus[],
       );
 
       return {
           message: 'Payroll status updated to Processing',
           updatedCount: updatedPayroll.modifiedCount,
           overallStatus,
       };
   }
*/
