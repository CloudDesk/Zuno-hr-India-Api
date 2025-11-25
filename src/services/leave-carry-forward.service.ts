import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { LeaveCarryForward, ILeaveCarryForward } from '../models/leave-carry-forward.model';
import { LeaveSummaryService } from './leave-summary.service';
import { User } from '../models';
import { Types } from 'mongoose';
import { emailService } from './email.service';
import { generateEmailTemplate } from '../emails/templates';

export interface ILeaveCarryForwardRequest {
  employeeId: string;
  fromYear: number;
  toYear: number;
  leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
  daysCarriedForward: number; // Admin-specified amount (can be decimal)
  notes?: string;
}

export interface IBatchCarryForwardRequest {
  employees: Array<{
    employeeId: string;
    leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
    daysCarriedForward: number;
  }>;
  fromYear: number;
  toYear: number;
  notes?: string;
}

export class LeaveCarryForwardService extends BaseService {
  private leaveSummaryService: LeaveSummaryService;

  constructor(context: RequestContext) {
    super(context);
    this.leaveSummaryService = new LeaveSummaryService(context);
  }

  /**
   * Process carry-forward for a single employee (India only)
   */
  async processCarryForward(carryForwardData: ILeaveCarryForwardRequest): Promise<ILeaveCarryForward> {
    const { employeeId, fromYear, toYear, leaveType, daysCarriedForward, notes } = carryForwardData;
    const processedBy = this.context.user?._id;

    if (!processedBy) {
      throw new Error('User not authenticated');
    }

    // Validate years
    if (toYear !== fromYear + 1) {
      throw new Error('toYear must be fromYear + 1');
    }

    // Check if employee is from India
    const employee = await User.findById(employeeId).select('country name email');
    if (!employee) {
      throw new Error('Employee not found');
    }

    if (employee.country !== 'IN') {
      throw new Error('Leave carry-forward is only available for India employees');
    }

    // Get leave summary for fromYear
    const fromYearSummary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      fromYear
    );

    const category = fromYearSummary[leaveType as keyof typeof fromYearSummary];
    if (!category) {
      throw new Error(`Leave type ${leaveType} not found`);
    }

    const balanceBefore = category.remaining || 0;

    // Validate carry-forward amount
    // Rule 1: Cannot carry forward if employee has 0 balance
    if (balanceBefore <= 0) {
      throw new Error(`Cannot carry forward ${leaveType} leave. Employee has no remaining balance (${balanceBefore} days).`);
    }

    // Rule 2: Cannot carry forward negative amount
    if (daysCarriedForward < 0) {
      throw new Error('Days to carry forward cannot be negative');
    }

    // Rule 3: Cannot carry forward zero amount (must be > 0)
    if (daysCarriedForward === 0) {
      throw new Error('Days to carry forward must be greater than 0');
    }

    // Rule 4: Cannot carry forward more than available balance
    // Example: If balance is 10, cannot enter 15
    if (daysCarriedForward > balanceBefore) {
      throw new Error(`Cannot carry forward ${daysCarriedForward} days. Employee only has ${balanceBefore} days remaining balance for ${leaveType} leave.`);
    }

    // Check if already processed
    const existing = await LeaveCarryForward.findOne({
      employeeId: new Types.ObjectId(employeeId),
      fromYear,
      toYear,
      leaveType
    });

    if (existing) {
      throw new Error(`Carry-forward already processed for ${leaveType} from ${fromYear} to ${toYear}`);
    }

    const daysForfeited = balanceBefore - daysCarriedForward;

    // Create carry-forward record
    const carryForward = await LeaveCarryForward.create({
      employeeId: new Types.ObjectId(employeeId),
      fromYear,
      toYear,
      leaveType,
      balanceBefore,
      daysCarriedForward,
      daysForfeited,
      processedBy,
      notes
    });

    // Add carried-forward days to next year's leave summary
    const toYearSummary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      toYear
    );

    const toYearCategory = toYearSummary[leaveType as keyof typeof toYearSummary];
    const currentToYearAlloted = toYearCategory?.alloted || 0;

    // Add carry-forward to existing allotted balance
    await this.leaveSummaryService.updateLeaveAllotments(
      new Types.ObjectId(employeeId),
      toYear,
      {
        [leaveType]: currentToYearAlloted + daysCarriedForward
      }
    );

    // Send email notification
    try {
      const emailParams: Record<string, string | number | boolean> = {
        userName: employee.name,
        year: toYear,
        carryForwardInfo: `${daysCarriedForward} days carried forward from ${fromYear}`,
        leaveType,
        companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS'
      };
      
      // Only include forfeitedDays if there are forfeited days (never set to null)
      if (daysForfeited > 0) {
        emailParams.forfeitedDays = `${daysForfeited} days forfeited`;
      }
      
      const html = generateEmailTemplate('leaveBalanceAllotmentEmail', emailParams);

      await emailService.sendEmail({
        body: {
          to: employee.email,
          subject: `Leave Carry-Forward Processed: ${daysCarriedForward} days for ${toYear}`,
          text: `Dear ${employee.name},\n\n${daysCarriedForward} days of ${leaveType} leave have been carried forward from ${fromYear} to ${toYear}.${daysForfeited > 0 ? ` ${daysForfeited} days were forfeited.` : ''}\n\nRegards,\n${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`,
          html
        }
      });
    } catch (emailError) {
      console.error(`Failed to send email to ${employee.email}:`, emailError);
      // Don't fail the carry-forward if email fails
    }

    return carryForward;
  }

  /**
   * Batch process carry-forward for multiple employees (India only)
   */
  async batchProcessCarryForward(batchData: IBatchCarryForwardRequest): Promise<{
    success: number;
    failed: Array<{ employeeId: string; leaveType: string; error: string }>;
    carryForwards: ILeaveCarryForward[];
  }> {
    const { employees, fromYear, toYear, notes } = batchData;

    // Validate years
    if (toYear !== fromYear + 1) {
      throw new Error('toYear must be fromYear + 1');
    }

    const success: string[] = [];
    const failed: Array<{ employeeId: string; leaveType: string; error: string }> = [];
    const carryForwards: ILeaveCarryForward[] = [];

    for (const emp of employees) {
      try {
        const carryForward = await this.processCarryForward({
          employeeId: emp.employeeId,
          fromYear,
          toYear,
          leaveType: emp.leaveType,
          daysCarriedForward: emp.daysCarriedForward,
          notes
        });
        carryForwards.push(carryForward);
        success.push(emp.employeeId);
      } catch (error: any) {
        failed.push({
          employeeId: emp.employeeId,
          leaveType: emp.leaveType,
          error: error.message || 'Unknown error'
        });
      }
    }

    return {
      success: success.length,
      failed,
      carryForwards
    };
  }

  /**
   * Get carry-forward details for an employee
   */
  async getCarryForwardDetails(
    employeeId: string,
    fromYear?: number,
    toYear?: number
  ): Promise<ILeaveCarryForward[]> {
    const query: any = {
      employeeId: new Types.ObjectId(employeeId)
    };

    if (fromYear) {
      query.fromYear = fromYear;
    }
    if (toYear) {
      query.toYear = toYear;
    }

    return await LeaveCarryForward.find(query)
      .populate('processedBy', 'name email')
      .sort({ fromYear: -1 })
      .lean();
  }

  /**
   * Get available balance for carry-forward (end of year balance)
   */
  async getAvailableBalanceForCarryForward(
    employeeId: string,
    year: number
  ): Promise<{
    annual?: number;
    sick?: number;
    compOff?: number;
    lossOfPay?: number;
    otherPaid?: number;
    otherUnpaid?: number;
  }> {
    const summary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      year
    );

    return {
      annual: summary.annual?.remaining || 0,
      sick: summary.sick?.remaining || 0,
      compOff: summary.compOff?.remaining || 0,
      lossOfPay: summary.lossOfPay?.remaining || 0,
      otherPaid: summary.otherPaid?.remaining || 0,
      otherUnpaid: summary.otherUnpaid?.remaining || 0
    };
  }
}

