import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { LeaveRelease, ILeaveRelease } from '../models/leave-release.model';
import { LeaveSummaryService } from './leave-summary.service';
import { User } from '../models';
import { Types } from 'mongoose';
import { emailService } from './email.service';
import { generateEmailTemplate } from '../emails/templates';

export interface ILeaveReleaseCreate {
  employeeIds: string[]; // Array of employee IDs
  releaseType: 'monthly' | 'quarterly';
  period: {
    month?: number;    // 1-12 (required for monthly)
    quarter?: number;  // 1-4 (required for quarterly: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
    year: number;
  };
  leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
  daysReleased: number; // Can be decimal (e.g., 4.5)
  notes?: string;
}

export class LeaveReleaseService extends BaseService {
  private leaveSummaryService: LeaveSummaryService;

  constructor(context: RequestContext) {
    super(context);
    this.leaveSummaryService = new LeaveSummaryService(context);
  }

  /**
   * Release leaves to one or multiple employees (India only)
   * Adds to existing leave balance
   */
  async releaseLeaves(releaseData: ILeaveReleaseCreate): Promise<{
    success: number;
    failed: Array<{ employeeId: string; error: string }>;
    releases: ILeaveRelease[];
  }> {
    const { employeeIds, releaseType, period, leaveType, daysReleased, notes } = releaseData;
    const releasedBy = this.context.user?._id;

    if (!releasedBy) {
      throw new Error('User not authenticated');
    }

    // Validate period
    if (releaseType === 'monthly' && !period.month) {
      throw new Error('Month is required for monthly release');
    }
    if (releaseType === 'quarterly' && !period.quarter) {
      throw new Error('Quarter is required for quarterly release');
    }
    if (daysReleased <= 0) {
      throw new Error('daysReleased must be greater than 0');
    }

    const success: string[] = [];
    const failed: Array<{ employeeId: string; error: string }> = [];
    const releases: ILeaveRelease[] = [];

    // Process each employee
    for (const employeeId of employeeIds) {
      try {
        // Check if employee is from India
        const employee = await User.findById(employeeId).select('country name email');
        if (!employee) {
          failed.push({ employeeId, error: 'Employee not found' });
          continue;
        }

        if (employee.country !== 'IN') {
          failed.push({ employeeId, error: 'Leave releases are only available for India employees' });
          continue;
        }

        // Get current leave summary for the year
        const currentSummary = await this.leaveSummaryService.getLeaveSummary(
          new Types.ObjectId(employeeId),
          period.year
        );

        // Get current allotted balance
        const currentAlloted = currentSummary[leaveType as keyof typeof currentSummary]?.alloted || 0;

        // Add daysReleased to existing balance
        const newAlloted = currentAlloted + daysReleased;

        // Update leave summary - ADD to existing balance
        await this.leaveSummaryService.updateLeaveAllotments(
          new Types.ObjectId(employeeId),
          period.year,
          {
            [leaveType]: newAlloted
          }
        );

        // Create leave release record
        const release = await LeaveRelease.create({
          employeeId: new Types.ObjectId(employeeId),
          releaseType,
          period,
          leaveType,
          daysReleased,
          releasedBy,
          notes
        });

        releases.push(release);
        success.push(employeeId);

        // Send email notification to employee
        try {
          const periodDescription = releaseType === 'monthly'
            ? `${this.getMonthName(period.month!)} ${period.year}`
            : `Q${period.quarter} ${period.year}`;

          const html = generateEmailTemplate('leaveBalanceAllotmentEmail', {
            userName: employee.name,
            year: period.year,
            releaseInfo: `${daysReleased} days released for ${periodDescription}`,
            leaveType,
            companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS'
          });

          await emailService.sendEmail({
            body: {
              to: employee.email,
              subject: `Leave Released: ${daysReleased} days for ${periodDescription}`,
              text: `Dear ${employee.name},\n\n${daysReleased} days of ${leaveType} leave have been released for ${periodDescription}. Your new balance has been updated.\n\nRegards,\n${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`,
              html
            }
          });
        } catch (emailError) {
          console.error(`Failed to send email to ${employee.email}:`, emailError);
          // Don't fail the release if email fails
        }

      } catch (error: any) {
        console.error(`Failed to release leave for employee ${employeeId}:`, error);
        failed.push({ employeeId, error: error.message || 'Unknown error' });
      }
    }

    return {
      success: success.length,
      failed,
      releases
    };
  }

  /**
   * Get leave release history for an employee
   */
  async getReleaseHistory(
    employeeId: string,
    year?: number
  ): Promise<ILeaveRelease[]> {
    const query: any = {
      employeeId: new Types.ObjectId(employeeId)
    };

    if (year) {
      query['period.year'] = year;
    }

    return await LeaveRelease.find(query)
      .populate('releasedBy', 'name email')
      .sort({ releasedAt: -1 })
      .lean();
  }

  /**
   * Helper: Get month name from number
   */
  private getMonthName(month: number): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[month - 1] || '';
  }

  /**
   * Get quarterly months mapping
   */
  getQuarterlyMonths(quarter: number): number[] {
    const quarterMap: { [key: number]: number[] } = {
      1: [1, 2, 3],   // Q1: Jan, Feb, Mar
      2: [4, 5, 6],   // Q2: Apr, May, Jun
      3: [7, 8, 9],   // Q3: Jul, Aug, Sep
      4: [10, 11, 12] // Q4: Oct, Nov, Dec
    };
    return quarterMap[quarter] || [];
  }
}

