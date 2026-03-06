import { Schema, model } from 'mongoose';

export interface IDashboardMetrics {
    totalEmployees: number;
    pendingApprovals: {
        leaves: number;
        regularizations: number;
        overtime: number;
        wfh: number;
        total: number;
        byDepartment: Array<{
            departmentId: string;
            count: number;
        }>;
        byType: Array<{
            leaveType: string;
            count: number;
        }>;
    };
    leaveBalances: {
        annual: { alloted: number; availed: number; remaining: number };
        sick: { alloted: number; availed: number; remaining: number };
        compOff: { alloted: number; availed: number; remaining: number };
        lossOfPay: { alloted: number; availed: number; remaining: number };
        otherPaid: { alloted: number; availed: number; remaining: number };
        otherUnpaid: { alloted: number; availed: number; remaining: number };
        maternity: { alloted: number; availed: number; remaining: number };
    };
    payrollProcessed: {
        amount: number;
        count: number;
        totalCTC: number;
        totalDeductions: number;
        totalOvertimePay: number;
        totalBonus: number;
        totalReimbursement: number;
        byStatus: Array<{
            status: string;
            count: number;
            totalAmount: number;
        }>;
    };
    departmentWiseEmployees: Array<{
        departmentId: string;
        departmentName: string;
        count: number;
        employees: Array<{
            name: string;
            email: string;
            role: string;
        }>;
    }>;
    todayAttendance: {
        present: number;
        leave: number;
        absent: number;
        totalActive: number;
    };
    upcomingHolidays: Array<{
        date: Date;
        name: string;
        description?: string;
        type?: string;
    }>;
    resignationStatus: Array<{
        month: string;
        pending: number;
        approved: number;
    }>;
}

// This is a virtual model for aggregation purposes only
const dashboardSchema = new Schema({}, { strict: false });

export const Dashboard = model('Dashboard', dashboardSchema);
