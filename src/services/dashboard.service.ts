import { BaseService } from './base.service';
import { User } from '../models/user.model';
import { Leave } from '../models/leave.model';
import { AttendanceRegularization } from '../models/attendance-regularization.model';
import { Overtime } from '../models/overtime.model';
import { Payroll } from '../models/payrolls.model';
import { HolidayCalendar } from '../models/holiday-calendar.model';
import { AttendanceRecord } from '../models/attendance-record.model';
import { IDashboardMetrics } from '../models/dashboard.model';
import { startOfDay, endOfDay, startOfMonth, addMonths, getYear } from 'date-fns';
import { LeaveSummary } from '../models/leave-summary.model';

export class DashboardService extends BaseService {
    async getDashboardMetrics(): Promise<IDashboardMetrics> {
        const today = new Date();
        const startOfToday = startOfDay(today);
        const endOfToday = endOfDay(today);

        // Get total employees with detailed counts
        const [totalEmployees, employeesByRole] = await Promise.all([
            User.countDocuments({ active: true }),
            User.aggregate([
                { $match: { active: true } },
                {
                    $group: {
                        _id: '$role',
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        console.log('1. Employee Counts:', {
            total: totalEmployees,
            byRole: employeesByRole,
            query: { active: true }
        });

        // Get leave balances for the current year
        const currentYear = getYear(today);
        const leaveBalances = await LeaveSummary.aggregate([
            {
                $match: { year: currentYear }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $match: { 'user.active': true }
            },
            {
                $group: {
                    _id: null,
                    annualAlloted: { $sum: '$annual.alloted' },
                    annualAvailed: { $sum: '$annual.availed' },
                    annualRemaining: { $sum: { $subtract: ['$annual.alloted', '$annual.availed'] } },

                    sickAlloted: { $sum: '$sick.alloted' },
                    sickAvailed: { $sum: '$sick.availed' },
                    sickRemaining: { $sum: { $subtract: ['$sick.alloted', '$sick.availed'] } },

                    compOffAlloted: { $sum: '$compOff.alloted' },
                    compOffAvailed: { $sum: '$compOff.availed' },
                    compOffRemaining: { $sum: { $subtract: ['$compOff.alloted', '$compOff.availed'] } },

                    lossOfPayAlloted: { $sum: '$lossOfPay.alloted' },
                    lossOfPayAvailed: { $sum: '$lossOfPay.availed' },
                    lossOfPayRemaining: { $sum: { $subtract: ['$lossOfPay.alloted', '$lossOfPay.availed'] } },

                    otherPaidAlloted: { $sum: '$otherPaid.alloted' },
                    otherPaidAvailed: { $sum: '$otherPaid.availed' },
                    otherPaidRemaining: { $sum: { $subtract: ['$otherPaid.alloted', '$otherPaid.availed'] } },

                    otherUnpaidAlloted: { $sum: '$otherUnpaid.alloted' },
                    otherUnpaidAvailed: { $sum: '$otherUnpaid.availed' },
                    otherUnpaidRemaining: { $sum: { $subtract: ['$otherUnpaid.alloted', '$otherUnpaid.availed'] } },

                    maternityAlloted: { $sum: { $ifNull: ['$maternity.alloted', 0] } },
                    maternityAvailed: { $sum: { $ifNull: ['$maternity.availed', 0] } },
                    maternityRemaining: {
                        $sum: {
                            $subtract: [
                                { $ifNull: ['$maternity.alloted', 0] },
                                { $ifNull: ['$maternity.availed', 0] }
                            ]
                        }
                    },
                    totalAlloted: {
                        $sum: {
                            $add: [
                                '$annual.alloted',
                                '$sick.alloted',
                                '$compOff.alloted',
                                '$otherPaid.alloted',
                                { $ifNull: ['$maternity.alloted', 0] }
                            ]
                        }
                    },
                    totalAvailed: {
                        $sum: {
                            $add: [
                                '$annual.availed',
                                '$sick.availed',
                                '$compOff.availed',
                                '$otherPaid.availed',
                                { $ifNull: ['$maternity.availed', 0] }
                            ]
                        }
                    }
                }
            }
        ]);

        console.log('2. Leave Balances:', {
            year: currentYear,
            balances: leaveBalances[0] || {
                annual: 0,
                sick: 0,
                compOff: 0,
                lossOfPay: 0,
                otherPaid: 0,
                otherUnpaid: 0,
                totalAlloted: 0,
                totalAvailed: 0
            }
        });

        // Get pending approvals for ACTIVE users only
        const [pendingLeaves, pendingRegularizations, pendingOvertime] = await Promise.all([
            Leave.aggregate([
                { $match: { status: 'Pending' } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' },
                { $match: { 'user.active': true } },
                { $count: 'count' }
            ]).exec().then(res => res[0]?.count || 0),

            AttendanceRegularization.aggregate([
                { $match: { status: 'Pending' } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' },
                { $match: { 'user.active': true } },
                { $count: 'count' }
            ]).exec().then(res => res[0]?.count || 0),

            Overtime.aggregate([
                { $match: { status: 'Pending' } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' },
                { $match: { 'user.active': true } },
                { $count: 'count' }
            ]).exec().then(res => res[0]?.count || 0)
        ]);

        // Get pending approvals by department
        const pendingByDepartment = await Leave.aggregate([
            { $match: { status: 'Pending' } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            { $match: { 'user.active': true } },
            {
                $group: {
                    _id: '$user.departmentId',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get pending approvals by type
        const pendingByType = await Leave.aggregate([
            { $match: { status: 'Pending' } },
            { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $match: { 'user.active': true } },
            {
                $group: {
                    _id: '$leaveType',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        console.log('2. Pending Approvals:', {
            leaves: pendingLeaves,
            regularizations: pendingRegularizations,
            overtime: pendingOvertime,
            total: pendingLeaves + pendingRegularizations + pendingOvertime,
            byDepartment: pendingByDepartment,
            byType: pendingByType
        });

        // First, find the most recent month for which we have payroll data
        const latestPayroll = await Payroll.findOne({
            status: 'Completed'
        }).sort({ year: -1, month: -1 }).select('monthYear').exec();

        const latestMonthYear = latestPayroll ? latestPayroll.monthYear : `${getYear(today)}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        // Get payroll processed with detailed breakdown for the MOST RECENT month only
        const payrollProcessed = await Payroll.aggregate([
            {
                $match: {
                    status: 'Completed',
                    monthYear: latestMonthYear
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$netSalary' },
                    totalCTC: { $sum: '$ctc' },
                    totalDeductions: { $sum: '$totalDeductions' },
                    totalOvertimePay: { $sum: '$overtimePay' },
                    totalBonus: { $sum: '$bonus' },
                    totalReimbursement: { $sum: '$reimbursement' },
                    count: { $sum: 1 },
                    byStatus: {
                        $push: {
                            status: '$status',
                            amount: '$netSalary'
                        }
                    }
                }
            }
        ]).exec();

        // Get payroll by status for the most recent month
        const payrollByStatus = await Payroll.aggregate([
            {
                $match: {
                    monthYear: latestMonthYear
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$netSalary' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        console.log('3. Payroll Processed:', {
            totalAmount: payrollProcessed[0]?.totalAmount || 0,
            totalCTC: payrollProcessed[0]?.totalCTC || 0,
            totalDeductions: payrollProcessed[0]?.totalDeductions || 0,
            totalOvertimePay: payrollProcessed[0]?.totalOvertimePay || 0,
            totalBonus: payrollProcessed[0]?.totalBonus || 0,
            totalReimbursement: payrollProcessed[0]?.totalReimbursement || 0,
            count: payrollProcessed[0]?.count || 0,
            byStatus: payrollByStatus
        });

        // Get department wise employees with detailed breakdown
        const departmentWiseEmployees = await User.aggregate([
            { $match: { active: true } },
            {
                $group: {
                    _id: '$departmentId',
                    count: { $sum: 1 },
                    employees: {
                        $push: {
                            name: '$name',
                            email: '$email',
                            role: '$role'
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'lovs',
                    let: { deptId: '$_id' },
                    pipeline: [
                        { $match: { type: 'department' } },
                        { $unwind: '$values' },
                        { $match: { 'values.value': '$$deptId' } },
                        { $limit: 1 }
                    ],
                    as: 'departmentInfo'
                }
            },
            {
                $addFields: {
                    departmentId: '$_id',
                    departmentName: {
                        $cond: {
                            if: { $gt: [{ $size: '$departmentInfo' }, 0] },
                            then: { $arrayElemAt: ['$departmentInfo.values.label', 0] },
                            else: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$_id', 'dept001'] }, then: 'IT Department' },
                                        { case: { $eq: ['$_id', 'dept002'] }, then: 'HR Department' },
                                        { case: { $eq: ['$_id', 'dept003'] }, then: 'Finance Department' },
                                        { case: { $eq: ['$_id', 'dept004'] }, then: 'Marketing Department' },
                                        { case: { $eq: ['$_id', 'dept005'] }, then: 'Operations Department' },
                                        { case: { $eq: ['$_id', 'dept006'] }, then: 'Sales Department' },
                                        { case: { $eq: ['$_id', 'dept007'] }, then: 'Engineering Department' }
                                    ],
                                    default: { $concat: ['Department ', { $toString: '$_id' }] }
                                }
                            }
                        }
                    }
                }
            },
            {
                $project: {
                    departmentId: 1,
                    departmentName: 1,
                    count: 1,
                    employees: 1,
                    _id: 0
                }
            },
            { $sort: { count: -1 } }
        ]).exec();

        console.log('4. Department Wise Employees:', {
            totalDepartments: departmentWiseEmployees.length,
            totalEmployees: departmentWiseEmployees.reduce((sum, dept) => sum + dept.count, 0),
            departments: departmentWiseEmployees
        });

        // Get today's attendance and leave status for active employees only
        const [todayAttendance, todayLeaves] = await Promise.all([
            AttendanceRecord.aggregate([
                {
                    $match: {
                        shiftDay: {
                            $gte: startOfToday,
                            $lte: endOfToday
                        },
                        $or: [
                            { swipes: { $exists: true, $not: { $size: 0 } } },
                            { firstIn: { $ne: null } },
                            { attendanceStatus: { $in: ['Present', 'On-Time', 'Late', 'Early-Exit'] } }
                        ]
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                { $match: { 'user.active': true } },
                {
                    $group: {
                        _id: '$userId'
                    }
                },
                {
                    $count: 'count'
                }
            ]).exec(),

            Leave.aggregate([
                {
                    $match: {
                        status: 'Approved',
                        startDate: { $lte: endOfToday },
                        endDate: { $gte: startOfToday }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                { $match: { 'user.active': true } },
                {
                    $group: {
                        _id: '$userId'
                    }
                },
                {
                    $count: 'count'
                }
            ]).exec()
        ]);

        // Get total active employees for comparison
        const totalActiveEmployees = await User.countDocuments({ active: true });

        const presentCount = todayAttendance[0]?.count || 0;
        const leaveCount = todayLeaves[0]?.count || 0;
        const absentCount = Math.max(0, totalActiveEmployees - presentCount - leaveCount);

        console.log('5. Today Attendance:', {
            present: presentCount,
            leave: leaveCount,
            absent: absentCount,
            totalActive: totalActiveEmployees,
            date: today.toISOString(),
            startOfToday: startOfToday.toISOString(),
            endOfToday: endOfToday.toISOString()
        });

        // Get upcoming holidays
        const upcomingHolidays = await HolidayCalendar.aggregate([
            { $unwind: "$holidays" },
            {
                $match: {
                    "holidays.date": { $gte: today }
                }
            },
            { $sort: { "holidays.date": 1 } },
            { $limit: 20 },
            {
                $project: {
                    date: "$holidays.date",
                    name: "$holidays.name",
                    description: "$holidays.description"
                }
            }
        ]);

        console.log('6. Upcoming Holidays:', upcomingHolidays);

        // Get resignation status for last 6 months
        const sixMonthsAgo = startOfMonth(addMonths(today, -5));
        console.log('7. Date Range for Resignations:', {
            from: sixMonthsAgo.toISOString(),
            to: today.toISOString()
        });

        const resignationStatus = await User.aggregate([
            {
                $match: {
                    'resignations.submittedAt': { $gte: sixMonthsAgo },
                    'resignations.isActive': true
                }
            },
            {
                $unwind: '$resignations'
            },
            {
                $match: {
                    'resignations.submittedAt': { $gte: sixMonthsAgo },
                    'resignations.isActive': true,
                    'resignations.status': { $in: ['Pending', 'Approved'] }
                }
            },
            {
                $group: {
                    _id: {
                        month: { $dateToString: { format: '%Y-%m', date: '$resignations.submittedAt' } },
                        status: '$resignations.status'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.month',
                    statuses: {
                        $push: {
                            status: '$_id.status',
                            count: '$count'
                        }
                    }
                }
            },
            {
                $project: {
                    month: '$_id',
                    pending: {
                        $reduce: {
                            input: '$statuses',
                            initialValue: 0,
                            in: {
                                $cond: [
                                    { $eq: ['$$this.status', 'Pending'] },
                                    '$$this.count',
                                    '$$value'
                                ]
                            }
                        }
                    },
                    approved: {
                        $reduce: {
                            input: '$statuses',
                            initialValue: 0,
                            in: {
                                $cond: [
                                    { $eq: ['$$this.status', 'Approved'] },
                                    '$$this.count',
                                    '$$value'
                                ]
                            }
                        }
                    }
                }
            },
            { $sort: { month: 1 } }
        ]).exec();

        console.log('8. Resignation Status by Month:', resignationStatus);

        // Prepare pending approvals object
        const pendingApprovalsData = {
            leaves: pendingLeaves,
            regularizations: pendingRegularizations,
            overtime: pendingOvertime,
            total: pendingLeaves + pendingRegularizations + pendingOvertime,
            byDepartment: pendingByDepartment.map(dept => ({
                departmentId: dept._id,
                count: dept.count
            })),
            byType: pendingByType.map(type => ({
                leaveType: type._id,
                count: type.count
            }))
        };

        // Prepare payroll processed object
        const payrollProcessedData = {
            amount: payrollProcessed[0]?.totalAmount || 0,
            count: payrollProcessed[0]?.count || 0,
            totalCTC: payrollProcessed[0]?.totalCTC || 0,
            totalDeductions: payrollProcessed[0]?.totalDeductions || 0,
            totalOvertimePay: payrollProcessed[0]?.totalOvertimePay || 0,
            totalBonus: payrollProcessed[0]?.totalBonus || 0,
            totalReimbursement: payrollProcessed[0]?.totalReimbursement || 0,
            byStatus: payrollByStatus.map(status => ({
                status: status._id,
                count: status.count,
                totalAmount: status.totalAmount
            }))
        };

        // Prepare today's attendance object
        const todayAttendanceData = {
            present: presentCount,
            leave: leaveCount,
            absent: absentCount,
            totalActive: totalActiveEmployees
        };

        // Prepare upcoming holidays array
        const upcomingHolidaysData = upcomingHolidays.map(holiday => ({
            date: holiday.date,
            name: holiday.name,
            description: holiday.description
        }));

        // Prepare leave balances data
        const leaveBalancesData = leaveBalances[0] || {
            annualAlloted: 0, annualAvailed: 0, annualRemaining: 0,
            sickAlloted: 0, sickAvailed: 0, sickRemaining: 0,
            compOffAlloted: 0, compOffAvailed: 0, compOffRemaining: 0,
            lossOfPayAlloted: 0, lossOfPayAvailed: 0, lossOfPayRemaining: 0,
            otherPaidAlloted: 0, otherPaidAvailed: 0, otherPaidRemaining: 0,
            otherUnpaidAlloted: 0, otherUnpaidAvailed: 0, otherUnpaidRemaining: 0,
            maternityAlloted: 0, maternityAvailed: 0, maternityRemaining: 0,
            totalAlloted: 0,
            totalAvailed: 0
        };

        const dashboardMetrics: IDashboardMetrics = {
            totalEmployees,
            pendingApprovals: pendingApprovalsData,
            leaveBalances: {
                annual: {
                    alloted: leaveBalancesData.annualAlloted || 0,
                    availed: leaveBalancesData.annualAvailed || 0,
                    remaining: leaveBalancesData.annualRemaining || 0
                },
                sick: {
                    alloted: leaveBalancesData.sickAlloted || 0,
                    availed: leaveBalancesData.sickAvailed || 0,
                    remaining: leaveBalancesData.sickRemaining || 0
                },
                compOff: {
                    alloted: leaveBalancesData.compOffAlloted || 0,
                    availed: leaveBalancesData.compOffAvailed || 0,
                    remaining: leaveBalancesData.compOffRemaining || 0
                },
                lossOfPay: {
                    alloted: leaveBalancesData.lossOfPayAlloted || 0,
                    availed: leaveBalancesData.lossOfPayAvailed || 0,
                    remaining: leaveBalancesData.lossOfPayRemaining || 0
                },
                otherPaid: {
                    alloted: leaveBalancesData.otherPaidAlloted || 0,
                    availed: leaveBalancesData.otherPaidAvailed || 0,
                    remaining: leaveBalancesData.otherPaidRemaining || 0
                },
                otherUnpaid: {
                    alloted: leaveBalancesData.otherUnpaidAlloted || 0,
                    availed: leaveBalancesData.otherUnpaidAvailed || 0,
                    remaining: leaveBalancesData.otherUnpaidRemaining || 0
                },
                maternity: {
                    alloted: leaveBalancesData.maternityAlloted || 0,
                    availed: leaveBalancesData.maternityAvailed || 0,
                    remaining: leaveBalancesData.maternityRemaining || 0
                }
            },
            payrollProcessed: payrollProcessedData,
            departmentWiseEmployees,
            todayAttendance: todayAttendanceData,
            upcomingHolidays: upcomingHolidaysData,
            resignationStatus
        };

        console.log('🎯 FINAL ADMIN DASHBOARD METRICS:');
        console.log('📊 Total Employees:', totalEmployees);
        console.log('⏳ Pending Approvals:', pendingApprovalsData);
        console.log('🏖️ Leave Balances:', {
            annual: dashboardMetrics.leaveBalances.annual,
            sick: dashboardMetrics.leaveBalances.sick,
            compOff: dashboardMetrics.leaveBalances.compOff
        });
        console.log('💰 Payroll Processed:', payrollProcessedData);
        console.log('🏢 Department Employees:', departmentWiseEmployees.length, 'departments');
        console.log('📅 Today Attendance:', todayAttendanceData);
        console.log('🎉 Upcoming Holidays:', upcomingHolidaysData.length, 'holidays');
        console.log('📤 Resignation Status:', resignationStatus.length, 'months');
        console.log('🔍 COMPLETE ADMIN DATA:', JSON.stringify(dashboardMetrics, null, 2));

        return dashboardMetrics;
    }

    async getManagerDashboardData(managerId: any) {
        const today = new Date();
        const startOfToday = startOfDay(today);
        const endOfToday = endOfDay(today);

        console.log('Manager Dashboard - Manager ID:', managerId);
        console.log('Manager Dashboard - Date Range:', { startOfToday, endOfToday });

        // Get all employees under this manager
        const teamEmployees = await User.find({
            managerId: managerId,
            active: true
        }).select('_id name email role departmentId biometricId');

        console.log('Team Employees Count:', teamEmployees.length);

        if (teamEmployees.length === 0) {
            console.log('No employees found under this manager');
            return {
                teamOverview: {
                    totalEmployees: 0,
                    employeesOnLeaveToday: 0,
                    pendingApprovals: 0
                },
                attendanceSummary: {
                    present: 0,
                    onLeave: 0,
                    absent: 0,
                    unknown: 0,
                    total: 0
                },
                attendanceStatus: {
                    onTime: 0,
                    late: 0,
                    earlyExit: 0
                },
                pendingApprovals: {
                    leaves: 0,
                    regularizations: 0,
                    overtime: 0,
                    resignations: 0
                },
                employees: []
            };
        }

        const employeeIds = teamEmployees.map(emp => emp._id);

        // Get today's attendance records for team members
        const todayAttendanceRecords = await AttendanceRecord.find({
            userId: { $in: employeeIds },
            shiftDay: {
                $gte: startOfToday,
                $lte: endOfToday
            }
        }).populate('userId', 'name email role departmentId');

        console.log('Today Attendance Records Count:', todayAttendanceRecords.length);

        // Get today's approved leaves for team members
        const todayLeaves = await Leave.find({
            userId: { $in: employeeIds },
            status: 'Approved',
            startDate: { $lte: endOfToday },
            endDate: { $gte: startOfToday }
        }).populate('userId', 'name email role departmentId');

        console.log('Today Leaves Count:', todayLeaves.length);

        // Get pending approvals
        const [pendingLeaves, pendingRegularizations, pendingOvertime, pendingResignations] = await Promise.all([
            Leave.countDocuments({
                userId: { $in: employeeIds },
                status: 'Pending'
            }),
            AttendanceRegularization.countDocuments({
                userId: { $in: employeeIds },
                status: 'Pending'
            }),
            Overtime.countDocuments({
                userId: { $in: employeeIds },
                status: 'Pending'
            }),
            User.countDocuments({
                _id: { $in: employeeIds },
                'resignations.status': 'Pending',
                'resignations.isActive': true
            })
        ]);

        console.log('Pending Approvals:', {
            leaves: pendingLeaves,
            regularizations: pendingRegularizations,
            overtime: pendingOvertime,
            resignations: pendingResignations
        });

        // Process attendance data
        const attendanceMap = new Map();

        // Initialize attendance map with all employees
        teamEmployees.forEach(emp => {
            attendanceMap.set(emp._id.toString(), {
                _id: emp._id,
                name: emp.name,
                email: emp.email,
                role: emp.role,
                departmentId: emp.departmentId,
                attendanceStatus: 'unknown',
                attendanceType: 'unknown',
                checkInTime: null,
                checkOutTime: null,
                isOnLeave: false,
                leaveType: null,
                shiftCode: null
            });
        });

        // Process attendance records
        todayAttendanceRecords.forEach((record: any) => {
            const userId = record.userId._id.toString();
            const employee = attendanceMap.get(userId);

            if (employee) {
                employee.attendanceStatus = this.getAttendanceStatus(record);
                employee.attendanceType = this.getAttendanceType(record);
                employee.checkInTime = record.firstIn ? record.firstIn.toISOString() : null;
                employee.checkOutTime = record.lastOut ? record.lastOut.toISOString() : null;
                employee.shiftCode = record.shiftCode;
            }
        });

        // Process leave records
        todayLeaves.forEach((leave: any) => {
            const userId = leave.userId._id.toString();
            const employee = attendanceMap.get(userId);

            if (employee) {
                employee.attendanceStatus = 'onLeave';
                employee.attendanceType = 'leave';
                employee.isOnLeave = true;
                employee.leaveType = leave.leaveType?.value || 'Unknown';
            }
        });

        // Calculate counts
        const attendanceSummary = {
            present: 0,
            onLeave: 0,
            absent: 0,
            unknown: 0,
            total: teamEmployees.length
        };

        const attendanceStatus = {
            onTime: 0,
            late: 0,
            earlyExit: 0
        };

        attendanceMap.forEach(employee => {
            switch (employee.attendanceStatus) {
                case 'present':
                    attendanceSummary.present++;
                    break;
                case 'onLeave':
                    attendanceSummary.onLeave++;
                    break;
                case 'absent':
                    attendanceSummary.absent++;
                    break;
                default:
                    attendanceSummary.unknown++;
            }

            // Count attendance types
            if (employee.attendanceType === 'onTime') {
                attendanceStatus.onTime++;
            } else if (employee.attendanceType === 'late') {
                attendanceStatus.late++;
            } else if (employee.attendanceType === 'earlyExit') {
                attendanceStatus.earlyExit++;
            }
        });

        // Mark employees as absent if they have no attendance record and no leave
        attendanceMap.forEach(employee => {
            if (employee.attendanceStatus === 'unknown' && !employee.isOnLeave) {
                employee.attendanceStatus = 'absent';
                employee.attendanceType = 'absent';
                attendanceSummary.unknown--;
                attendanceSummary.absent++;
            }
        });

        console.log('Attendance Summary:', attendanceSummary);
        console.log('Attendance Status:', attendanceStatus);

        const managerDashboardData = {
            teamOverview: {
                totalEmployees: teamEmployees.length,
                employeesOnLeaveToday: attendanceSummary.onLeave,
                pendingApprovals: pendingLeaves + pendingRegularizations + pendingOvertime + pendingResignations
            },
            attendanceSummary,
            attendanceStatus,
            pendingApprovals: {
                leaves: pendingLeaves,
                regularizations: pendingRegularizations,
                overtime: pendingOvertime,
                resignations: pendingResignations
            },
            employees: Array.from(attendanceMap.values())
        };

        console.log('🎯 FINAL MANAGER DASHBOARD METRICS:');
        console.log('👥 Team Overview:', managerDashboardData.teamOverview);
        console.log('📊 Attendance Summary:', managerDashboardData.attendanceSummary);
        console.log('⏰ Attendance Status:', managerDashboardData.attendanceStatus);
        console.log('⏳ Pending Approvals:', managerDashboardData.pendingApprovals);
        console.log('👨‍💼 Team Members:', managerDashboardData.employees.length, 'employees');
        console.log('🔍 COMPLETE MANAGER DATA:', JSON.stringify(managerDashboardData, null, 2));

        return managerDashboardData;
    }

    private getAttendanceStatus(record: any): string {
        // If they have explicit statuses marking them as present/late/etc
        if (record.attendanceStatus && record.attendanceStatus.length > 0) {
            if (record.attendanceStatus.some((s: string) => ['Present', 'On-Time', 'Late', 'Early-Exit'].includes(s))) {
                return 'present';
            } else if (record.attendanceStatus.includes('On-Leave')) {
                return 'onLeave';
            } else if (record.attendanceStatus.includes('Absent')) {
                return 'absent';
            }
        }

        // Fallback: If they have ANY swipes today or a first punch-in time, they are present today
        if ((record.swipes && record.swipes.length > 0) || record.firstIn) {
            return 'present';
        }

        return 'unknown';
    }

    private getAttendanceType(record: any): string {
        if (record.attendanceStatus && record.attendanceStatus.length > 0) {
            if (record.attendanceStatus.includes('On-Time')) {
                return 'onTime';
            } else if (record.attendanceStatus.includes('Late')) {
                return 'late';
            } else if (record.attendanceStatus.includes('Early-Exit')) {
                return 'earlyExit';
            }
        }

        // Fallback based on isLateEntry and isEarlyExit flags
        if (record.isLateEntry) {
            return 'late';
        } else if (record.isEarlyExit) {
            return 'earlyExit';
        } else if (record.swipes && record.swipes.length >= 2) {
            return 'onTime';
        }

        return 'unknown';
    }
}
