import { FastifyRequest, FastifyReply } from 'fastify';
import { FinalSettlement, IFinalSettlement } from '../models/final-settlement.model';
import { Payroll } from '../models/payrolls.model';
import { User } from '../models/user.model';
import { LeaveSummary } from '../models/leave-summary.model';
import { SalaryAssignment } from '../models/salary-assignments.model';
import { AttendanceRecord, Leave } from '../models';
import { ShiftAssignment } from '../models/shift.model';
import { HolidayCalendar } from '../models/holiday-calendar.model';
import { Types } from 'mongoose';

import { emailService } from './email.service';
import { generateFNFLetter } from './fnf-pdf.helper';
import { TaxDeclaration } from '../models/tax-declaration';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT_NAMES: Record<string, string> = {
    January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr',
    May: 'May', June: 'Jun', July: 'Jul', August: 'Aug',
    September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec'
};

/**
 * Helper: Calculate Unpaid Gaps (Months between Last Paid and LWD)
 * Extracts the complex loop logic to be reusable in Save/Update updates.
 */
async function calculateUnpaidGaps(
    employeeId: string,
    leavingDate: Date,
    monthlyGross: number,
    salaryAssignment: any,
    holdPayrolls: any[],
    resignationDate?: Date // ✅ Added Resignation Date argument
) {
    const unpaidMonths = [];
    let totalUnpaidSalary = 0;
    let totalDaysWorked = 0;
    let totalProfessionalTax = 0;
    let totalProvidentFund = 0;
    let totalIncomeTax = 0;
    let totalESI = 0;
    let totalLOPAmount = 0; // Track total LOP

    // Find last PAID payroll (status = Completed)
    const lastPaidPayroll = await Payroll.findOne({
        employeeId: new Types.ObjectId(employeeId),
        status: 'Completed'
    }).sort({ year: -1, month: -1 });

    const employee = await User.findById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const lwdDate = new Date(leavingDate);
    const lwdMonth = lwdDate.getMonth() + 1;
    const lwdYear = lwdDate.getFullYear();
    let currentMonth = 0;
    let currentYear = 0;

    // Helper functions
    const incrementMonth = () => {
        currentMonth++;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        }
    };

    const calculatePT = (grossSalary: number, monthNumber: number, isLWD: boolean) => {
        const ptConfig = salaryAssignment?.salaryStructureId?.statutoryDeductions?.professionalTax;
        if (!ptConfig?.slabs?.length) return 0;
        const { term, slabs } = ptConfig;

        let shouldDeduct = false;
        const applicableMonths: Record<string, number[]> = {
            half_yearly: [2, 8], // Standard: Feb & Aug
            yearly: [4],
            monthly: Array.from({ length: 12 }, (_, i) => i + 1),
        };

        // 1. Standard Deduction Check
        if (applicableMonths[term]?.includes(monthNumber)) {
            shouldDeduct = true;
        }
        // 2. FNF Special Rule (Catch-up for Half-Yearly)
        // If employee leaves BEFORE the deduction month (Aug or Feb), they are still liable for that half-year.
        else if (term === 'half_yearly' && isLWD) {
            // First Half (Apr-Sept): Deduct normally in Aug (8).
            // If leaving in Apr(4), May(5), Jun(6), Jul(7), force deduction.
            if ([4, 5, 6, 7].includes(monthNumber)) shouldDeduct = true;

            // Second Half (Oct-Mar): Deduct normally in Feb (2).
            // If leaving in Oct(10), Nov(11), Dec(12), Jan(1), force deduction.
            if ([10, 11, 12, 1].includes(monthNumber)) shouldDeduct = true;
        }

        if (!shouldDeduct) return 0;

        for (const slab of slabs) {
            if (grossSalary >= slab.fromAmount && (!slab.toAmount || grossSalary <= slab.toAmount)) {
                return Number(slab.taxAmount) || 0;
            }
        }
        return 0;
    };

    const calculatePF = (basic: number, da: number) => {
        const epfConfig = salaryAssignment?.salaryStructureId?.statutoryDeductions?.epf;
        if (!epfConfig) return 0;
        const rate = epfConfig.employeeContribution ?? 12;
        const wage = basic + (da || 0);
        const maxEpfContribution = (rate / 100) * (epfConfig.maxLimit ?? 15000);
        const capped = (epfConfig.maxLimit != null) && basic >= epfConfig.maxLimit;
        return Math.round(capped ? maxEpfContribution : wage * (rate / 100));
    };

    const calculateESI = () => 0;

    const calculateIncomeTax = async (monthNumber: number, year: number) => {
        const financialYear = monthNumber <= 3 ? `${year - 1}-${year}` : `${year}-${year + 1}`;
        const monthName = MONTH_NAMES[monthNumber - 1];
        const monthShortName = MONTH_SHORT_NAMES[monthName] || monthName;

        const taxDeclaration = await TaxDeclaration.findOne({
            employeeId: new Types.ObjectId(employeeId),
            financialYear,
        }).lean();

        if (!taxDeclaration) return 0;

        const monthlyDeduction = taxDeclaration.monthlyDeductions?.find(
            (md) => md.month === monthShortName && md.financialYear === financialYear && !md.isProcessed
        );

        return monthlyDeduction?.plannedDeduction || 0;
    };

    // Calculation Loop
    // Determine start month
    let startDate: Date;
    if (lastPaidPayroll) {
        // Default: Start from Next Month of Last Paid
        startDate = new Date(lastPaidPayroll.year, lastPaidPayroll.month, 1); // Month is 0-indexed in Date, but LastPaid.month is 1-indexed. So (year, month) is effectively month+1.
        // ex: Paid Jan (1). Date(Y, 1, 1) = Feb 1. Correct.
    } else {
        startDate = employee.joiningDate || new Date();
    }

    // ✅ Requirement: "resignation date to last working date , in between unpaid months only okay"
    // If resignation date is provided, and it is later than the calculated start date, push the start date forward.
    // However, usually we can't skip unpaid months between Last Paid and Resignation. 
    // But if strictly requested:
    if (resignationDate) {
        // Align to the first of the resignation month to ensure the full month is considered if applicable
        const resMonthStart = new Date(resignationDate.getFullYear(), resignationDate.getMonth(), 1);
        if (resMonthStart > startDate) {
            startDate = resMonthStart;
        }
    }

    currentMonth = startDate.getMonth() + 1;
    currentYear = startDate.getFullYear();

    const holdMonthSet = new Set(
        holdPayrolls.map(p => `${p.year}-${p.month}`)
    );

    // Loop through all months from (lastPaid + 1) to LWD month
    while (
        currentYear < lwdYear ||
        (currentYear === lwdYear && currentMonth <= lwdMonth)
    ) {
        const monthKey = `${currentYear}-${currentMonth}`;

        if (!holdMonthSet.has(monthKey)) {
            const isLWDMonth = currentYear === lwdYear && currentMonth === lwdMonth;
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
            const maxDays = isLWDMonth ? lwdDate.getDate() : daysInMonth;

            const startDate = new Date(currentYear, currentMonth - 1, 1);
            const endDate = isLWDMonth ? lwdDate : new Date(currentYear, currentMonth, 0);
            endDate.setHours(23, 59, 59, 999);

            // Fetch attendance
            const attendanceRecords = await AttendanceRecord.find({
                userId: new Types.ObjectId(employeeId),
                shiftDay: {
                    $gte: startDate,
                    $lte: endDate
                }
            }).select('shiftDay attendanceStatus halfType').lean();

            // Shift Assignment & Weekends
            const firstDay = new Date(currentYear, currentMonth - 1, 1);
            const lastDay = new Date(currentYear, currentMonth, 0);
            const shiftAssignments = await ShiftAssignment.find({
                userId: new Types.ObjectId(employeeId),
                $or: [
                    { endDate: { $exists: false }, startDate: { $lte: lastDay } },
                    { endDate: { $gte: firstDay }, startDate: { $lte: lastDay } },
                ],
            }).select('weekendDays').lean();
            const weekendDayNumbers = shiftAssignments.length > 0 && shiftAssignments[0].weekendDays?.length
                ? Array.from(new Set(shiftAssignments.flatMap((s: any) => s.weekendDays || [])))
                : [0, 6];

            // Mandatory Holidays
            const userForCalendar = await User.findById(employeeId).select('holidayCalendarHistory').lean();
            let mandatoryHolidayCount = 0;
            const mandatoryHolidayDateStrs: string[] = [];
            if (userForCalendar?.holidayCalendarHistory?.length) {
                const historyEntry = (userForCalendar as any).holidayCalendarHistory.find(
                    (e: any) => e.year === currentYear && e.isActive === true
                );
                if (historyEntry) {
                    const cal = await HolidayCalendar.findById(historyEntry.calendarId).select('holidays').lean();
                    if (cal?.holidays) {
                        (cal.holidays as any[]).filter((h: any) => {
                            const d = new Date(h.date);
                            return d.getFullYear() === currentYear && d.getMonth() === currentMonth - 1 && d.getDate() <= maxDays && h.type === 'mandatory';
                        }).forEach((h: any) => {
                            mandatoryHolidayCount++;
                            mandatoryHolidayDateStrs.push(new Date(h.date).toISOString().split('T')[0]);
                        });
                    }
                }
            }

            // Calculate Weekends (Only up to LWD)
            let weekendDaysInMonth = 0;
            const employmentDaysForWeekend = isLWDMonth ? lwdDate.getDate() : daysInMonth;
            for (let i = 1; i <= employmentDaysForWeekend; i++) {
                const d = new Date(currentYear, currentMonth - 1, i);
                const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                if (mandatoryHolidayDateStrs.includes(dateStr)) continue;
                if (weekendDayNumbers.includes(d.getDay())) weekendDaysInMonth++;
            }
            const holidayDays = mandatoryHolidayCount;

            // Calculate Present
            let presentDays = 0;
            const statusList = (arr: string[] | undefined) => Array.isArray(arr) ? arr : [];
            attendanceRecords.forEach((record: any) => {
                const arr = statusList(record.attendanceStatus);
                const isWeekend = record.shiftDay && weekendDayNumbers.includes(new Date(record.shiftDay).getDay());
                const isPresentLike = arr.includes('Present') || arr.includes('Late') || arr.includes('On-Time') || arr.includes('Early-Exit')
                    || (arr.includes('Override') && arr.includes('Present'));
                const isOnLeave = arr.includes('On-Leave');
                const halfDay = record.halfType && (record.halfType === 'First Half' || record.halfType === 'Second Half');
                if (!isWeekend && isPresentLike) {
                    presentDays += (halfDay && isOnLeave) ? 0.5 : 1;
                }
            });

            const weekendDays = weekendDaysInMonth;

            // Approved Leaves
            const leaves = await Leave.find({
                userId: new Types.ObjectId(employeeId),
                status: 'Approved',
                startDate: { $lte: endDate },
                endDate: { $gte: startDate }
            });

            let leaveDays = 0;
            let lopDays = 0;

            for (const leave of leaves) {
                const leaveStart = leave.startDate < startDate ? startDate : leave.startDate;
                const leaveEnd = leave.endDate > endDate ? endDate : leave.endDate;
                const days = Math.floor((leaveEnd.getTime() - leaveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                if (leave.leaveType === 'LOP' || leave.leaveType === 'Loss Of Pay') {
                    lopDays += days;
                } else {
                    leaveDays += days;
                }
            }

            let payableDays = presentDays + weekendDays + holidayDays + leaveDays;

            // ✅ LOP Calculation Logic (Updated):
            // LOP should ONLY be calculated for days within the employment period (1st to LWD or End of Month).
            // Days AFTER the LWD are NOT LOP; they are simply non-payable, non-employment days.

            const employmentDays = isLWDMonth ? lwdDate.getDate() : daysInMonth;

            // Cap payableDays at employmentDays (just in case)
            if (payableDays > employmentDays) payableDays = employmentDays;

            // LOP = Employment Days - Payable Days
            // Ensure we don't return negative LOP
            lopDays = Math.max(0, employmentDays - payableDays);

            // ✅ GUARD 2: Skip if no payable days (CRITICAL - Prevents overpayment)
            if (payableDays <= 0) {
                incrementMonth();
                continue;
            }

            const monthlySalary = (monthlyGross / daysInMonth) * payableDays;

            // Proration Logic (Matched with Payroll Service)
            const structure = salaryAssignment?.salaryStructureId || {};
            const basicPerc = structure.fixedEarnings?.basicPercentage ?? 0;
            const daPerc = Number(structure.fixedEarnings?.daPercentage) || 0;
            const hraPerc = Number(structure.fixedEarnings?.hraPercentage) || 0;
            const conveyancePerc = Number(structure.fixedEarnings?.conveyancePercentage) || 0;
            const otherAllowancePerc = Number(structure.fixedEarnings?.otherAllowancePercentage) || 0;

            const fullBasic = monthlyGross * (basicPerc / 100);
            const fullDA = daPerc === 0 ? 0 : fullBasic * (daPerc / 100);
            const fullHRA = monthlyGross * (hraPerc / 100);
            const fullConveyance = monthlyGross * (conveyancePerc / 100);
            const fullOtherAllowances = monthlyGross * (otherAllowancePerc / 100);

            const proratedBasic = (fullBasic / daysInMonth) * payableDays;
            const proratedDA = (fullDA / daysInMonth) * payableDays;
            const proratedHRA = (fullHRA / daysInMonth) * payableDays;
            const proratedConveyance = (fullConveyance / daysInMonth) * payableDays;
            const proratedOtherAllowances = (fullOtherAllowances / daysInMonth) * payableDays;
            const proratedGross = proratedBasic + proratedDA + proratedHRA + proratedConveyance + proratedOtherAllowances;

            // Note: If (proratedGross !== monthlySalary) due to rounding/residual, add difference to Other Allowance
            const finalGross = proratedGross;

            const lopAmount = (monthlyGross / daysInMonth) * lopDays;
            const ptAmount = Math.round(calculatePT(monthlyGross, currentMonth, isLWDMonth));
            const pfAmount = calculatePF(proratedBasic, proratedDA);
            const itAmount = await calculateIncomeTax(currentMonth, currentYear);
            const esiAmount = calculateESI();

            unpaidMonths.push({
                month: currentMonth,
                year: currentYear,
                monthYear: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
                totalDays: daysInMonth,
                daysWorked: payableDays,
                presentDays: presentDays,
                weekendDays: weekendDays,
                holidayDays: holidayDays,
                leaveDays: leaveDays,
                lopDays: lopDays,
                lopAmount: Math.round(lopAmount),
                components: {
                    basic: Math.round(proratedBasic + proratedDA),
                    hra: Math.round(proratedHRA),
                    conveyance: Math.round(proratedConveyance),
                    specialAllowance: 0,
                    otherAllowances: Math.round(proratedOtherAllowances),
                    gross: Math.round(finalGross)
                },
                salary: Math.round(monthlySalary),
                professionalTax: ptAmount,
                incomeTax: itAmount,
                providentFund: pfAmount,
                esi: esiAmount
            });

            totalUnpaidSalary += Math.round(monthlySalary);
            totalDaysWorked += payableDays;
            totalProfessionalTax += ptAmount;
            totalProvidentFund += pfAmount;
            totalIncomeTax += itAmount;
            totalESI += esiAmount;
            totalLOPAmount += Math.round(lopAmount);
        }

        incrementMonth();
    }

    return {
        unpaidMonths,
        totalUnpaidSalary: Math.round(totalUnpaidSalary),
        totalDaysWorked,
        totalProfessionalTax,
        totalProvidentFund,
        totalIncomeTax,
        totalESI,
        totalLOPAmount // Return for Final Calc
    };
}

/**
 * Helper: Calculate Notice Period Data
 * Handles days served and LOP adjustment
 */
async function calculateNoticeData(
    employeeId: string,
    resignationDate: Date,
    leavingDate: Date,
    noticePeriodDays: number,
    monthlyGross: number
) {
    let daysServed = 0;
    if (resignationDate && leavingDate) {
        const start = new Date(resignationDate);
        const end = new Date(leavingDate);
        // Base days (inclusive)
        daysServed = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // Subtract LOP during notice period
        const noticeLeaves = await Leave.find({
            userId: new Types.ObjectId(employeeId),
            status: 'Approved',
            startDate: { $lte: end },
            endDate: { $gte: start },
            $or: [{ leaveType: 'LOP' }, { leaveType: 'Loss Of Pay' }]
        });

        let lopDuringNotice = 0;
        for (const leave of noticeLeaves) {
            const lStart = leave.startDate < start ? start : leave.startDate;
            const lEnd = leave.endDate > end ? end : leave.endDate;
            if (lStart <= lEnd) {
                const days = Math.floor((lEnd.getTime() - lStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                lopDuringNotice += days;
            }
        }
        daysServed = Math.max(0, daysServed - lopDuringNotice);
    }

    const excessInNotice = daysServed - noticePeriodDays;

    let noticePeriodRecovery = 0;

    // ✅ Updated Calculation: Annual Days Logic (Day-wise based on month)
    // If shortfall exists, calculate recovery based on ACTUAL days in the specific months of the shortfall
    if (excessInNotice < 0) {
        const shortfallDays = Math.abs(excessInNotice);
        let currentDate = new Date(leavingDate);
        currentDate.setDate(currentDate.getDate() + 1); // Start recovery from the day AFTER leaving

        for (let i = 0; i < shortfallDays; i++) {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth(); // 0 = Jan, 1 = Feb
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            noticePeriodRecovery += monthlyGross / daysInMonth;

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    return { daysServed, excessInNotice, noticePeriodRecovery };
}

/**
 * Helper: Calculate Gratuity
 * Rule: 4 years 240 days (approx 4.66 years)
 */
/*
function calculateGratuity(
    joiningDate: Date,
    leavingDate: Date,
    monthlyGross: number,
    basicPercentage: number
) {
    if (!joiningDate || !leavingDate) return 0;
    const serviceMs = new Date(leavingDate).getTime() - new Date(joiningDate).getTime();
    const serviceYears = serviceMs / (1000 * 60 * 60 * 24 * 365.25);
 
    // 4 years and 240 days rule (~4.66 years)
    if (serviceYears >= 4.66) {
        const lastBasic = monthlyGross * (basicPercentage / 100);
        // Formula: (Last Basic * 15 / 26) * Completed Years (rounded)
        return Math.round((lastBasic * 15 / 26) * Math.round(serviceYears));
    }
    return 0;
}
*/


// Enhanced with component breakdown calculation

/**
 * Initialize Final Settlement (Auto-fill from existing data)
 * GET /final-settlement/initialize/:employeeId
 */
export async function initializeFinalSettlement(
    request: FastifyRequest<{ Params: { employeeId: string } }>,
    reply: FastifyReply
) {
    try {
        const { employeeId } = request.params;

        if (!Types.ObjectId.isValid(employeeId)) {
            return reply.code(400).send({ success: false, error: 'Invalid employee ID' });
        }

        // Get employee details
        const employee = await User.findById(employeeId);
        if (!employee) {
            return reply.code(404).send({ success: false, error: 'Employee not found' });
        }

        // ✅ VALIDATION: Check salary assignment exists and is active
        const salaryAssignment: any = await SalaryAssignment.findOne({
            employeeId: new Types.ObjectId(employeeId)
        }).sort({ effectiveFrom: -1 }).populate('salaryStructureId');

        // Block if no salary assignment found
        if (!salaryAssignment) {
            return reply.code(400).send({
                success: false,
                error: 'No salary assignment found for this employee. Please assign a salary structure before processing final settlement.'
            });
        }

        // Block if salary assignment is not active (using isActive field)
        if (!salaryAssignment.isActive) {
            return reply.code(400).send({
                success: false,
                error: `Salary assignment is not active. Please activate the salary assignment before processing final settlement.`
            });
        }

        const monthlyGross = salaryAssignment?.monthlyGross || 0;

        // Get latest resignation (if exists)
        const resignation = employee.resignations && employee.resignations.length > 0
            ? employee.resignations[employee.resignations.length - 1]
            : null;

        // Find last PAID payroll (status = Completed)
        const lastPaidPayroll = await Payroll.findOne({
            employeeId: new Types.ObjectId(employeeId),
            status: 'Completed'
        }).sort({ year: -1, month: -1 });

        // Calculate metadata for filtering
        const today = new Date();
        const leavingDate = resignation?.approvedLastWorkingDay || today;
        const resignationDate = resignation?.submittedAt || today;

        // Find HOLD payrolls for this employee
        const holdPayrolls = await Payroll.find({
            employeeId: new Types.ObjectId(employeeId),
            status: 'Hold'
        }).sort({ year: 1, month: 1 });

        // ✅ FIX: Filter HOLD payrolls to only include those relevant to the gap
        // AND exclude the LWD month itself so it gets calculated freshly with the specific day cutoff.
        // ✅ FIX: Filter HOLD payrolls to only include those relevant to the gap
        // AND exclude the LWD month itself so it gets calculated freshly with the specific day cutoff.
        const filteredHoldPayrolls = holdPayrolls.filter(p => {
            const payrollDate = new Date(p.year, p.month - 1, 1);

            // Check if this is exactly the LWD month
            const isLWDMonth = p.year === leavingDate.getFullYear() && p.month === (leavingDate.getMonth() + 1);

            // If it's the LWD month, exclude it from Hold list (so it's calc'd fresh in Unpaid Gaps)
            if (isLWDMonth) return false;

            // Include if it's AFTER the resignation date (start of res month) AND on or before leaving date
            // OR if it's simply "on hold" and hasn't been paid yet (legacy check)
            const resMonthStart = new Date(resignationDate.getFullYear(), resignationDate.getMonth(), 1);

            return payrollDate >= resMonthStart && payrollDate <= leavingDate;
        });

        // Get leave summary for the year of leaving
        const leaveYear = leavingDate instanceof Date ? leavingDate.getFullYear() : new Date(leavingDate).getFullYear();
        const leaveSummary = await LeaveSummary.findOne({ userId: employeeId, year: leaveYear });

        // Calculate notice period
        const noticePeriodDays = employee.noticePeriod || 0;

        // 1 & 2. Calculate Notice Data (using helper)
        const { daysServed, excessInNotice, noticePeriodRecovery } = await calculateNoticeData(
            employeeId,
            resignationDate,
            leavingDate,
            noticePeriodDays,
            monthlyGross
        );

        // Prepare hold payrolls data
        const holdPayrollsData = filteredHoldPayrolls.map(p => ({
            payrollId: p._id!,
            month: p.month,
            year: p.year,
            monthYear: p.monthYear,
            netSalary: p.netSalary,
            monthlyGross: p.monthlyGross,
            totalDays: p.totalDaysInMonth || 0,
            daysWorked: p.payableDays ?? 0,
            presentDays: p.presentDays ?? 0,
            lopDays: p.LOPDays ?? 0,
            status: p.status
        }));

        const totalHoldAmount = filteredHoldPayrolls.reduce((sum, p) => sum + p.netSalary, 0);

        // Last paid month
        const lastPaidMonth = lastPaidPayroll
            ? `${new Date(lastPaidPayroll.year, lastPaidPayroll.month - 1).toLocaleString('default', { month: 'short' })} ${lastPaidPayroll.year}`
            : 'N/A';
        const lastPaidMonthDate = lastPaidPayroll
            ? new Date(lastPaidPayroll.year, lastPaidPayroll.month - 1, 1)
            : new Date();

        // ✅ Step 5: Leave Encashment on (Basic Salary Only)
        // One Day Basic = Basic Salary / Actual Days in Month
        const alBalance = leaveSummary?.annual?.remaining || 0;
        let encashPerDay = 0;

        // Get actual days in the relevant month (leaving month)
        const encashDate = leavingDate instanceof Date ? leavingDate : new Date(leavingDate);
        const daysInEncashMonth = new Date(encashDate.getFullYear(), encashDate.getMonth() + 1, 0).getDate();

        const structure = salaryAssignment?.salaryStructureId;
        if (structure) {
            const basicPerc = structure.fixedEarnings?.basicPercentage ?? 0;
            // Removed DA from calculation as per requirement
            const basic = monthlyGross * (basicPerc / 100);
            encashPerDay = basic / daysInEncashMonth;
        } else {
            // Fallback if no structure (should rarely happen)
            encashPerDay = monthlyGross / daysInEncashMonth;
        }

        // 🔍 DEBUG: Log leave encashment calculation
        console.log("=== INITIALIZE - LEAVE ENCASHMENT CALCULATION ===");
        console.log("Monthly Gross:", monthlyGross);
        console.log("Basic %:", structure?.fixedEarnings?.basicPercentage ?? 0);
        console.log("DA %:", Number(structure?.fixedEarnings?.daPercentage) || 0);
        console.log("Calculated Basic:", monthlyGross * ((structure?.fixedEarnings?.basicPercentage ?? 0) / 100));
        console.log("Calculated DA:", structure?.fixedEarnings?.daPercentage ? (monthlyGross * ((structure?.fixedEarnings?.basicPercentage ?? 0) / 100)) * ((Number(structure?.fixedEarnings?.daPercentage) || 0) / 100) : 0);
        console.log("Per Day Rate:", encashPerDay);
        console.log("Rounded Per Day Rate:", Math.round(encashPerDay));
        console.log("Leave Balance:", alBalance);
        console.log("Encash Amount:", Math.round(alBalance * encashPerDay));
        console.log("=================================================");

        const leaveBalance = [
            {
                leaveType: 'AL',
                balance: alBalance,
                encashDays: alBalance,
                perDayRate: Math.round(encashPerDay),
                encashAmount: Math.round(alBalance * encashPerDay)
            }
        ];

        let gratuityAmount = 0; // Disabled as per requirement

        // Calculate unpaid months using reused function
        const unpaidCalculation = await calculateUnpaidGaps(
            employeeId,
            leavingDate,
            monthlyGross,
            salaryAssignment,
            filteredHoldPayrolls, // Use filtered (which is now ALL) list
            resignationDate // ✅ Pass resignation date
        );

        const {
            unpaidMonths,
            totalUnpaidSalary,
            totalDaysWorked,
            totalProfessionalTax,
            totalProvidentFund,
            totalIncomeTax,
            totalESI
        } = unpaidCalculation;

        // Auto-fill response
        const initialData = {
            mode: 'automatic',
            employeeId,
            employeeName: employee.name,
            employeeCode: employee.employeeCode,

            // Step 2: Resignation Details
            resignationSubmittedOn: resignationDate,
            leavingDate,
            leavingReason: resignation?.summary || 'RESIGNED',
            settlementDate: today,

            // Step 3: Notice Pay
            noticeRequired: noticePeriodDays > 0,
            noticePeriodDays: noticePeriodDays > 0 ? noticePeriodDays : 0,
            daysServed: noticePeriodDays > 0 ? daysServed : 0,
            excessInNotice: noticePeriodDays > 0 ? excessInNotice : 0,
            noticePeriodRecovery: Math.round(noticePeriodDays > 0 ? noticePeriodRecovery : 0),

            // Step 4: Work Days
            lastPaidMonth,
            lastPaidMonthDate,
            holdPayrolls: holdPayrollsData,
            totalHoldAmount: Math.round(totalHoldAmount),
            unpaidMonths,
            totalUnpaidSalary: Math.round(totalUnpaidSalary),
            totalDaysWorked,

            // Step 5: Leave Encashment
            leaveBalance,
            totalLeaveEncashment: Math.round(leaveBalance[0].encashAmount),

            // Step 6: Reimbursements
            reimbursements: [],
            totalReimbursements: 0,
            otherDeductions: [],
            totalOtherDeductions: 0,
            otherAdditions: [],
            totalOtherAdditions: 0,

            // Final Calculation (nested for backward compatibility)
            finalCalculation: {
                holdSalaries: Math.round(totalHoldAmount),
                unpaidSalaries: Math.round(totalUnpaidSalary),
                leaveEncashment: Math.round(leaveBalance[0].encashAmount),
                reimbursements: 0,
                otherAdditions: 0,
                gratuity: Math.round(gratuityAmount),
                totalPayable: Math.round(totalHoldAmount + totalUnpaidSalary + leaveBalance[0].encashAmount + gratuityAmount),
                noticePeriodRecovery: Math.round(noticePeriodRecovery),
                professionalTax: Math.round(totalProfessionalTax),
                incomeTax: Math.round(totalIncomeTax),
                providentFund: Math.round(totalProvidentFund),
                esi: Math.round(totalESI),
                lopAmount: Math.round(unpaidCalculation.totalLOPAmount || 0), // ✅ Added LOP amount
                otherDeductions: 0,
                totalDeductions: Math.round(noticePeriodRecovery + totalProfessionalTax + totalIncomeTax + totalProvidentFund + totalESI + (unpaidCalculation.totalLOPAmount || 0)),
                netAmount: Math.round((totalHoldAmount + totalUnpaidSalary + leaveBalance[0].encashAmount + gratuityAmount) - (noticePeriodRecovery + totalProfessionalTax + totalIncomeTax + totalProvidentFund + totalESI + (unpaidCalculation.totalLOPAmount || 0))),
                isNegative: ((totalHoldAmount + totalUnpaidSalary + leaveBalance[0].encashAmount + gratuityAmount) - (noticePeriodRecovery + totalProfessionalTax + totalIncomeTax + totalProvidentFund + totalESI + (unpaidCalculation.totalLOPAmount || 0))) < 0
            }
        };

        // ✅ FIX #2: Flatten response structure
        const flatResponse = {
            success: true,
            message: 'Final settlement data initialized',
            netAmount: initialData.finalCalculation.netAmount,
            isNegative: initialData.finalCalculation.isNegative,
            totalPayable: initialData.finalCalculation.totalPayable,
            totalDeductions: initialData.finalCalculation.totalDeductions,
            providentFund: initialData.finalCalculation.providentFund,
            esi: initialData.finalCalculation.esi,
            professionalTax: initialData.finalCalculation.professionalTax,
            incomeTax: initialData.finalCalculation.incomeTax,
            gratuity: initialData.finalCalculation.gratuity,
            lopAmount: initialData.finalCalculation.lopAmount, // ✅ Added for easy access
            ...initialData
        };

        return reply.send(flatResponse);

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

/**
 * Internal Helper: Reconciles flat API payload into nested Mongoose structure
 */
function packSettlement(settlement: any, data: any) {
    if (!data) return;

    // 1. Direct Root-Level Fields
    const rootFields = [
        'employeeId', 'employeeName', 'employeeCode',
        'resignationSubmittedOn', 'leavingDate', 'leavingReason', 'settlementDate',
        'lastPaidMonth', 'lastPaidMonthDate',
        'holdPayrolls', 'totalHoldAmount',
        'unpaidMonths', 'totalUnpaidSalary',
        'totalDaysWorked',
        'leaveBalance', 'totalLeaveEncashment',
        'reimbursements', 'totalReimbursements',
        'otherDeductions', 'totalOtherDeductions',
        'otherAdditions', 'totalOtherAdditions',
        'status', 'mode', 'pdfUrl', 'remarks',
        // ✅ Add missing notice fields
        'noticeRequired', 'daysServed', 'noticePeriodRecovery', 'excessInNotice', 'noticePeriodDays'
    ];

    rootFields.forEach(field => {
        if (data[field] !== undefined) {
            settlement[field] = data[field];
        }
    });

    // 2. Map Flat Notice Fields (Direct to Root Level - Schema uses flat fields, not nested)
    if (data.noticeRequired !== undefined) settlement.noticeRequired = data.noticeRequired;
    if (data.noticePeriodDays !== undefined) settlement.noticePeriodDays = data.noticePeriodDays;
    if (data.daysServed !== undefined) settlement.daysServed = data.daysServed;
    if (data.excessInNotice !== undefined) settlement.excessInNotice = data.excessInNotice;
    if (data.noticePeriodRecovery !== undefined) settlement.noticePeriodRecovery = data.noticePeriodRecovery;

    // 3. Map Summary Fields to finalCalculation Object
    if (!settlement.finalCalculation) settlement.finalCalculation = {};
    const calc = settlement.finalCalculation;

    // Payable
    const hAmt = data.totalHoldAmount !== undefined ? data.totalHoldAmount : data.holdSalaries;
    if (hAmt !== undefined) calc.holdSalaries = Math.round(hAmt);

    const uSalary = data.totalUnpaidSalary !== undefined ? data.totalUnpaidSalary : data.unpaidSalaries;
    if (uSalary !== undefined) calc.unpaidSalaries = Math.round(uSalary);

    const leAmt = data.totalLeaveEncashment !== undefined ? data.totalLeaveEncashment : data.leaveEncashment;
    if (leAmt !== undefined) calc.leaveEncashment = Math.round(leAmt);

    const rAmt = data.totalReimbursements !== undefined ? data.totalReimbursements : data.reimbursements;
    if (rAmt !== undefined) calc.reimbursements = Math.round(rAmt);

    const aAmt = data.totalOtherAdditions !== undefined ? data.totalOtherAdditions : data.otherAdditions;
    if (aAmt !== undefined) calc.otherAdditions = Math.round(aAmt);

    if (data.gratuity !== undefined) calc.gratuity = Math.round(data.gratuity);
    if (data.totalPayable !== undefined) calc.totalPayable = Math.round(data.totalPayable);

    // Deductions
    if (data.noticePeriodRecovery !== undefined) calc.noticePeriodRecovery = Math.round(data.noticePeriodRecovery);
    if (data.professionalTax !== undefined) calc.professionalTax = Math.round(data.professionalTax);
    if (data.providentFund !== undefined) calc.providentFund = Math.round(data.providentFund);
    if (data.esi !== undefined) calc.esi = Math.round(data.esi);
    if (data.incomeTax !== undefined) calc.incomeTax = Math.round(data.incomeTax);
    if (data.lopAmount !== undefined) calc.lopAmount = Math.round(data.lopAmount);

    const dAmt = data.totalOtherDeductions !== undefined ? data.totalOtherDeductions : data.otherDeductions;
    if (dAmt !== undefined) calc.otherDeductions = Math.round(dAmt);

    if (data.totalDeductions !== undefined) calc.totalDeductions = Math.round(data.totalDeductions);

    // Net
    if (data.netAmount !== undefined) calc.netAmount = Math.round(data.netAmount);
    if (data.isNegative !== undefined) calc.isNegative = data.isNegative;
}

/**
 * Save/Update Final Settlement (Draft)
 * POST /final-settlement/save
 */
export async function saveFinalSettlement(
    request: FastifyRequest<{
        Params: { employeeId: string },
        Body: Partial<IFinalSettlement>
    }>,
    reply: FastifyReply
) {
    try {
        const data = request.body as any;
        const { employeeId } = request.params;

        // Ensure employeeId is set
        const effectiveEmployeeId = employeeId || data.employeeId;
        if (!effectiveEmployeeId) {
            return reply.code(400).send({ success: false, error: 'Employee ID is required' });
        }
        const employeeIdStr = String(effectiveEmployeeId);
        const employeeIdObj = new Types.ObjectId(employeeIdStr);

        // 1. Check if draft already exists
        let settlement = await FinalSettlement.findOne({
            employeeId: employeeIdObj,
            status: 'Draft'
        });

        if (!settlement) {
            settlement = new FinalSettlement({
                employeeId: employeeIdObj,
                status: 'Draft',
                initiatedAt: new Date(),
                initiatedBy: data.initiatedBy || employeeIdObj
            });
        }

        // 2. Perform Backend Recalculation (Security Check)
        // SECURITY FIX: Fetch hold payrolls from DB instead of trusting body
        const holdPayrollIds = (data.holdPayrolls || []).map((p: any) => p.payrollId || p._id);
        const holdPayrolls = await Payroll.find({
            _id: { $in: holdPayrollIds },
            employeeId: employeeIdObj
        });
        const unpaidMonths = data.unpaidMonths || [];

        const salaryAssignment: any = await SalaryAssignment.findOne({
            employeeId: employeeIdObj
        }).sort({ effectiveFrom: -1 }).populate('salaryStructureId');

        const monthlyGross = salaryAssignment?.monthlyGross || 0;
        const structure = salaryAssignment?.salaryStructureId || {};

        // Recalculation Helpers (Same as Calculate route)
        const calculatePT = (gross: number, m: number) => {
            const ptConfig = structure?.statutoryDeductions?.professionalTax;
            if (!ptConfig?.slabs?.length) return 0;
            const applicableMonths: Record<string, number[]> = {
                half_yearly: [2, 8],
                monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            };
            if (!applicableMonths[ptConfig.term]?.includes(m)) return 0;
            for (const slab of ptConfig.slabs) {
                if (gross >= slab.fromAmount && (!slab.toAmount || gross <= slab.toAmount)) return Number(slab.taxAmount) || 0;
            }
            return 0;
        };

        const calculatePF = (basic: number, da: number) => {
            const epf = structure?.statutoryDeductions?.epf;
            if (!epf) return 0;
            const wage = basic + da;
            const rate = epf.employeeContribution / 100;
            const limit = epf.maxLimit ?? 15000;
            return wage >= limit ? (limit * rate) : (wage * rate);
        };

        const calculateESI = () => 0;

        const employee = await User.findById(effectiveEmployeeId);
        const joiningDate = employee?.joiningDate;
        const leavingDate = data.leavingDate || data.resignationDetails?.lwd;

        let gratuity = 0;
        if (false && joiningDate && leavingDate) {
            const jD = new Date(joiningDate as any);
            const lD = new Date(leavingDate);
            const diffYears = (lD.getTime() - jD.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

            // Eligibility: 4 years 240 days (approx 4.657 years)
            if (diffYears >= 4.657) {
                const bP = (structure.fixedEarnings?.basicPercentage ?? 0) / 100;
                const dP = (structure.fixedEarnings?.daPercentage ?? 0) / 100;
                const lastBasicDA = (monthlyGross * bP) + (monthlyGross * bP * dP);
                gratuity = Math.round((15 / 26) * lastBasicDA * diffYears);
            }
        }

        let totalUnpaid = 0;
        for (const m of unpaidMonths) {
            const daysInMonth = m.totalDays || 30;
            const payableDays = m.daysWorked || 0;

            if (daysInMonth > 0) {
                const bP = (structure.fixedEarnings?.basicPercentage ?? 0) / 100;
                const dP = (structure.fixedEarnings?.daPercentage ?? 0) / 100;
                const hP = (structure.fixedEarnings?.hraPercentage ?? 0) / 100;
                const tP = (structure.fixedEarnings?.travelAllowancePercentage ?? 0) / 100;
                const oP = (structure.fixedEarnings?.otherAllowancePercentage ?? 0) / 100; // Assuming otherAllowancePercentage exists

                const fullB = monthlyGross * bP;
                const fullD = fullB * dP;
                const fullH = monthlyGross * hP;
                const fullT = monthlyGross * tP;
                const fullOtherAllowances = monthlyGross * oP;

                const pb = (fullB / daysInMonth) * payableDays;
                const pd = (fullD / daysInMonth) * payableDays;
                const ph = (fullH / daysInMonth) * payableDays;
                const ptAllo = (fullT / daysInMonth) * payableDays;
                const proratedOtherAllowances = (fullOtherAllowances / daysInMonth) * payableDays;

                const pg = (monthlyGross / daysInMonth) * payableDays;
                const balancing = pg - (pb + pd + ph + ptAllo + proratedOtherAllowances); // Adjust balancing

                m.components = {
                    basic: Math.round(pb + pd),
                    hra: Math.round(ph),
                    conveyance: Math.round(ptAllo),
                    specialAllowance: Math.round(balancing),
                    otherAllowances: Math.round(proratedOtherAllowances),
                    gross: Math.round(pg)
                };

                m.salary = Math.round(pg);

                // Standard PT Calculation
                let ptAmount = Math.round(calculatePT(monthlyGross, m.month));

                // ✅ NEW LOGIC: Check for Mid-Term Exit PT Liability (H1/H2 Catch-up)
                // If employee leaves in Apr-Jul (H1) or Oct-Jan (H2), they owe the tax 
                // that would normally be deducted in Aug or Feb.
                const lDate = leavingDate ? new Date(leavingDate) : new Date();
                const isLeavingMonth = m.year === lDate.getFullYear() && m.month === (lDate.getMonth() + 1);

                if (isLeavingMonth) {
                    const mNum = m.month;
                    // H1 Catch-up: Leaving in Apr(4), May(5), Jun(6), Jul(7) -> Owe H1 tax (Simulate Aug deduction)
                    const h1Catchup = [4, 5, 6, 7].includes(mNum);
                    // H2 Catch-up: Leaving in Oct(10), Nov(11), Dec(12), Jan(1) -> Owe H2 tax (Simulate Feb deduction)
                    const h2Catchup = [10, 11, 12, 1].includes(mNum);

                    if (h1Catchup || h2Catchup) {
                        const deductionMonth = h1Catchup ? 8 : 2;
                        const forcedPT = Math.round(calculatePT(monthlyGross, deductionMonth));

                        // Apply forced PT if standard calc didn't trigger (which it won't for these months)
                        if (ptAmount === 0 && forcedPT > 0) {
                            ptAmount = forcedPT;
                        }
                    }
                }

                m.professionalTax = ptAmount;
                m.providentFund = Math.round(calculatePF(pb, pd));
                m.esi = Math.round(calculateESI());

                totalUnpaid += m.salary;
            }
        }

        // Recalculate Leave Encashment
        let totalLeaveAmt = 0;
        if (data.leaveBalance) {
            // SECURITY FIX: Calculate rate from structure (Basic + DA) / 30
            // SECURITY FIX: Calculate rate from structure (Basic Only) / DaysInMonth
            let safePerDayRate = 0;
            const basicPerc = structure.fixedEarnings?.basicPercentage ?? 0;

            // Re-calculate days in month for consistency
            const encashDate = leavingDate ? new Date(leavingDate) : new Date();
            const daysInEncashMonth = new Date(encashDate.getFullYear(), encashDate.getMonth() + 1, 0).getDate();

            if (basicPerc > 0) {
                const basic = monthlyGross * (basicPerc / 100);
                safePerDayRate = basic / daysInEncashMonth;
            } else {
                safePerDayRate = monthlyGross / daysInEncashMonth;
            }

            // 🔍 DEBUG: Log leave encashment recalculation
            console.log("=== SAVE - LEAVE ENCASHMENT RECALCULATION ===");
            console.log("Monthly Gross:", monthlyGross);
            console.log("Basic %:", basicPerc);
            // console.log("DA %:", daPerc);
            console.log("Safe Per Day Rate:", safePerDayRate);
            console.log("Rounded Per Day Rate:", Math.round(safePerDayRate));
            console.log("==============================================");

            for (const l of data.leaveBalance) {
                // Force backend rate
                l.perDayRate = Math.round(safePerDayRate);
                l.encashAmount = Math.round((Number(l.encashDays) || 0) * safePerDayRate);
                totalLeaveAmt += l.encashAmount;
            }
        }

        // Aggregate Totals
        const holdSalaries = holdPayrolls.reduce((sum: number, p: any) => sum + (p.netSalary || 0), 0) || 0;
        const totalReimbursements = data.reimbursements?.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0) || 0;
        const totalAdditions = data.otherAdditions?.reduce((sum: number, a: any) => sum + (Number(a.amount) || 0), 0) || 0;
        const totalDeductions = data.otherDeductions?.reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0) || 0;

        const pt = unpaidMonths.reduce((sum: number, m: any) => sum + (m.professionalTax || 0), 0) || 0;
        const pf = unpaidMonths.reduce((sum: number, m: any) => sum + (m.providentFund || 0), 0) || 0;
        const esi = unpaidMonths.reduce((sum: number, m: any) => sum + (m.esi || 0), 0) || 0;
        const it = unpaidMonths.reduce((sum: number, m: any) => sum + (m.incomeTax || 0), 0) || 0;
        const totalLOPAmount = unpaidMonths.reduce((sum: number, m: any) => sum + (m.lopAmount || 0), 0) || 0; // ✅ Sum LOP

        // Notice Recovery
        let noticeRecovery = data.noticePay?.noticePeriodRecovery ?? data.noticePeriodRecovery;

        // ✅ FIX: Use precise day-by-day calculation helper
        if (data.noticeRequired === false) {
            noticeRecovery = 0;
        } else {
            // Recalculate if not provided or if likely a reset (0) with actual shortfall
            const shouldRecalculate = noticeRecovery === undefined || (noticeRecovery === 0 && (data.excessInNotice || 0) < 0);

            if (shouldRecalculate) {
                // Determine notice days - check root, then nested, then fallback to employee default
                let noticeDays = data.noticePeriodDays;
                if (noticeDays === undefined && (data as any).noticePay?.noticePeriodDays !== undefined) {
                    noticeDays = (data as any).noticePay.noticePeriodDays;
                }

                // If notice days still unknown, try to use existing settlement or employee default
                if (noticeDays === undefined) {
                    // This creates a circular dependency if we strictly rely on input. 
                    // But typically save is called with full state. 
                    // Fallback to simplistic if we really can't find notice days? 
                    // No, try to use initialized default from prior fetch.
                    // For now, assume 0 if missing to avoid blocking save.
                    noticeDays = 0;
                }

                if (leavingDate && data.resignationSubmittedOn && monthlyGross > 0) {
                    // Re-use the helper for consistency with initialize
                    const noticeData = await calculateNoticeData(
                        effectiveEmployeeId.toString(),
                        new Date(data.resignationSubmittedOn),
                        new Date(leavingDate),
                        Number(noticeDays),
                        monthlyGross
                    );

                    // Only override if we really needed to recalculate
                    if (noticeData.excessInNotice < 0) {
                        noticeRecovery = Math.round(noticeData.noticePeriodRecovery);
                    }
                } else if ((data.excessInNotice || 0) < 0) {
                    // Fallback to simplistic if dates are missing but shortfall exists (Legacy fallback)
                    noticeRecovery = Math.round(Math.abs(data.excessInNotice || 0) * monthlyGross / 30);
                }
            }
        }

        const totalPayable = Math.round(holdSalaries + totalUnpaid + totalLeaveAmt + totalReimbursements + totalAdditions + gratuity);
        // ✅ Include LOP Amount in Total Deductions
        const allDeductions = Math.round((noticeRecovery || 0) + totalDeductions + pt + pf + esi + it + totalLOPAmount);
        const netAmount = totalPayable - allDeductions;


        // Sanitize Notice Period Data if Notice is NOT Required
        if (data.noticeRequired === false) {
            data.daysServed = 0;
            data.noticePeriodDays = 0;
            data.excessInNotice = 0;
            data.noticePeriodRecovery = 0;
            if (data.finalCalculation) {
                data.finalCalculation.noticePeriodRecovery = 0;
            }

            // Explicitly set on settlement too, to be safe
            settlement.noticeRequired = false;
            settlement.daysServed = 0;
            settlement.noticePeriodDays = 0;
            settlement.excessInNotice = 0;
            settlement.noticePeriodRecovery = 0;
        } else {
            if (data.daysServed !== undefined) settlement.daysServed = data.daysServed;
            if (data.noticeRequired !== undefined) settlement.noticeRequired = data.noticeRequired;
            if (data.noticePeriodDays !== undefined) settlement.noticePeriodDays = data.noticePeriodDays;
            if (data.excessInNotice !== undefined) settlement.excessInNotice = data.excessInNotice;
        }

        // Ensure notice recovery matches calculation or override
        if (data.finalCalculation?.noticePeriodRecovery !== undefined) {
            settlement.noticePeriodRecovery = data.finalCalculation.noticePeriodRecovery;
        } else if (data.noticePeriodRecovery !== undefined) {
            settlement.noticePeriodRecovery = data.noticePeriodRecovery;
        }

        // 3. Pack recalculated and original data into Mongoose structure
        // packSettlement helper now includes these fields in whitelist
        const enrichedData = {
            ...data,
            totalHoldAmount: holdSalaries,
            totalUnpaidSalary: totalUnpaid,
            totalLeaveEncashment: totalLeaveAmt,
            totalReimbursements: totalReimbursements,
            totalOtherAdditions: totalAdditions, // Maps to data.totalOtherAdditions in packSettlement
            totalOtherDeductions: totalDeductions,
            professionalTax: pt,
            providentFund: pf,
            esi: esi,
            incomeTax: it,
            gratuity: gratuity,
            lopAmount: totalLOPAmount, // ✅ Added LOP amount
            noticePeriodRecovery: noticeRecovery,
            totalPayable,
            totalDeductions: allDeductions,
            netAmount,
            isNegative: netAmount < 0
        };

        packSettlement(settlement, enrichedData);

        await settlement.save();

        return reply.send({
            success: true,
            message: 'Final settlement saved as draft',

            // Root-level summary fields (for UI wizard consistency)
            netAmount: enrichedData.netAmount,
            isNegative: enrichedData.isNegative,
            totalPayable: enrichedData.totalPayable,
            totalDeductions: enrichedData.totalDeductions,

            // Root-level tax/summary
            providentFund: pf,
            esi: esi,
            professionalTax: pt,
            incomeTax: it,
            gratuity: gratuity,
            lopAmount: totalLOPAmount, // ✅ Added for consistency

            // Full document
            data: settlement
        });

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ success: false, error: 'Internal server error', details: error.message });
    }
}

/**
 * Get All Final Settlements (List with Pagination)
 * GET /final-settlement?page=1&limit=10&status=Draft&search=query
 */
export async function getAllFinalSettlements(
    request: FastifyRequest<{
        Querystring: {
            page?: number;
            limit?: number;
            status?: 'Draft' | 'Confirmed';
            search?: string;
        };
    }>,
    reply: FastifyReply
) {
    try {
        const rawPage = request.query.page ?? 1;
        const rawLimit = request.query.limit ?? 10;
        const page = Math.max(1, Number(rawPage) || 1);
        const limit = Math.min(100, Math.max(1, Number(rawLimit) || 10));
        const status = request.query.status;
        const search = request.query.search?.trim();

        // Calculate pagination (if not using aggr pipeline for pagination)
        const skip = (page - 1) * limit;

        // Base matching for status if provided
        const matchStage: any = {};
        if (status === 'Draft' || status === 'Confirmed') {
            matchStage.status = status;
        }

        let settlements;
        let total = 0;

        if (search) {
            // Aggregation pipeline for Search
            // 1. Lookup User details
            // 2. Match regex against User fields OR Settlement fields
            const pipeline: any[] = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'employeeId',
                        foreignField: '_id',
                        as: 'employeeDetails'
                    }
                },
                { $unwind: '$employeeDetails' },
                {
                    $match: {
                        $or: [
                            { 'employeeName': { $regex: search, $options: 'i' } }, // Check direct name
                            { 'employeeCode': { $regex: search, $options: 'i' } }, // Check direct code
                            { 'status': { $regex: search, $options: 'i' } },
                            { 'employeeDetails.name': { $regex: search, $options: 'i' } },
                            { 'employeeDetails.email': { $regex: search, $options: 'i' } },
                            { 'employeeDetails.employeeCode': { $regex: search, $options: 'i' } }
                        ]
                    }
                },
                { $sort: { createdAt: -1 } },
                {
                    $facet: {
                        metadata: [{ $count: 'total' }],
                        data: [{ $skip: skip }, { $limit: limit }]
                    }
                }
            ];

            const result = await FinalSettlement.aggregate(pipeline);
            settlements = result[0]?.data || [];
            total = result[0]?.metadata[0]?.total || 0;

            // Re-map employeeId to match populate structure manually since we unwinded
            settlements = settlements.map((s: any) => {
                s.employeeId = s.employeeDetails; // Mimic populate
                s.employeeName = s.employeeName || s.employeeDetails?.name;
                s.employeeCode = s.employeeCode || s.employeeDetails?.employeeCode;
                delete s.employeeDetails;
                return s;
            });

        } else {
            // Standard Find Query (Faster if no deep search needed)
            const countQuery = FinalSettlement.countDocuments(matchStage);
            const findQuery = FinalSettlement.find(matchStage)
                .populate('employeeId', 'name employeeCode email')
                .lean()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const [settlementsData, totalCount] = await Promise.all([findQuery, countQuery]);
            settlements = settlementsData.map((s: any) => ({
                ...s,
                employeeName: s.employeeName || s.employeeId?.name,
                employeeCode: s.employeeCode || s.employeeId?.employeeCode
            }));
            total = totalCount;
        }

        return reply.send({
            success: true,
            data: settlements,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

/**
 * Get Final Settlement
 * GET /final-settlement/:employeeId
 */
export async function getFinalSettlement(
    request: FastifyRequest<{ Params: { employeeId: string } }>,
    reply: FastifyReply
) {
    try {
        const { employeeId } = request.params;

        if (!Types.ObjectId.isValid(employeeId)) {
            return reply.code(400).send({ success: false, error: 'Invalid employee ID' });
        }

        const settlement = await FinalSettlement.findOne({
            employeeId: new Types.ObjectId(employeeId)
        }).sort({ createdAt: -1 });

        if (!settlement) {
            return reply.code(404).send({
                success: false,
                error: 'No final settlement found for this employee'
            });
        }

        // ✅ FIX #2: Return flattened response for GET endpoint
        return reply.send({
            success: true,

            // Root-level fields
            pdfUrl: settlement.pdfUrl,
            netAmount: settlement.finalCalculation?.netAmount || 0,
            isNegative: settlement.finalCalculation?.isNegative || false,
            totalPayable: settlement.finalCalculation?.totalPayable || 0,
            totalDeductions: settlement.finalCalculation?.totalDeductions || 0,
            providentFund: settlement.finalCalculation?.providentFund || 0,
            esi: settlement.finalCalculation?.esi || 0,
            professionalTax: settlement.finalCalculation?.professionalTax || 0,
            incomeTax: settlement.finalCalculation?.incomeTax || 0,
            gratuity: settlement.finalCalculation?.gratuity || 0,

            // Full settlement data
            data: settlement
        });

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

/**
 * Confirm Final Settlement
 * POST /final-settlement/confirm/:employeeId
 */
export async function confirmFinalSettlement(
    request: FastifyRequest<{
        Params: { employeeId: string };
        Body: Partial<IFinalSettlement> & { confirmedBy: string };
    }>,
    reply: FastifyReply
) {
    const { employeeId } = request.params;
    const bodyData = request.body;
    const { confirmedBy } = bodyData;

    if (!confirmedBy) {
        return reply.code(400).send({ success: false, error: 'Confirmed by ID is required' });
    }

    try {
        // --- PHASE 1: Pre-Transaction Validation & PDF Generation ---

        // 1.1 Fetch current draft (without lock first to generate PDF)
        const draft = await FinalSettlement.findOne({
            employeeId: new Types.ObjectId(employeeId),
            status: 'Draft'
        });

        if (!draft) {
            const alreadyConfirmed = await FinalSettlement.findOne({
                employeeId: new Types.ObjectId(employeeId),
                status: 'Confirmed'
            });
            return reply.code(alreadyConfirmed ? 400 : 404).send({
                success: false,
                error: alreadyConfirmed ? 'Settlement already confirmed' : 'No draft settlement found'
            });
        }

        const employee = await User.findById(employeeId);
        if (!employee) {
            return reply.code(404).send({ success: false, error: 'Employee not found' });
        }

        // 1.2 Generate PDF (Outside transaction to prevent timeouts)
        // Note: settlement data might change if another admin confirms, 
        // but we verify status again inside the transaction.
        let pdfUrl = '';
        try {
            // ✅ FIX: Merge body data into draft for PDF generation (so PDF has latest values)
            const pdfData = {
                ...draft.toObject(),
                ...(bodyData.daysServed !== undefined && { daysServed: bodyData.daysServed }),
                ...(bodyData.noticeRequired !== undefined && { noticeRequired: bodyData.noticeRequired }),
                ...(bodyData.noticePeriodDays !== undefined && { noticePeriodDays: bodyData.noticePeriodDays }),
                ...(bodyData.excessInNotice !== undefined && { excessInNotice: bodyData.excessInNotice }),
                ...(bodyData.noticePeriodRecovery !== undefined && { noticePeriodRecovery: bodyData.noticePeriodRecovery }),
                // ✅ FIX: Also merge complex arrays if provided, as PDF helper recalculates summaries from them
                ...(bodyData.unpaidMonths && { unpaidMonths: bodyData.unpaidMonths }),
                ...(bodyData.holdPayrolls && { holdPayrolls: bodyData.holdPayrolls }),
                ...(bodyData.leaveBalance && { leaveBalance: bodyData.leaveBalance }),
                // Ensure finalCalculation is updated if provided
                ...(bodyData.finalCalculation && { finalCalculation: { ...draft.finalCalculation, ...bodyData.finalCalculation } })
            };

            pdfUrl = await generateFNFLetter(pdfData, employee);
            if (!pdfUrl || !pdfUrl.startsWith('http')) throw new Error('Invalid PDF URL generated');
        } catch (pdfErr: any) {
            request.log.error(pdfErr, 'FNF PDF generation failed');
            return reply.code(500).send({ success: false, error: `PDF generation failed: ${pdfErr.message || pdfErr}` });
        }

        // --- PHASE 2: Atomic Transaction for DB Updates ---
        const session = await FinalSettlement.startSession();
        session.startTransaction();

        try {
            // 2.1 Re-fetch AND LOCK the draft inside transaction
            const settlement = await FinalSettlement.findOne({
                _id: draft._id,
                status: 'Draft'
            }).session(session);

            if (!settlement) {
                await session.abortTransaction();
                return reply.code(400).send({ success: false, error: 'Settlement status changed during PDF generation. Please retry.' });
            }

            // 2.2 Update settlement data
            // SECURITY FIX: Fetch hold payrolls from DB (Mirroring save/calculate)
            if (bodyData.holdPayrolls && bodyData.holdPayrolls.length > 0) {
                const holdPayrollIds = bodyData.holdPayrolls.map((p: any) => p.payrollId || p._id);
                const holdPayrollsDb = await Payroll.find({
                    _id: { $in: holdPayrollIds },
                    employeeId: new Types.ObjectId(employeeId)
                }).session(session);

                // Replace body data with DB data
                bodyData.holdPayrolls = holdPayrollsDb.map(p => ({
                    payrollId: p._id,
                    month: p.month,
                    year: p.year,
                    monthYear: p.monthYear,
                    netSalary: p.netSalary, // AUTHENTIC SOURCE
                    monthlyGross: p.monthlyGross,
                    totalDays: p.totalDaysInMonth,
                    daysWorked: p.payableDays,
                    presentDays: p.presentDays,
                    lopDays: p.LOPDays,
                    status: p.status
                }));
                // Recalculate Hold Total
                bodyData.totalHoldAmount = holdPayrollsDb.reduce((sum, p) => sum + p.netSalary, 0);
            }

            // SECURITY FIX: Enforce Safe Leave Rate
            if (bodyData.leaveBalance) {
                const salaryAssignment: any = await SalaryAssignment.findOne({
                    employeeId: new Types.ObjectId(employeeId)
                }).sort({ effectiveFrom: -1 }).populate('salaryStructureId').session(session);

                const monthlyGross = salaryAssignment?.monthlyGross || 0;
                const structure = salaryAssignment?.salaryStructureId || {};

                let safePerDayRate = 0;
                const basicPerc = structure.fixedEarnings?.basicPercentage ?? 0;

                // Re-calculate days in month for consistency (Confirm Step)
                const encashDate = settlement.leavingDate || new Date();
                const daysInEncashMonth = new Date(encashDate.getFullYear(), encashDate.getMonth() + 1, 0).getDate();

                if (basicPerc > 0) {
                    const basic = monthlyGross * (basicPerc / 100);
                    safePerDayRate = basic / daysInEncashMonth;
                } else {
                    safePerDayRate = monthlyGross / daysInEncashMonth;
                }

                bodyData.leaveBalance.forEach((l: any) => {
                    l.perDayRate = Math.round(safePerDayRate);
                    l.encashAmount = Math.round((Number(l.encashDays) || 0) * safePerDayRate);
                });

                bodyData.totalLeaveEncashment = bodyData.leaveBalance.reduce((sum: number, l: any) => sum + l.encashAmount, 0);
            }


            // ✅ FIX: Explicitly save Notice Period Metadata
            // If notice is NOT required, force these values to 0 for consistency
            if (bodyData.noticeRequired === false) {
                bodyData.daysServed = 0;
                bodyData.noticePeriodDays = 0;
                bodyData.excessInNotice = 0;
                bodyData.noticePeriodRecovery = 0;
                if (bodyData.finalCalculation) {
                    bodyData.finalCalculation.noticePeriodRecovery = 0;
                }

                settlement.noticeRequired = false;
                settlement.daysServed = 0;
                settlement.noticePeriodDays = 0;
                settlement.excessInNotice = 0;
                settlement.noticePeriodRecovery = 0;
            } else {
                if (bodyData.daysServed !== undefined) settlement.daysServed = bodyData.daysServed;
                if (bodyData.noticeRequired !== undefined) settlement.noticeRequired = bodyData.noticeRequired;
                if (bodyData.noticePeriodDays !== undefined) settlement.noticePeriodDays = bodyData.noticePeriodDays;
                if (bodyData.excessInNotice !== undefined) settlement.excessInNotice = bodyData.excessInNotice;
            }

            // Ensure notice recovery matches calculation
            if (bodyData.finalCalculation?.noticePeriodRecovery !== undefined) {
                settlement.noticePeriodRecovery = bodyData.finalCalculation.noticePeriodRecovery;
            } else if (bodyData.noticePeriodRecovery !== undefined) {
                settlement.noticePeriodRecovery = bodyData.noticePeriodRecovery;
            }

            // Use packSettlement helper for consistent structure mapping
            packSettlement(settlement, bodyData);

            settlement.status = 'Confirmed';
            settlement.pdfUrl = pdfUrl;
            settlement.confirmedAt = new Date();
            settlement.confirmedBy = new Types.ObjectId(confirmedBy);

            await settlement.save({ session });

            // 2.3 Release hold payrolls
            // Update the status of all associated hold payrolls to 'Completed'
            if (settlement.holdPayrolls && settlement.holdPayrolls.length > 0) {
                const holdPayrollIds = settlement.holdPayrolls.map((p: any) => p.payrollId);
                await Payroll.updateMany(
                    { _id: { $in: holdPayrollIds } },
                    {
                        $set: {
                            status: 'Completed',
                            paymentConfirmedAt: new Date(),
                            payslipReleaseDate: new Date(),
                            processedAt: new Date(),
                            isFinalSettlement: true // Optional: Mark as part of FNF
                        }
                    },
                    { session }
                );
                request.log.info(`Released ${holdPayrollIds.length} hold payrolls for FNF`);
            }

            // 2.4 Mark Income Tax as processed for unpaid months
            // This prevents double-deduction if employee is rehired or payroll is corrected

            // Calculate Total Hold Salary (Net) to add to the main F&F Payslip
            const totalHoldNet = (settlement.holdPayrolls && settlement.holdPayrolls.length > 0)
                ? settlement.holdPayrolls.reduce((sum: number, p: any) => sum + (p.netSalary || 0), 0)
                : 0;

            // Sort unpaid months to ensure we identify the Last Month (LWD Month)
            const sortedUnpaidMonths = [...settlement.unpaidMonths].sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            });

            for (let i = 0; i < sortedUnpaidMonths.length; i++) {
                const month = sortedUnpaidMonths[i];
                const isLastMonth = i === sortedUnpaidMonths.length - 1;

                // ✅ AUTO-GENERATE PAYSLIP LOGIC
                // Create or Update a standard Payroll record for this settled month
                const monthName = MONTH_NAMES[month.month - 1];

                // Fetch salary assignment for proper structure
                const salaryAssignment = await SalaryAssignment.findOne({
                    employeeId: new Types.ObjectId(employeeId)
                }).sort({ effectiveFrom: -1 }).populate('salaryStructureId').session(session);

                if (!salaryAssignment) {
                    throw new Error(`No salary assignment found for employee ${employeeId}`);
                }

                const monthlyGross = salaryAssignment.monthlyGross;
                const structure = salaryAssignment.salaryStructureId as any;
                const employeeCountry = employee.country || 'IN';
                const isUAE = employeeCountry === 'AE';

                // Calculate attendance adjusted gross (same as Payroll Service)
                const attendanceAdjustedGross = Math.round((month.daysWorked / month.totalDays) * monthlyGross);

                // Calculate earnings components (matching Payroll Service logic)
                const basic = Math.round((structure.fixedEarnings.basicPercentage / 100) * attendanceAdjustedGross);
                const hra = Math.round((structure.fixedEarnings.hraPercentage / 100) * attendanceAdjustedGross);
                const da = Math.round((structure.fixedEarnings.daPercentage / 100) * basic);

                // Calculate travel allowance based on country
                const travelAllowanceFromPercentageProrated = Math.round(
                    ((structure.fixedEarnings.travelAllowancePercentage ?? 0) / 100) * attendanceAdjustedGross
                );
                const travelAllowanceFromAssignment = salaryAssignment.travelAllowance || 0;
                const travelAllowance = isUAE
                    ? Math.round((month.daysWorked / month.totalDays) * travelAllowanceFromAssignment)
                    : travelAllowanceFromPercentageProrated;

                // Calculate other allowance based on country
                let otherAllowance: number;
                if (isUAE) {
                    otherAllowance = Math.round(
                        attendanceAdjustedGross - (basic + hra + da + travelAllowance)
                    );
                } else {
                    otherAllowance = Math.round(
                        (structure.fixedEarnings.otherAllowancePercentage / 100) * attendanceAdjustedGross
                    );
                }

                const reimbursementAllowance = Math.round(
                    ((structure.fixedEarnings.reimbursementPercentage ?? 0) / 100) * attendanceAdjustedGross
                );

                // Air ticket and medical allowances (UAE only, annual)
                const airTicketAllowance = isUAE ? (salaryAssignment.airTicketAllowance || 0) : 0;
                const medicalAllowance = isUAE ? (salaryAssignment.medicalAllowance || 0) : 0;

                // Calculate assigned values (full month, not prorated)
                const assignedBasic = Math.round((structure.fixedEarnings.basicPercentage / 100) * monthlyGross);
                const assignedHra = Math.round((structure.fixedEarnings.hraPercentage / 100) * monthlyGross);
                const assignedDa = Math.round((structure.fixedEarnings.daPercentage / 100) * monthlyGross);

                const travelAllowanceForAssigned = isUAE ? travelAllowanceFromAssignment : Math.round(
                    ((structure.fixedEarnings.travelAllowancePercentage ?? 0) / 100) * monthlyGross
                );

                let assignedOtherAllowance: number;
                if (isUAE) {
                    assignedOtherAllowance = Math.round(
                        monthlyGross - (assignedBasic + assignedHra + assignedDa + travelAllowanceForAssigned)
                    );
                } else {
                    assignedOtherAllowance = Math.round(
                        (structure.fixedEarnings.otherAllowancePercentage / 100) * monthlyGross
                    );
                }
                // ✅ ADD HOLD SALARY TO REIMBURSEMENT (Only for Last Month)
                const holdSalaryAddition = isLastMonth ? totalHoldNet : 0;
                // Accumulate to existing reimbursement if any
                const existingReimbursement = (month as any).reimbursement || 0; // Use manual entry if present, else 0

                const finalReimburseVal = existingReimbursement;


                // Calculate total deductions (matching Payroll Service)
                const totalDeductions = Math.round(
                    month.professionalTax +
                    month.incomeTax +
                    month.providentFund +
                    month.esi +
                    (month.lopAmount || 0)
                );

                // Calculate net salary (matching Payroll Service)
                const netSalary = Math.round(
                    attendanceAdjustedGross -
                    month.providentFund -
                    month.incomeTax -
                    month.professionalTax -
                    month.esi +
                    finalReimburseVal // Add Reimbursement
                    // holdSalaryAddition  // ❌ REMOVED: Prevent double counting. Hold payrolls are released separately.
                );
                // Calculate CTC based on country (matching Payroll Service)
                let ctc: number;
                if (isUAE) {
                    const monthlyComponents = assignedBasic + assignedHra + assignedDa + assignedOtherAllowance + travelAllowanceForAssigned;
                    ctc = Math.round(
                        (monthlyComponents * 12) +
                        (salaryAssignment.airTicketAllowance || 0) +
                        (salaryAssignment.medicalAllowance || 0) +
                        ((salaryAssignment.monthlyInsurance || 0) * 12)
                    );
                } else {
                    ctc = Math.round(
                        attendanceAdjustedGross +
                        month.providentFund + // epfEmployer
                        month.esi // esiEmployer
                    );
                }

                // Prepare proper values for Assigned (Full Column) vs Actual
                // ✅ FNF SPECIAL: Use 'periodGross' (Worked + LOP) for Assigned Values
                // This ensures "Full" column shows the Max Salary for the Period (e.g. 1-14 Feb),
                // while "Actual" column shows what was earned (deducting LOP).
                const periodDays = (month.daysWorked || 0) + (month.lopDays || 0);
                const periodGross = Math.round((periodDays / month.totalDays) * monthlyGross);

                // Prepare payload matching Payroll Service structure
                const payrollPayload = {
                    salaryAssignmentId: salaryAssignment._id,
                    country: employeeCountry,
                    monthYear: `${month.year}-${String(month.month).padStart(2, '0')}`,

                    // Earnings (matching Payroll Service calculations)
                    basic,
                    hra,
                    da,
                    otherAllowance,
                    travelAllowance,
                    airTicketAllowance,
                    medicalAllowance,
                    reimbursementAllowance,

                    // Deductions (from FNF calculations)
                    professionalTax: month.professionalTax,
                    incomeTax: month.incomeTax,
                    epfEmployee: month.providentFund,
                    epfEmployer: month.providentFund,
                    esiEmployee: month.esi,
                    esiEmployer: month.esi,
                    tdsDeduction: 0,
                    additionalDeduction: 0,
                    totalDeductions,
                    leaveDeductions: month.lopAmount || 0,

                    // Salary calculations
                    monthlyGross,
                    attendanceAdjustedGross,
                    netSalary,
                    ctc,

                    // Attendance data
                    totalDaysInMonth: month.totalDays,
                    presentDays: month.presentDays,
                    payableDays: month.daysWorked,
                    LOPDays: month.lopDays,

                    // Additional fields
                    overtimeHours: 0,
                    overtimePay: 0,
                    reimbursement: finalReimburseVal,
                    holdSalary: holdSalaryAddition, // ✅ Store Hold Salary explicitly
                    bonus: 0,

                    // Assigned values (matching Payroll Service)
                    assigned: {
                        basic: Math.round((structure.fixedEarnings.basicPercentage / 100) * periodGross),
                        hra: Math.round((structure.fixedEarnings.hraPercentage / 100) * periodGross),
                        da: Math.round((structure.fixedEarnings.daPercentage / 100) * periodGross),
                        otherAllowance: Math.round(
                            (structure.fixedEarnings.otherAllowancePercentage / 100) * periodGross
                        ),
                        travelAllowance: Math.round(
                            ((structure.fixedEarnings.travelAllowancePercentage ?? 0) / 100) * periodGross
                        ),
                        airTicketAllowance: isUAE ? (salaryAssignment.airTicketAllowance || 0) : 0,
                        medicalAllowance: isUAE ? (salaryAssignment.medicalAllowance || 0) : 0,
                        reimbursementAllowance: Math.round(
                            ((structure.fixedEarnings.reimbursementPercentage ?? 0) / 100) * periodGross
                        )
                    },

                    // Status fields (Completed for Final Settlement - main difference from Draft)
                    status: 'Completed',
                    paymentConfirmedAt: new Date(),
                    payslipReleaseDate: new Date(),
                    processedAt: new Date(),
                    isFinalSettlement: true
                };

                const existingPayroll = await Payroll.findOne({
                    employeeId: new Types.ObjectId(employeeId),
                    month: month.month,
                    year: month.year
                }).session(session);

                if (existingPayroll) {
                    await Payroll.updateOne(
                        { _id: existingPayroll._id },
                        { $set: payrollPayload },
                        { session }
                    );
                    request.log.info(`Updated existing payslip for FNF month: ${monthName} ${month.year}`);
                } else {
                    // Create new payroll with all calculated values
                    const newPayroll = new Payroll({
                        employeeId: new Types.ObjectId(employeeId),
                        month: month.month,
                        year: month.year,
                        ...payrollPayload
                    });

                    await newPayroll.save({ session });
                    request.log.info(`Auto-generated new payslip for FNF month: ${monthName} ${month.year}`);
                }

                if (month.incomeTax > 0) {
                    const financialYear = month.month <= 3
                        ? `${month.year - 1}-${month.year}`
                        : `${month.year}-${month.year + 1}`;

                    const monthShortName = MONTH_SHORT_NAMES[monthName];

                    try {
                        await TaxDeclaration.updateOne(
                            {
                                employeeId: new Types.ObjectId(employeeId),
                                financialYear,
                                'monthlyDeductions.month': monthShortName,
                                'monthlyDeductions.isProcessed': false
                            },
                            {
                                $set: {
                                    'monthlyDeductions.$.isProcessed': true,
                                    'monthlyDeductions.$.actualDeduction': month.incomeTax,
                                    'monthlyDeductions.$.processedDate': new Date()
                                }
                            },
                            { session }
                        );
                    } catch (taxErr) {
                        // Log but don't fail the entire transaction if tax update fails
                        // This is non-critical as the IT was already deducted in FNF
                        request.log.warn(taxErr, `Failed to mark IT as processed for ${monthName} ${month.year}`);
                    }
                }
            }

            // 2.5 Update user status and mark as inactive
            // When final settlement is confirmed, employee should be marked as inactive
            await User.updateOne(
                { _id: new Types.ObjectId(employeeId) },
                {
                    $set: {
                        finalSettlementDone: true,
                        active: false  // ✅ Mark employee as inactive on settlement confirmation
                    }
                },
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            // --- PHASE 3: Post-Transaction Notification ---
            if (employee.email) {
                emailService.sendEmail({
                    body: {
                        to: employee.email,
                        subject: 'Full and Final Settlement Confirmed',
                        html: `<p>Your F&F letter is ready: <a href="${pdfUrl}">Download</a></p>`,
                        text: `Your F&F letter is ready: ${pdfUrl}`
                    }
                }).catch(e => console.error('Email failed (non-critical)', e));
            }

            return reply.send({
                success: true,
                pdfUrl: pdfUrl,
                netAmount: settlement.finalCalculation?.netAmount || 0,
                data: settlement
            });

        } catch (dbError: any) {
            await session.abortTransaction();
            session.endSession();
            throw dbError; // Caught by outer catch
        }

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ success: false, error: 'Internal server error', details: error.message });
    }
}

/**
 * Delete Final Settlement Draft
 * DELETE /final-settlement/:employeeId
 */
export async function deleteFinalSettlement(
    request: FastifyRequest<{ Params: { employeeId: string } }>,
    reply: FastifyReply
) {
    try {
        const { employeeId } = request.params;

        if (!Types.ObjectId.isValid(employeeId)) {
            return reply.code(400).send({ success: false, error: 'Invalid employee ID' });
        }

        const result = await FinalSettlement.deleteOne({
            employeeId: new Types.ObjectId(employeeId),
            status: 'Draft'
        });

        if (result.deletedCount === 0) {
            return reply.code(404).send({
                success: false,
                error: 'No draft final settlement found for this employee'
            });
        }

        return reply.send({
            success: true,
            message: 'Final settlement draft deleted successfully'
        });

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}

/**
 * Calculate Final Settlement
 * POST /final-settlement/calculate
 */
export async function calculateFinalSettlement(
    request: FastifyRequest<{ Body: Partial<IFinalSettlement> }>,
    reply: FastifyReply
) {
    try {
        const data = request.body as Partial<IFinalSettlement>;

        // DEBUG: Log what we're receiving
        console.log('=== CALCULATE ENDPOINT DEBUG ===');
        console.log('holdPayrolls received:', data.holdPayrolls?.length || 0, 'items');
        console.log('unpaidMonths received:', data.unpaidMonths?.length || 0, 'items');
        console.log('workDays.holdPayrolls:', (data as any).workDays?.holdPayrolls?.length || 0, 'items');
        console.log('workDays.unpaidMonths:', (data as any).workDays?.unpaidMonths?.length || 0, 'items');
        console.log('leavingDate:', data.leavingDate);
        console.log('================================');

        // Support both formats: prioritize workDays, then root level
        // Check for non-empty arrays to avoid using empty root-level arrays
        const holdPayrollsFromWorkDays = (data as any).workDays?.holdPayrolls;
        const holdPayrollsFromRoot = data.holdPayrolls;
        const holdPayrolls = (holdPayrollsFromWorkDays && holdPayrollsFromWorkDays.length > 0)
            ? holdPayrollsFromWorkDays
            : (holdPayrollsFromRoot && holdPayrollsFromRoot.length > 0)
                ? holdPayrollsFromRoot
                : [];

        const unpaidMonthsFromWorkDays = (data as any).workDays?.unpaidMonths;
        const unpaidMonthsFromRoot = data.unpaidMonths;
        const unpaidMonthsRaw = (unpaidMonthsFromWorkDays && unpaidMonthsFromWorkDays.length > 0)
            ? unpaidMonthsFromWorkDays
            : (unpaidMonthsFromRoot && unpaidMonthsFromRoot.length > 0)
                ? unpaidMonthsFromRoot
                : [];

        // ✅ FIX: Backend Validation for LOP Days (Prevents invalid inputs)
        for (const m of unpaidMonthsRaw) {
            if (m.lopDays < 0 || m.lopDays > (m.totalDays || 31)) {
                return reply.code(400).send({
                    success: false,
                    error: `Invalid LOP days for ${m.monthYear}. Must be between 0 and ${m.totalDays || 31}.`
                });
            }
        }

        // Filter unpaid months based on LWD FIRST
        let filteredUnpaidMonths = unpaidMonthsRaw;
        if (data.leavingDate && filteredUnpaidMonths.length > 0) {
            const lwdDate = new Date(data.leavingDate);
            const lwdYear = lwdDate.getFullYear();
            const lwdMonth = lwdDate.getMonth() + 1; // 1-indexed

            filteredUnpaidMonths = filteredUnpaidMonths.filter((month: any) => {
                const monthYear = month.year;
                const monthMonth = month.month;

                // Only include months before or IN the same month as LWD
                return (monthYear < lwdYear) || (monthYear === lwdYear && monthMonth <= lwdMonth);
            });
        }

        const employeeIdObj = data.employeeId ? new Types.ObjectId(data.employeeId.toString()) : null;

        // SECURITY FIX Mirror: Fetch hold payrolls from DB
        const holdPayrollIds = (holdPayrolls || []).map((p: any) => p.payrollId || p._id);
        const holdPayrollsDb = await Payroll.find({
            _id: { $in: holdPayrollIds },
            employeeId: employeeIdObj
        });


        // Payable components (using filtered data)
        const totalHoldAmount = holdPayrollsDb.reduce((sum: number, p: any) => sum + (p.netSalary || 0), 0) || 0;


        // RECICULATION LOGIC: Recalculate unpaid salaries locally to ensure Zero-Logic from frontend
        let totalUnpaidSalary = 0;

        // Fetch Salary Assignment to get the "Gold Standard" monthly gross and structure
        const salaryAssignment: any = employeeIdObj ? await SalaryAssignment.findOne({
            employeeId: employeeIdObj
        }).sort({ effectiveFrom: -1 }).populate('salaryStructureId') : null;

        const monthlyGross = salaryAssignment?.monthlyGross || 0;
        const structure = salaryAssignment?.salaryStructureId || {};


        // Fetch User needed for Country check inside loop
        const employee = await User.findById(data.employeeId);


        // Helper: PT Calculation (Cloned for recalculation logic)
        const calculatePT = (grossSalary: number, monthNumber: number) => {
            const ptConfig = structure?.statutoryDeductions?.professionalTax;
            if (!ptConfig?.slabs?.length) return 0;
            const { term, slabs } = ptConfig;
            const applicableMonths: Record<string, number[]> = {
                half_yearly: [2, 8],
                monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            };
            if (!applicableMonths[term]?.includes(monthNumber)) return 0;
            for (const slab of slabs) {
                if (grossSalary >= slab.fromAmount && (!slab.toAmount || grossSalary <= slab.toAmount)) {
                    return Number(slab.taxAmount) || 0;
                }
            }
            return 0;
        };

        // Helper: PF Calculation (Cloned for recalculation logic)
        const calculatePF = (basic: number, da: number) => {
            const epf = structure?.statutoryDeductions?.epf;
            if (!epf) return 0;
            const wage = basic + da;
            const rate = epf.employeeContribution / 100;
            const limit = epf.maxLimit ?? 15000;
            return wage >= limit ? (limit * rate) : (wage * rate);
        };

        // Helper: ESI Calculation
        const calculateESI = () => 0;

        for (const month of filteredUnpaidMonths) {
            const daysInMonth = month.totalDays || 30;
            const payableDays = month.daysWorked || 0;
            const lopDays = month.lopDays || 0; // Ensure lopDays is available

            if (daysInMonth > 0) {
                // 1. Recalculate Component Proration
                const bP = (structure.fixedEarnings?.basicPercentage ?? 0) / 100;
                const dP = (structure.fixedEarnings?.daPercentage ?? 0) / 100;
                const hP = (structure.fixedEarnings?.hraPercentage ?? 0) / 100;
                const tP = (structure.fixedEarnings?.travelAllowancePercentage ?? 0) / 100;
                const oP = (structure.fixedEarnings?.otherAllowancePercentage ?? 0) / 100;

                const fullB = monthlyGross * bP;
                const fullD = fullB * dP;
                const fullH = monthlyGross * hP;
                const fullT = monthlyGross * tP;
                const fullOtherAllowances = monthlyGross * oP;

                const proratedBasic = (fullB / daysInMonth) * payableDays;
                const proratedDA = (fullD / daysInMonth) * payableDays;
                const proratedHRA = (fullH / daysInMonth) * payableDays;
                // 1. Calculate Allowances (Payroll naming convention)
                const proratedTravelAllowance = (fullT / daysInMonth) * payableDays;
                const proratedOtherAllowances = (fullOtherAllowances / daysInMonth) * payableDays;

                const pg = (monthlyGross / daysInMonth) * payableDays;

                // 2. Balancing Figure (Merged into Other Allowance per user request)
                // Instead of a separate "Special Allowance", we add the rounding difference to Other Allowance
                const balancing = pg - (proratedBasic + proratedDA + proratedHRA + proratedTravelAllowance + proratedOtherAllowances);

                const lopAmount = (monthlyGross / daysInMonth) * lopDays;
                // const ptAmount removed to avoid redeclaration
                const pfAmount = calculatePF(proratedBasic, proratedDA);
                // const itAmount = await calculateIncomeTax(month.month, month.year); 
                const esiAmount = calculateESI();

                month.components = {
                    basic: Math.round(proratedBasic + proratedDA),
                    hra: Math.round(proratedHRA),
                    conveyance: Math.round(proratedTravelAllowance), // ✅ Using 'conveyance' to match Schema
                    specialAllowance: 0, // Not used, balancing moved to Other Allowance
                    otherAllowances: Math.round(proratedOtherAllowances + balancing), // Merged here
                    gross: Math.round(pg)
                };

                month.lopAmount = Math.round(lopAmount);

                // 2. Recalculate Statutory
                month.salary = Math.round(pg);

                // Standard PT Calculation
                let ptAmount = Math.round(calculatePT(monthlyGross, month.month));

                // ✅ NEW LOGIC: Check for Mid-Term Exit PT Liability (H1/H2 Catch-up)
                // If employee leaves in Apr-Jul (H1) or Oct-Jan (H2), they owe the tax 
                // that would normally be deducted in Aug or Feb.
                // We need to determine if this 'month' is the leaving month.
                // UNPAID MONTHS are iterated. The specific month might be the leaving month.
                const leavingDateObj = data.leavingDate ? new Date(data.leavingDate) : new Date();
                const isLeavingMonth = month.year === leavingDateObj.getFullYear() && month.month === (leavingDateObj.getMonth() + 1);

                if (isLeavingMonth) {
                    const mNum = month.month;
                    // H1 Catch-up: Leaving in Apr(4), May(5), Jun(6), Jul(7) -> Owe H1 tax (Simulate Aug deduction)
                    const h1Catchup = [4, 5, 6, 7].includes(mNum);
                    // H2 Catch-up: Leaving in Oct(10), Nov(11), Dec(12), Jan(1) -> Owe H2 tax (Simulate Feb deduction)
                    const h2Catchup = [10, 11, 12, 1].includes(mNum);

                    if (h1Catchup || h2Catchup) {
                        const deductionMonth = h1Catchup ? 8 : 2;
                        const forcedPT = Math.round(calculatePT(monthlyGross, deductionMonth));

                        if (ptAmount === 0 && forcedPT > 0) {
                            ptAmount = forcedPT;
                        }
                    }
                }

                month.professionalTax = ptAmount;
                month.providentFund = pfAmount;
                month.esi = esiAmount;
                // Preserve Income Tax from input (Planned Tax)
                month.incomeTax = month.incomeTax || 0;

                totalUnpaidSalary += month.salary;
            }
        }






        // RECALCULATION LOGIC: Recalculate leave encashment amounts based on SAFE perDayRate
        let totalLeaveEncashment = 0;
        // ✅ Step 5: Leave Encashment on (Basic Salary Only)
        // One Day Basic = Basic Salary / Actual Days in Month
        // const leaveSummary = (data as any).leaveSummary; // Assuming leaveSummary is available in data
        // const alBalance = leaveSummary?.annual?.remaining || 0;
        let encashPerDay = 0;

        // Get actual days in the relevant month (leaving month)
        const encashDate = data.leavingDate ? (data.leavingDate instanceof Date ? data.leavingDate : new Date(data.leavingDate)) : new Date();
        const daysInEncashMonth = new Date(encashDate.getFullYear(), encashDate.getMonth() + 1, 0).getDate();

        // const structure = salaryAssignment?.salaryStructureId; // Already defined above
        if (structure) {
            const basicPerc = structure.fixedEarnings?.basicPercentage ?? 0;
            // Removed DA from calculation as per requirement
            const basic = monthlyGross * (basicPerc / 100);
            encashPerDay = basic / daysInEncashMonth;
        } else {
            // Fallback if no structure (should rarely happen)
            encashPerDay = monthlyGross / daysInEncashMonth;
        }

        if (data.leaveBalance) {
            for (const l of data.leaveBalance) {
                // Backend trusts its own perDayRate (Basic+DA) logic provided during init
                l.perDayRate = Math.round(encashPerDay); // Use the newly calculated encashPerDay
                l.encashAmount = Math.round((Number(l.encashDays) || 0) * encashPerDay);
                totalLeaveEncashment += l.encashAmount;
            }
        }

        const totalReimbursements = data.reimbursements?.reduce((sum: number, r: any) => sum + (r.amount || 0), 0) || 0;
        const totalOtherAdditions = data.otherAdditions?.reduce((sum: number, a: any) => sum + (a.amount || 0), 0) || 0;

        // Deductions
        const totalOtherDeductions = data.otherDeductions?.reduce((sum: number, d: any) => sum + (d.amount || 0), 0) || 0;

        let noticeRecovery = 0;

        if (data.noticeRequired === false) {
            noticeRecovery = 0;
        } else {
            // Check for manual override provided in request
            const manualRecovery = (data.noticePeriodRecovery !== undefined)
                ? data.noticePeriodRecovery
                : (data as any).noticePay?.noticePeriodRecovery;

            // If manual recovery is provided and non-zero, favor it (User Override)
            // If it is 0, we treat it as "Please Recalculate" if there is a shortfall
            const hasManualOverride = manualRecovery !== undefined && manualRecovery !== 0;

            if (hasManualOverride) {
                noticeRecovery = manualRecovery;
            } else {
                // ✅ Recalculate using precise helper
                const resignationDate = (data as any).resignationSubmittedOn ? new Date((data as any).resignationSubmittedOn) : null;
                const leavingDateForNotice = data.leavingDate ? new Date(data.leavingDate) : null;

                // Get notice days from payload or nested
                const noticeDays = (data.noticePeriodDays !== undefined)
                    ? Number(data.noticePeriodDays)
                    : Number((data as any).noticePay?.noticePeriodDays || 0);

                if (resignationDate && leavingDateForNotice && monthlyGross > 0) {
                    const calculatedNotice = await calculateNoticeData(
                        (data.employeeId || "").toString(),
                        resignationDate,
                        leavingDateForNotice,
                        noticeDays,
                        monthlyGross
                    );

                    // Use the auto-calculated recovery
                    noticeRecovery = Math.round(calculatedNotice.noticePeriodRecovery);
                } else if ((data.excessInNotice || 0) < 0) {
                    // Fallback simplistic if dates missing (should not happen in calculate preview)
                    noticeRecovery = Math.abs(data.excessInNotice || 0) * monthlyGross / 30;
                }
            }
        }

        // Statutory Aggregation: sum from the RECALCULATED/Filtered months
        const professionalTax = filteredUnpaidMonths.reduce((sum: number, m: any) => sum + (m.professionalTax || 0), 0) || 0;
        const providentFund = filteredUnpaidMonths.reduce((sum: number, m: any) => sum + (m.providentFund || 0), 0) || 0;
        const esi = filteredUnpaidMonths.reduce((sum: number, m: any) => sum + (m.esi || 0), 0) || 0;
        const incomeTax = filteredUnpaidMonths.reduce((sum: number, m: any) => sum + (m.incomeTax || 0), 0) || 0;
        const totalLOPAmount = filteredUnpaidMonths.reduce((sum: number, m: any) => sum + (m.lopAmount || 0), 0) || 0; // ✅ Sum LOP

        // Fetch User to check Joining Date for Gratuity
        // const employee = await User.findById(data.employeeId); // Already fetched above
        const joiningDate = employee?.joiningDate;
        const leavingDate = data.leavingDate || (data as any).resignationDetails?.lwd;

        let gratuity = 0;
        if (false && joiningDate && leavingDate) {
            const jD = new Date(joiningDate as any);
            const lD = new Date(leavingDate);
            const diffYears = (lD.getTime() - jD.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

            // Eligibility: 4 years 240 days (approx 4.657 years)
            if (diffYears >= 4.657) {
                const bP = (structure.fixedEarnings?.basicPercentage ?? 0) / 100;
                const dP = (structure.fixedEarnings?.daPercentage ?? 0) / 100;
                const lastBasicDA = (monthlyGross * bP) + (monthlyGross * bP * dP);
                gratuity = Math.round((15 / 26) * lastBasicDA * diffYears);
            }
        }

        const totalPayable = totalHoldAmount + totalUnpaidSalary + totalLeaveEncashment + totalReimbursements + totalOtherAdditions + gratuity;
        // ✅ Include LOP Amount in Total Deductions
        const totalDeductions = noticeRecovery + totalOtherDeductions + professionalTax + providentFund + esi + incomeTax + totalLOPAmount;
        const netAmount = totalPayable - totalDeductions;

        const calculation = {
            holdSalaries: Math.round(totalHoldAmount),
            unpaidSalaries: Math.round(totalUnpaidSalary),
            leaveEncashment: Math.round(totalLeaveEncashment),
            reimbursements: Math.round(totalReimbursements),
            otherAdditions: Math.round(totalOtherAdditions),
            gratuity: Math.round(gratuity),
            totalPayable: Math.round(totalPayable),
            noticePeriodRecovery: Math.round(noticeRecovery),
            professionalTax: Math.round(professionalTax),
            incomeTax: Math.round(incomeTax),
            providentFund: Math.round(providentFund),
            esi: Math.round(esi),
            lopAmount: Math.round(totalLOPAmount), // ✅ Added for consistency with other statutory deductions
            otherDeductions: Math.round(totalOtherDeductions),
            totalDeductions: Math.round(totalDeductions),
            netAmount: Math.round(netAmount),
            isNegative: netAmount < 0
        };
        return reply.send({
            success: true,

            // Root-level summary fields (for UI cards)
            netAmount: calculation.netAmount,
            isNegative: calculation.isNegative,
            totalPayable: calculation.totalPayable,
            totalDeductions: calculation.totalDeductions,

            // Root-level tax fields
            providentFund: calculation.providentFund,
            esi: calculation.esi,
            professionalTax: calculation.professionalTax,
            incomeTax: calculation.incomeTax,
            gratuity: calculation.gratuity,
            lopAmount: calculation.lopAmount, // ✅ Added for consistency

            // Nested details (for tables)
            workDays: {
                holdPayrolls: holdPayrolls,
                unpaidMonths: filteredUnpaidMonths
            },

            // Backward compatibility (keep for now)
            data: calculation,
            finalCalculation: calculation
        });

    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
}
