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
      summary = new LeaveSummary({
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
   * Get formatted leave summary with country-specific fields
   * UAE employees get allocation/expiry dates, India employees don't
   */
  async getFormattedLeaveSummary(userId: Types.ObjectId, year: number): Promise<any> {
    // Get user to check country
    const user = await User.findById(userId).select('country joiningDate');
    if (!user) {
      throw new Error('User not found');
    }

    const isUAE = user.country === 'AE';
    const summary = await this.getLeaveSummary(userId, year);
    
    // Debug: Log workFromHome value to verify it's being loaded
    console.log('workFromHome from DB:', summary.workFromHome);
    
    // Ensure workFromHome exists (double-check for safety, but don't overwrite existing values)
    if (summary.workFromHome === undefined || summary.workFromHome === null) {
      summary.workFromHome = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
      summary.markModified('workFromHome');
    }

    // Helper function to format leave category based on country
    const formatCategory = (category: any) => {
      const baseData = {
        alloted: category?.alloted || 0,
        availed: category?.availed || 0,
        remaining: category?.remaining || 0,
        leaveRequests: category?.leaveRequests || []
      };

      // For UAE, include allocation/expiry dates ONLY if leave is allocated (alloted > 0)
      if (isUAE && category && category.alloted > 0) {
        return {
          ...baseData,
          allocationDate: category.allocationDate || null,
          expiryDate: category.expiryDate || null,
          originalExpiryDate: category.originalExpiryDate || null,
          manuallyAdjusted: category.manuallyAdjusted || false
        };
      }

      return baseData;
    };

    // Format based on country
    if (isUAE) {
      // UAE: Include only UAE-specific leave types with dates
      return {
        userId: summary.userId,
        year: summary.year,
        annual: formatCategory(summary.annual),
        sick: formatCategory(summary.sick),
        compOff: formatCategory(summary.compOff),
        maternity: formatCategory(summary.maternity),
        workFromHome: formatCategory(summary.workFromHome)
      };
    } else {
      // India: Include India-specific leave types without dates
      return {
        userId: summary.userId,
        year: summary.year,
        annual: formatCategory(summary.annual),
        sick: formatCategory(summary.sick),
        compOff: formatCategory(summary.compOff),
        lossOfPay: formatCategory(summary.lossOfPay),
        otherPaid: formatCategory(summary.otherPaid),
        otherUnpaid: formatCategory(summary.otherUnpaid),
        workFromHome: formatCategory(summary.workFromHome)
      };
    }
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
      maternity?: number;  // NEW: UAE-specific maternity leave
      workFromHome?: number;  // NEW: Work From Home (merged from WFHSummary)
      // UAE-specific: Allow passing allocation dates
      annualAllocationDate?: Date;
      sickAllocationDate?: Date;
      otherPaidAllocationDate?: Date;
      otherUnpaidAllocationDate?: Date;
      compOffAllocationDate?: Date;
      maternityAllocationDate?: Date;  // NEW: UAE-specific
      workFromHomeAllocationDate?: Date;  // NEW: Work From Home
      // UAE-specific: Allow manual expiry date override
      annualExpiryDate?: Date;
      sickExpiryDate?: Date;
      otherPaidExpiryDate?: Date;
      otherUnpaidExpiryDate?: Date;
      compOffExpiryDate?: Date;
      maternityExpiryDate?: Date;  // NEW: UAE-specific
      workFromHomeExpiryDate?: Date;  // NEW: Work From Home
    },
    options?: { skipEmail?: boolean }  // Option to skip email notification
  ): Promise<ILeaveSummary> {
    let summary = await this.getLeaveSummary(userId, year);
    let isNew = false;

    if (!summary) {
      isNew = true;

      // Check if user is from UAE for allocation date logic
      const user = await User.findById(userId);
      const today = new Date();

      const createData: any = {
        userId,
        year,
        annual: { alloted: allotments.annual || 0, availed: 0, remaining: 0, leaveRequests: [] },
        sick: { alloted: allotments.sick || 0, availed: 0, remaining: 0, leaveRequests: [] },
        compOff: { alloted: allotments.compOff || 0, availed: 0, remaining: 0, leaveRequests: [] },
        lossOfPay: { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] },
        otherPaid: { alloted: allotments.otherPaid || 0, availed: 0, remaining: 0, leaveRequests: [] },
        otherUnpaid: { alloted: allotments.otherUnpaid || 0, availed: 0, remaining: 0, leaveRequests: [] },
        maternity: { alloted: allotments.maternity || 0, availed: 0, remaining: 0, leaveRequests: [] },
        workFromHome: { alloted: allotments.workFromHome || 0, availed: 0, remaining: 0, leaveRequests: [] }
      };

      // UAE-specific: Set allocation dates for new leave summaries
      // For ALL leave types with alloted > 0, set allocation date
      if (user && user.country === 'AE') {
        // Annual Leave - Only set dates if allocated > 0
        if (allotments.annual && allotments.annual > 0) {
          createData.annual.allocationDate = allotments.annualAllocationDate || today;
          if (allotments.annualExpiryDate) {
            createData.annual.expiryDate = allotments.annualExpiryDate;
          }
        }

        // Sick Leave - Only set dates if allocated > 0
        if (allotments.sick && allotments.sick > 0) {
          createData.sick.allocationDate = allotments.sickAllocationDate || today;
          if (allotments.sickExpiryDate) {
            createData.sick.expiryDate = allotments.sickExpiryDate;
          }
        }

        // Comp Off - Only set dates if allocated > 0
        if (allotments.compOff && allotments.compOff > 0) {
          createData.compOff.allocationDate = allotments.compOffAllocationDate || today;
          if (allotments.compOffExpiryDate) {
            createData.compOff.expiryDate = allotments.compOffExpiryDate;
          }
        }

        // Other Paid Leave - Only set dates if allocated > 0
        if (allotments.otherPaid && allotments.otherPaid > 0) {
          createData.otherPaid.allocationDate = allotments.otherPaidAllocationDate || today;
          if (allotments.otherPaidExpiryDate) {
            createData.otherPaid.expiryDate = allotments.otherPaidExpiryDate;
          }
        }

        // Other Unpaid Leave - Only set dates if allocated > 0
        if (allotments.otherUnpaid && allotments.otherUnpaid > 0) {
          createData.otherUnpaid.allocationDate = allotments.otherUnpaidAllocationDate || today;
          if (allotments.otherUnpaidExpiryDate) {
            createData.otherUnpaid.expiryDate = allotments.otherUnpaidExpiryDate;
          }
        }

        // Maternity Leave - Only set dates if allocated > 0
        if (allotments.maternity && allotments.maternity > 0) {
          createData.maternity.allocationDate = allotments.maternityAllocationDate || today;
          if (allotments.maternityExpiryDate) {
            createData.maternity.expiryDate = allotments.maternityExpiryDate;
          }
        }

        console.log(`🇦🇪 [UAE Leave Allocation] New summary for user ${userId} - Year ${year} with allocation dates`);
        console.log(`📊 Creating leave allocation with dates:`, {
          annual: { alloted: allotments.annual, hasDate: !!(allotments.annual && allotments.annual > 0) },
          sick: { alloted: allotments.sick, hasDate: !!(allotments.sick && allotments.sick > 0) },
          compOff: { alloted: allotments.compOff, hasDate: !!(allotments.compOff && allotments.compOff > 0) },
          maternity: { alloted: allotments.maternity, hasDate: !!(allotments.maternity && allotments.maternity > 0) }
        });
      }

      summary = await LeaveSummary.create(createData);
      // return summary;
    }
    else {
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

      // UAE-specific: Set allocation dates if provided, otherwise use today
      const user = await User.findById(userId);
      if (user && user.country === 'AE') {
        const today = new Date();

        // Set allocation dates for ALL leave types with alloted > 0
        // This ensures existing allocated leaves also get dates if they don't have them

        // Annual Leave - Only set dates if allocated > 0
        if (allotments.annual !== undefined) {
          if (allotments.annual > 0) {
            summary.annual.allocationDate = allotments.annualAllocationDate || summary.annual.allocationDate || today;
            if (allotments.annualExpiryDate) {
              summary.annual.expiryDate = allotments.annualExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.annual.allocationDate = undefined;
            summary.annual.expiryDate = undefined;
            summary.annual.originalExpiryDate = undefined;
            summary.annual.manuallyAdjusted = false;
          }
        }

        // Sick Leave - Only set dates if allocated > 0
        if (allotments.sick !== undefined) {
          if (allotments.sick > 0) {
            summary.sick.allocationDate = allotments.sickAllocationDate || summary.sick.allocationDate || today;
            if (allotments.sickExpiryDate) {
              summary.sick.expiryDate = allotments.sickExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.sick.allocationDate = undefined;
            summary.sick.expiryDate = undefined;
            summary.sick.originalExpiryDate = undefined;
            summary.sick.manuallyAdjusted = false;
          }
        }

        // Other Paid Leave - Only set dates if allocated > 0
        if (allotments.otherPaid !== undefined) {
          if (allotments.otherPaid > 0) {
            summary.otherPaid.allocationDate = allotments.otherPaidAllocationDate || summary.otherPaid.allocationDate || today;
            if (allotments.otherPaidExpiryDate) {
              summary.otherPaid.expiryDate = allotments.otherPaidExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.otherPaid.allocationDate = undefined;
            summary.otherPaid.expiryDate = undefined;
            summary.otherPaid.originalExpiryDate = undefined;
            summary.otherPaid.manuallyAdjusted = false;
          }
        }

        // Other Unpaid Leave - Only set dates if allocated > 0
        if (allotments.otherUnpaid !== undefined) {
          if (allotments.otherUnpaid > 0) {
            summary.otherUnpaid.allocationDate = allotments.otherUnpaidAllocationDate || summary.otherUnpaid.allocationDate || today;
            if (allotments.otherUnpaidExpiryDate) {
              summary.otherUnpaid.expiryDate = allotments.otherUnpaidExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.otherUnpaid.allocationDate = undefined;
            summary.otherUnpaid.expiryDate = undefined;
            summary.otherUnpaid.originalExpiryDate = undefined;
            summary.otherUnpaid.manuallyAdjusted = false;
          }
        }

        // Comp Off - Only set dates if allocated > 0
        if (allotments.compOff !== undefined) {
          if (allotments.compOff > 0) {
            summary.compOff.allocationDate = allotments.compOffAllocationDate || summary.compOff.allocationDate || today;
            if (allotments.compOffExpiryDate) {
              summary.compOff.expiryDate = allotments.compOffExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.compOff.allocationDate = undefined;
            summary.compOff.expiryDate = undefined;
            summary.compOff.originalExpiryDate = undefined;
            summary.compOff.manuallyAdjusted = false;
          }
        }

        // Maternity Leave - Only set dates if allocated > 0
        if (allotments.maternity !== undefined) {
          if (allotments.maternity > 0) {
            summary.maternity.allocationDate = allotments.maternityAllocationDate || summary.maternity.allocationDate || today;
            if (allotments.maternityExpiryDate) {
              summary.maternity.expiryDate = allotments.maternityExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.maternity.allocationDate = undefined;
            summary.maternity.expiryDate = undefined;
            summary.maternity.originalExpiryDate = undefined;
            summary.maternity.manuallyAdjusted = false;
          }
        }

        // Work From Home - Only set dates if allocated > 0
        if (allotments.workFromHome !== undefined) {
          // Initialize workFromHome if it doesn't exist (for backward compatibility)
          if (!summary.workFromHome) {
            summary.workFromHome = { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
          }
          if (allotments.workFromHome > 0) {
            summary.workFromHome.allocationDate = allotments.workFromHomeAllocationDate || summary.workFromHome.allocationDate || today;
            if (allotments.workFromHomeExpiryDate) {
              summary.workFromHome.expiryDate = allotments.workFromHomeExpiryDate;
            }
          } else {
            // Remove dates if allocation is set to 0
            summary.workFromHome.allocationDate = undefined;
            summary.workFromHome.expiryDate = undefined;
            summary.workFromHome.originalExpiryDate = undefined;
            summary.workFromHome.manuallyAdjusted = false;
          }
        }

        console.log(`🇦🇪 [UAE Leave Allocation] User ${userId} - Setting allocation dates for leave year ${year}`);
        console.log(`📊 Leave allocation status:`, {
          annual: { alloted: summary.annual.alloted, hasDate: !!summary.annual.allocationDate },
          sick: { alloted: summary.sick.alloted, hasDate: !!summary.sick.allocationDate },
          compOff: { alloted: summary.compOff.alloted, hasDate: !!summary.compOff.allocationDate },
          maternity: { alloted: summary.maternity.alloted, hasDate: !!summary.maternity.allocationDate }
        });
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
}