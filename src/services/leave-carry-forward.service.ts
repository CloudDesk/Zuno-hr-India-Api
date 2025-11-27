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

    // IMPORTANT: Subtract carried forward days from FROM year's remaining balance
    // We do this by reducing 'alloted' in the FROM year
    // This way: remaining = alloted - availed will automatically decrease
    // And 'availed' stays accurate (only actual leave days, not administrative operations)
    const fromYearCategory = fromYearSummary[leaveType as keyof typeof fromYearSummary];
    const currentFromYearAlloted = fromYearCategory?.alloted || 0;

    // Update FROM year: reduce alloted by carried forward days
    // This will make remaining = (alloted - daysCarriedForward) - availed
    // So remaining decreases by daysCarriedForward without affecting availed
    await this.leaveSummaryService.updateLeaveAllotments(
      new Types.ObjectId(employeeId),
      fromYear,
      {
        [leaveType]: currentFromYearAlloted - daysCarriedForward
      }
    );

    // Verify FROM year's alloted and remaining balance were correctly updated
    const updatedFromYearSummary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      fromYear
    );
    const updatedFromYearCategory = updatedFromYearSummary[leaveType as keyof typeof updatedFromYearSummary];
    const expectedFromYearAlloted = currentFromYearAlloted - daysCarriedForward;
    const expectedFromYearRemaining = balanceBefore - daysCarriedForward;

    // Verify alloted was reduced correctly
    if (Math.abs((updatedFromYearCategory?.alloted || 0) - expectedFromYearAlloted) > 0.01) {
      console.warn(`Carry forward FROM year alloted mismatch. Expected: ${expectedFromYearAlloted}, Got: ${updatedFromYearCategory?.alloted}.`);
    }

    // Verify remaining balance was correctly updated (should be auto-calculated: alloted - availed)
    if (Math.abs((updatedFromYearCategory?.remaining || 0) - expectedFromYearRemaining) > 0.01) {
      console.warn(`Carry forward FROM year remaining balance mismatch. Expected: ${expectedFromYearRemaining}, Got: ${updatedFromYearCategory?.remaining}. This may be recalculated on next save.`);
    }

    // Get next year's leave summary
    const toYearSummary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      toYear
    );

    const toYearCategory = toYearSummary[leaveType as keyof typeof toYearSummary];
    const currentToYearAlloted = toYearCategory?.alloted || 0;

    // Carry forward logic:
    // When 5 days are carried forward from 2024 (remaining: 10) to 2025:
    // 
    // FROM YEAR (2024):
    // - Original: alloted = 20, availed = 10, remaining = 10
    // - After carry-forward: alloted = 20 - 5 = 15, availed = 10, remaining = 5
    // - We reduce 'alloted' (not 'availed') to keep availed accurate for reports
    // - The 5 days are subtracted from 2024's quota
    // 
    // TO YEAR (2025):
    // - Original: alloted = 20, availed = 0, remaining = 20
    // - After carry-forward: alloted = 20 + 5 = 25, remaining = 25 - availed
    // - The 5 days are added to 2025's allotted quota
    // 
    // Example:
    // 2024: alloted = 20, remaining = 10, carry forward 5 → alloted = 15, remaining = 5
    // 2025: alloted = 20, carry forward 5 → alloted = 25
    // 
    // Result: Employee has 5 less days quota in 2024, 5 more days quota in 2025
    // Note: 'availed' stays accurate (only actual leave days, not administrative operations)

    // Add carried forward days to next year's allotted
    // This increases the remaining balance: remaining = alloted - availed
    const finalAlloted = currentToYearAlloted + daysCarriedForward;

    // Update allotted - pre-save hook will recalculate remaining
    // remaining = alloted - availed = finalAlloted - availed
    // This gives employee access to: (original quota - carried forward) + carried forward = original quota + carried forward
    await this.leaveSummaryService.updateLeaveAllotments(
      new Types.ObjectId(employeeId),
      toYear,
      {
        [leaveType]: finalAlloted
      }
    );

    // Verify the update was successful and remaining balance includes carried forward days
    const updatedSummary = await this.leaveSummaryService.getLeaveSummary(
      new Types.ObjectId(employeeId),
      toYear
    );

    const updatedCategory = updatedSummary[leaveType as keyof typeof updatedSummary];
    if (!updatedCategory) {
      throw new Error(`Failed to retrieve updated leave summary for ${leaveType}`);
    }

    // Verify allotted was updated correctly
    // Should be: (original - carried forward) + carried forward = original + carried forward
    if (updatedCategory.alloted !== finalAlloted) {
      throw new Error(`Failed to update leave summary for carry forward. Expected alloted: ${finalAlloted}, Got: ${updatedCategory.alloted}`);
    }

    // Verify remaining balance includes carried forward days
    // remaining = alloted - availed = (original + carried forward) - availed
    const expectedRemaining = finalAlloted - (updatedCategory.availed || 0);
    if (Math.abs(updatedCategory.remaining - expectedRemaining) > 0.01) {
      console.warn(`Carry forward remaining balance mismatch. Expected: ${expectedRemaining}, Got: ${updatedCategory.remaining}. This may be recalculated on next save.`);
    }

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

