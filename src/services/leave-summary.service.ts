import { Types } from 'mongoose';
import { LeaveSummary, ILeaveSummary } from '../models/leave-summary.model';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { User } from '../models';
import { emailService } from './email.service';
import { generateEmailTemplate } from '../emails/templates';

export class LeaveSummaryService extends BaseService {
  constructor(context: RequestContext) {
    super(context);
  }
  async createOrUpdateLeaveSummary(
    userId: Types.ObjectId,
    year: number,
    categoryType: keyof ILeaveSummary,
    status: string,
    updates: {
      alloted?: number;
      availed?: number;
      leaveRequestId?: Types.ObjectId;
    }
  ): Promise<ILeaveSummary> {
    console.log('createOrUpdateLeaveSummary', userId, year, categoryType, updates);
    const summary = await LeaveSummary.findOneAndUpdate(
      { userId, year },
      {
        $setOnInsert: {
          userId,
          year,
          annual: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          sick: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          compOff: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          lossOfPay: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          otherPaid: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          otherUnpaid: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          maternity: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
          workFromHome: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] }
        }
      },
      { upsert: true, new: true }
    );
    console.log(summary, 'summary Data is ==>> ');
    const updateObj: any = {};

    if (updates.alloted !== undefined) {
      // Ensure category exists before accessing properties
      const category = summary[categoryType];
      if (!category) {
        // Initialize category if it doesn't exist (for backward compatibility)
        (summary as any)[categoryType] = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
        summary.markModified(categoryType as string);
      }
      const currentCategory = summary[categoryType] || { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
      updateObj[categoryType] = {
        ...currentCategory,
        alloted: updates.alloted,
        _doc: {
          ...(currentCategory._doc || {}),
          remaining: (currentCategory.remaining || 0) + (updates.alloted - (currentCategory.alloted || 0))
        }
      } as any;
    }
      console.log(updates.availed, 'updates.availed Data is ==>> availed');
      console.log(status, 'status Data is ==>> Rejected');
      if (updates.availed !== undefined) {
        // Ensure category exists before accessing properties
        let category = summary[categoryType];
        if (!category) {
          // Initialize category if it doesn't exist (for backward compatibility, especially for workFromHome)
          (summary as any)[categoryType] = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
          summary.markModified(categoryType as string);
          category = summary[categoryType];
        }

        const currentAlloted = category.alloted || 0;

        // Note: updates.availed already contains the correct total from getTotalDaysUsedInYear
        // For Approved: it includes the newly approved request
        // For Rejected/Cancelled: it excludes the rejected/cancelled request
        // So we just use updates.availed directly, no need to subtract

        console.log(updates.availed, 'updates.availed Data is ==>> availed 2');

        // Calculate remaining days
        const newRemaining = Math.max(0, currentAlloted - updates.availed);
        
        // Get existing leaveRequests from the category
        const existingLeaveRequests = (category as any).leaveRequests || 
                                     ((category as any)._doc && (category as any)._doc.leaveRequests) || 
                                     [];

        updateObj[categoryType] = {
          alloted: currentAlloted,
          availed: updates.availed,
          remaining: newRemaining,
          leaveRequests: existingLeaveRequests,
        };
      }

    if (updates.leaveRequestId) {
      console.log(updates.leaveRequestId, 'updates.leaveRequestId Data is ==>>');
      const currentCategory = updateObj[categoryType] || summary[categoryType] || { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
      const currentLeaveRequests = (currentCategory as any).leaveRequests || 
                                   ((currentCategory as any)._doc && (currentCategory as any)._doc.leaveRequests) || 
                                   [];
      
      // Check if leaveRequestId already exists to avoid duplicates
      const leaveRequestIdStr = updates.leaveRequestId.toString();
      const alreadyExists = currentLeaveRequests.some((id: any) => 
        (typeof id === 'string' ? id : id.toString()) === leaveRequestIdStr
      );
      
      if (!alreadyExists) {
        updateObj[categoryType] = {
          ...(currentCategory as any),
          leaveRequests: [...currentLeaveRequests, updates.leaveRequestId],
        };
      } else {
        // If already exists, just ensure the category is in updateObj
        if (!updateObj[categoryType]) {
          updateObj[categoryType] = { ...(currentCategory as any) };
        }
      }
    }
    console.log(updateObj, 'updates.availed Data is ==>> availed 2.1');
    if (Object.keys(updateObj).length > 0) {
      const updatedSummary = await LeaveSummary.findOneAndUpdate(
        { userId, year },
        { $set: updateObj },
        { new: true }
      );
      if (!updatedSummary) {
        throw new Error('Leave summary not found');
      }
      console.log(updatedSummary, 'updateObj Data is ==>> summary');

      return updatedSummary;
    }

    return summary;
  }

  async getLeaveSummary(userId: Types.ObjectId, year: number): Promise<ILeaveSummary> {
    let summary = await LeaveSummary.findOne({ userId, year });
    if (!summary) {
      // Create and save the leave summary record immediately
      // This ensures one user has one leave summary record per year
      summary = await LeaveSummary.create({
        userId,
        year,
        annual: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        sick: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        compOff: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        lossOfPay: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        otherPaid: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        otherUnpaid: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        maternity: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        workFromHome: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] }
      });
      console.log(`✅ [Leave Summary] Created new leave summary for user ${userId}, year ${year}`);
    } else {
      // Initialize workFromHome if it doesn't exist (for backward compatibility with existing documents)
      // Only initialize if workFromHome is completely undefined/null - preserve existing values even if 0
      if (summary.workFromHome === undefined || summary.workFromHome === null) {
        summary.workFromHome = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
        summary.markModified('workFromHome'); // Mark as modified so Mongoose saves it
        await summary.save(); // Save to persist the new field
      }
      // If workFromHome exists (even with alloted: 0), preserve it - don't overwrite
    }
    return summary;
  }

  /**
   * Get formatted leave summary
   */
  async getFormattedLeaveSummary(userId: Types.ObjectId, year: number): Promise<any> {
    const summary = await this.getLeaveSummary(userId, year);
    
    // Ensure workFromHome exists (double-check for safety, but don't overwrite existing values)
    if (summary.workFromHome === undefined || summary.workFromHome === null) {
      summary.workFromHome = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
      summary.markModified('workFromHome');
    }

    // Helper function to format leave category
    const formatCategory = (category: any) => {
      return {
        alloted: category?.alloted || 0,
        availed: category?.availed || 0,
        remaining: category?.remaining || 0,
        leaveRequests: category?.leaveRequests || []
      };
    };

    // Return formatted summary with all leave types
    return {
      userId: summary.userId,
      year: summary.year,
      annual: formatCategory(summary.annual),
      sick: formatCategory(summary.sick),
      compOff: formatCategory(summary.compOff),
      lossOfPay: formatCategory(summary.lossOfPay),
      otherPaid: formatCategory(summary.otherPaid),
      otherUnpaid: formatCategory(summary.otherUnpaid),
      maternity: formatCategory(summary.maternity),
      workFromHome: formatCategory(summary.workFromHome)
    };
  }

  async getAllUserLeaveSummaries(
    userIds: Types.ObjectId[],
    year: number = new Date().getFullYear()
  ): Promise<ILeaveSummary[]> {
    const query: {
      userId: { $in: Types.ObjectId[] };
      year?: number
    } = {
      userId: { $in: userIds }
    };

    query.year = year;

    return await LeaveSummary.find(query)
      .sort({ userId: 1, year: -1 })
      .populate('userId', 'name email')
      .lean();
  }

  async updateLeaveAllotments(
    userId: Types.ObjectId,
    year: number,
    allotments: {
      annual?: number;
      sick?: number;
      otherPaid?: number;
      otherUnpaid?: number;
      compOff?: number;
      maternity?: number;
      workFromHome?: number;
    },
    options?: { skipEmail?: boolean }  // Option to skip email notification
  ): Promise<ILeaveSummary> {
    // getLeaveSummary ensures the record exists (creates if not found)
    // This guarantees one user has one leave summary record per year
    let summary = await this.getLeaveSummary(userId, year);
    
    // Check if this is a newly created summary (no record existed for this year)
    // A record is considered "new" if ALL leave types have 0 alloted (freshly created record)
    // This is more accurate than checking just 3 categories
    const isNew = summary.annual?.alloted === 0 && 
                  summary.sick?.alloted === 0 && 
                  summary.compOff?.alloted === 0 &&
                  summary.lossOfPay?.alloted === 0 &&
                  summary.otherPaid?.alloted === 0 &&
                  summary.otherUnpaid?.alloted === 0 &&
                  summary.maternity?.alloted === 0 &&
                  summary.workFromHome?.alloted === 0;

    // Always update the existing summary (getLeaveSummary ensures it exists)
    {
      // Only update leave types that are explicitly provided in allotments
      // This prevents overwriting other leave types with 0 when updating a single type
      if (allotments.annual !== undefined) {
        summary.annual.alloted = allotments.annual;
      }
      if (allotments.sick !== undefined) {
        summary.sick.alloted = allotments.sick;
      }
      if (allotments.otherPaid !== undefined) {
        summary.otherPaid.alloted = allotments.otherPaid;
      }
      if (allotments.otherUnpaid !== undefined) {
        summary.otherUnpaid.alloted = allotments.otherUnpaid;
      }
      if (allotments.compOff !== undefined) {
        summary.compOff.alloted = allotments.compOff;
      }
      if (allotments.maternity !== undefined) {
        summary.maternity.alloted = allotments.maternity;
      }
      if (allotments.workFromHome !== undefined) {
        // Initialize workFromHome if it doesn't exist (for backward compatibility)
        if (!summary.workFromHome) {
          summary.workFromHome = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
        }
        summary.workFromHome.alloted = allotments.workFromHome;
      }

      await summary.save();
      // return summary;
    }

    // Reload the summary to ensure we have the latest data after all hooks have run
    const reloadedSummary = await LeaveSummary.findOne({ userId, year });
    if (!reloadedSummary) {
      throw new Error('Failed to retrieve leave summary after update');
    }
    summary = reloadedSummary;

    // Send email notification only once with the latest data (unless skipped)
    if (options?.skipEmail) {
      return summary;
    }

    const user = await User.findById(userId);
    if (user?.email) {
      // Ensure we have valid summary data before sending email
      if (!summary.annual || summary.annual.alloted === undefined) {
        console.error(`[Leave Allotment Email] Skipping email - Invalid summary data for userId: ${userId}, year: ${year}`);
        return summary;
      }

      const html = generateEmailTemplate("leaveBalanceAllotmentEmail", {
        userName: user.name,
        year,
        annual: summary.annual.alloted,
        sick: summary.sick.alloted,
        compOff: summary.compOff.alloted,
        otherPaid: summary.otherPaid.alloted,
        otherUnpaid: summary.otherUnpaid.alloted,
        maternity: summary.maternity?.alloted || 0,
        workFromHome: summary.workFromHome?.alloted || 0,
        isNew,
        companyName: process.env.COMPANY_NAME || "CloudDesk HRMS"
      });

      await emailService.sendEmail({
        body: {
          to: user.email,
          subject: `Your Leave Allotment for ${year} ${isNew ? "has been created" : "was updated"}`,
          text: `Dear ${user.name},\n\nYour leave allotment for ${year} ${isNew ? "has been created" : "was updated"}.\n\nAnnual: ${summary.annual.alloted}\nSick: ${summary.sick.alloted}\nComp Off: ${summary.compOff.alloted}\nOther Paid: ${summary.otherPaid.alloted}\nOther Unpaid: ${summary.otherUnpaid.alloted}\nMaternity: ${summary.maternity?.alloted || 0}\nWork From Home: ${summary.workFromHome?.alloted || 0}\n\nRegards,\n${process.env.COMPANY_NAME || "CloudDesk HRMS"}`,
          html
        }
      });
    }
    return summary;

  }

  /**
   * Map leave type string to leave summary category key (camelCase)
   * Handles various input formats: "lossOfPay", "lossofpay", "loss_of_pay", etc.
   */
  private mapLeaveTypeToCategoryKey(leaveType: string): keyof ILeaveSummary {
    const normalized = leaveType.toLowerCase().trim();
    
    // Direct mappings for common variations
    const mapping: Record<string, keyof ILeaveSummary> = {
      'annual': 'annual',
      'sick': 'sick',
      'compoff': 'compOff',
      'comp_off': 'compOff',
      'lossofpay': 'lossOfPay',
      'loss_of_pay': 'lossOfPay',
      'lossofpays': 'lossOfPay',
      'otherpaid': 'otherPaid',
      'other_paid': 'otherPaid',
      'otherunpaid': 'otherUnpaid',
      'other_unpaid': 'otherUnpaid',
      'maternity': 'maternity',
      'workfromhome': 'workFromHome',
      'work_from_home': 'workFromHome',
      'wfh': 'workFromHome',
    };
    
    // Check if exact match exists
    if (mapping[normalized]) {
      return mapping[normalized];
    }
    
    // Try camelCase conversion for "lossOfPay" -> "lossofpay" case
    // Convert "lossofpay" back to "lossOfPay"
    if (normalized === 'lossofpay') {
      return 'lossOfPay';
    }
    if (normalized === 'compoff') {
      return 'compOff';
    }
    if (normalized === 'otherpaid') {
      return 'otherPaid';
    }
    if (normalized === 'otherunpaid') {
      return 'otherUnpaid';
    }
    if (normalized === 'workfromhome') {
      return 'workFromHome';
    }
    
    // If it's already in camelCase, try to use it directly
    const camelCaseKeys: (keyof ILeaveSummary)[] = ['annual', 'sick', 'compOff', 'lossOfPay', 'otherPaid', 'otherUnpaid', 'maternity', 'workFromHome'];
    const lowerCamelCase = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    if (camelCaseKeys.includes(lowerCamelCase as keyof ILeaveSummary)) {
      return lowerCamelCase as keyof ILeaveSummary;
    }
    
    // Default: try to use as-is (might be already camelCase)
    return normalized as keyof ILeaveSummary;
  }

  async updateLeaveBalance(
    userId: Types.ObjectId,
    year: number,
    categoryType: string,
    daysToDeduct: number,
    leaveRequestId: Types.ObjectId
  ): Promise<ILeaveSummary> {
    const summary: ILeaveSummary = await this.getLeaveSummary(userId, year);
    
    // Map leave type to proper category key (camelCase)
    const categoryTypeKey = this.mapLeaveTypeToCategoryKey(categoryType);
    
    // Ensure category exists and has availed property
    const category = summary[categoryTypeKey];
    if (!category) {
      throw new Error(`Leave category '${categoryType}' (mapped to: '${categoryTypeKey}') not found in leave summary. Available categories: annual, sick, compOff, lossOfPay, otherPaid, otherUnpaid, maternity, workFromHome`);
    }
    
    // Get current availed days, default to 0 if undefined
    const currentAvailed = (category && category.availed) ? category.availed : 0;
    
    return await this.createOrUpdateLeaveSummary(userId, year, categoryTypeKey, '', {
      availed: currentAvailed + daysToDeduct,
      leaveRequestId
    });
  }

  /**
   * Decrease leave balance when leave is cancelled or rejected
   * Removes the leaveRequestId from leaveRequests array and decreases availed days
   */
  async decreaseLeaveBalance(
    userId: Types.ObjectId,
    year: number,
    categoryType: string,
    daysToRestore: number,
    leaveRequestId: Types.ObjectId
  ): Promise<ILeaveSummary> {
    const summary: ILeaveSummary = await this.getLeaveSummary(userId, year);
    
    // Map leave type to proper category key (camelCase)
    const categoryTypeKey = this.mapLeaveTypeToCategoryKey(categoryType);
    
    // Ensure category exists
    const category = summary[categoryTypeKey];
    if (!category) {
      throw new Error(`Leave category '${categoryType}' (mapped to: '${categoryTypeKey}') not found in leave summary. Available categories: annual, sick, compOff, lossOfPay, otherPaid, otherUnpaid, maternity, workFromHome`);
    }
    
    // Get current values
    const currentAvailed = (category && category.availed) ? category.availed : 0;
    const currentAlloted = category.alloted || 0;
    const currentLeaveRequests = (category as any).leaveRequests || [];
    
    // Remove leaveRequestId from the array
    const leaveRequestIdStr = leaveRequestId.toString();
    const updatedLeaveRequests = currentLeaveRequests.filter((id: any) => 
      (typeof id === 'string' ? id : id.toString()) !== leaveRequestIdStr
    );
    
    // Calculate new availed (decrease by daysToRestore, but don't go below 0)
    const newAvailed = Math.max(0, currentAvailed - daysToRestore);
    
    // Calculate remaining
    const newRemaining = Math.max(0, currentAlloted - newAvailed);
    
    // Update leave summary directly (since we need to update leaveRequests array which createOrUpdateLeaveSummary doesn't handle)
    const updatedSummary = await LeaveSummary.findOneAndUpdate(
      { userId, year },
      {
        $set: {
          [`${categoryTypeKey}.availed`]: newAvailed,
          [`${categoryTypeKey}.remaining`]: newRemaining,
          [`${categoryTypeKey}.leaveRequests`]: updatedLeaveRequests
        }
      },
      { new: true }
    );
    
    if (!updatedSummary) {
      throw new Error('Leave summary not found');
    }
    
    return updatedSummary;
  }
}