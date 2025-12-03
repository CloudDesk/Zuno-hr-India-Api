import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { IUser, User } from '../models';
import { FilterQuery, Types } from 'mongoose';
import { IWFH, WFH } from '../models/wfh.model';
import { WFHSummaryService } from './wfh-summary.service';
import { generateEmailTemplate } from '../emails/templates';
import { emailService } from './email.service';

export interface IWFHCreate {
  userId: string | Types.ObjectId;
  startDate: Date;
  endDate: Date;
  remarks?: string;
  reason: string;
  appliedTo?: {
    _id: string;
    name: string;
  };
}

export interface IWFHQuery {
  userId?: string | Types.ObjectId;
  status?: 'Pending' | 'Approved' | 'Rejected';
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
  sortBy?: keyof IWFH;
  search?: string;
}

export interface IWFHStatusUpdate {
  status: 'Approved' | 'Rejected' | 'Cancelled';
  remarks?: string;
  approvedById: Types.ObjectId;
  approvedBy?: {
    _id: string | Types.ObjectId;
    name: string;
    email: string;
  };
}

export class WFHService extends BaseService {
  private wfhSummaryService: WFHSummaryService;

  constructor(context: RequestContext) {
    super(context);
    this.wfhSummaryService = new WFHSummaryService(context);
  }

  async findById(id: string | Types.ObjectId): Promise<IWFH> {
    const wfh = await WFH.findById(id);
    if (!wfh) {
      throw new Error('WFH request not found');
    }

    const [user, approver] = await Promise.all([
      User.findById(wfh.userId).select('name email'),
      wfh.approvedById ? User.findById(wfh.approvedById).select('name email') : null,
    ]);

    if (user) {
      wfh.user = {
        name: user.name,
        email: user.email,
      };
    }

    if (approver) {
      wfh.approvedBy = {
        _id: approver._id,
        name: approver.name,
        email: approver.email,
      };
    }

    return wfh;
  }

  async findAll(query: {
    userId?: string | Types.ObjectId;
    status?: string;
    startDate?: string;
    endDate?: string;
    appliedTo?: string; // Manager ID to filter by
    search?: string;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ wfhs: IWFH[]; total: number; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const { userId, status, startDate, endDate, appliedTo, page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    // ✅ FIX: Convert userId string to ObjectId for proper MongoDB query
    if (userId) {
      filter.userId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    }
    if (status) filter.status = status;
    // ✅ FIX: Convert appliedTo string to ObjectId for proper MongoDB query
    if (appliedTo) {
      filter['appliedTo._id'] = typeof appliedTo === 'string' ? new Types.ObjectId(appliedTo) : appliedTo;
    }

    // Search filter - search in user name, email, reason, remarks, and status
    // Since user data is populated after query, we need to search users first
    if (search) {
      // Search in reason, remarks, and status (stored in document)
      const searchFilter: any[] = [
        { 'reason': { $regex: search, $options: 'i' } },
        { 'remarks': { $regex: search, $options: 'i' } },
        { 'status': { $regex: search, $options: 'i' } },
      ];

      // Also search in user collection to find matching users
      const userSearchFilter: any = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ]
      };

      // If userId is already filtered, combine with user search
      if (userId) {
        userSearchFilter._id = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      }

      const matchingUsers = await User.find(userSearchFilter).select('_id').lean();

      // If users found, add userId filter
      if (matchingUsers.length > 0) {
        const userIds = matchingUsers.map(u => u._id);
        searchFilter.push({ userId: { $in: userIds } });
      }

      // Combine search with existing filters using $and
      const existingFilters = { ...filter };
      filter.$and = [
        existingFilters,
        { $or: searchFilter }
      ];
    }

    // Date range filter - handle separately from search
    if (startDate || endDate) {
      const dateFilter: any = {
        $or: [
          {
            startDate: {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) }),
            },
          },
          {
            endDate: {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) }),
            },
          },
        ],
      };

      // Combine date filter with existing filters
      if (filter.$and) {
        // If search is present, add date filter to $and array
        filter.$and.push(dateFilter);
      } else {
        // If no search, use $and to combine base filters with date filter
        const existingFilters = { ...filter };
        filter.$and = [
          existingFilters,
          dateFilter
        ];
      }
    }

    // Handle search filter
    if (search) {
      const searchConditions = [
        { 'user.name': { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } },
        { 'appliedTo.name': { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
      ];

      // If there's already a $or for dates, combine with $and
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions }
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const [wfhs, total] = await Promise.all([
      WFH.find(filter as FilterQuery<IWFH>)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WFH.countDocuments(filter as FilterQuery<IWFH>),
    ]);

    const populatedWFHs = await Promise.all(
      wfhs.map(async (wfh) => {
        const [user, approver] = await Promise.all([
          User.findById(wfh.userId).select('name email'),
          wfh.approvedById ? User.findById(wfh.approvedById).select('name email') : null,
        ]);

        if (user) {
          wfh.user = {
            name: user.name,
            email: user.email,
          };
        }

        if (approver) {
          wfh.approvedBy = {
            _id: approver._id,
            name: approver.name,
            email: approver.email,
          };
        }

        return wfh;
      })
    );

    return {
      wfhs: populatedWFHs,
      total,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByUserId(
    userId: string | Types.ObjectId,
    filters: {
      search?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    } = {},
    options: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ wfhs: IWFH[]; total: number }> {
    const { search, status, startDate, endDate } = filters;
    const { page = 1, limit = 10, sortBy = 'startDate', sortOrder = 'desc' } = options;

    const query: any = { userId };
    const skip = (page - 1) * limit;

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { 'user.name': { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } },
      ];
    }

    if (startDate || endDate) {
      query.$or = [
        {
          startDate: {
            ...(startDate && { $gte: new Date(startDate) }),
            ...(endDate && { $lte: new Date(endDate) }),
          },
        },
        {
          endDate: {
            ...(startDate && { $gte: new Date(startDate) }),
            ...(endDate && { $lte: new Date(endDate) }),
          },
        },
      ];
    }

    const [wfhs, total] = await Promise.all([
      WFH.find(query as FilterQuery<IWFH>)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit),
      WFH.countDocuments(query as FilterQuery<IWFH>),
    ]);

    const populatedWFHs = await Promise.all(
      wfhs.map(async (wfh) => {
        const [user, approver] = await Promise.all([
          User.findById(wfh.userId).select('name email'),
          wfh.approvedById ? User.findById(wfh.approvedById).select('name email') : null,
        ]);

        if (user) {
          wfh.user = {
            name: user.name,
            email: user.email,
          };
        }

        if (approver) {
          wfh.approvedBy = {
            _id: approver._id,
            name: approver.name,
            email: approver.email,
          };
        }

        return wfh;
      })
    );

    return {
      wfhs: populatedWFHs,
      total,
    };
  }

  async create(wfhData: IWFHCreate): Promise<IWFH> {
    const user = await User.findById(wfhData.userId).select('name email');
    if (!user) {
      throw new Error('User not found');
    }

    // Calculate number of days
    const startDate = new Date(wfhData.startDate);
    const endDate = new Date(wfhData.endDate);
    const timeDiff = endDate.getTime() - startDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1; // Include both start and end dates

    // Check for overlapping WFH requests
    const overlappingWFH = await WFH.findOne({
      userId: wfhData.userId,
      status: { $nin: ['Rejected', 'Cancelled'] },
      $or: [
        {
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        },
      ],
    });

    if (overlappingWFH) {
      throw new Error('WFH dates overlap with existing WFH request');
    }

    const year = startDate.getFullYear();

    // Get WFH balance for the year
    const balance = await this.wfhSummaryService.getWFHBalance(
      new Types.ObjectId(wfhData.userId.toString()),
      year
    );

    // Calculate total days used this year (only approved WFH)
    const totalUsedThisYear = await this.getTotalDaysUsedInYear(
      new Types.ObjectId(wfhData.userId.toString()),
      year
    );

    // Calculate pending days for the same year (excluding rejected and cancelled)
    const pendingDays = await this.getPendingDaysInYear(
      new Types.ObjectId(wfhData.userId.toString()),
      year
    );

    // Balance validation logic:
    // - If alloted = 0: No restriction (unlimited)
    // - If alloted > 0: Validate that requested days + availed + pending <= alloted
    if (balance.alloted > 0) {
      const requestedDays = daysDiff;
      const availableDays = balance.alloted - totalUsedThisYear - pendingDays;

      // Check if requested days exceed remaining balance
      if (requestedDays > availableDays) {
        throw new Error(
          `Insufficient WFH balance. ` +
          `Allocated: ${balance.alloted} days, ` +
          `Availed: ${totalUsedThisYear} days, ` +
          `Pending: ${pendingDays} days, ` +
          `Available: ${availableDays} days. ` +
          `Requested: ${requestedDays} days exceeds available balance.`
        );
      }
    }
    // If alloted = 0, allow unlimited (no validation needed)

    const wfh: IWFH = await WFH.create({
      ...wfhData,
      noOfDays: daysDiff,
    });

    // Track WFH request (don't deduct yet - will deduct on approval)
    await this.wfhSummaryService.createOrUpdateWFHSummary(
      new Types.ObjectId(wfh.userId.toString()),
      year,
      {
        wfhRequestId: wfh._id as Types.ObjectId,
      }
    );

    // Send email to manager
    const manager: IUser = await User.findById(
      new Types.ObjectId(wfh.appliedTo?._id)
    ).select('name email');

    if (manager) {
      const appUrl = process.env.APP_URL || 'http://localhost:5173';
      const htmlContent = generateEmailTemplate('leaveApplyEmail', {
        managerName: manager.name,
        employeeName: user.name,
        leaveType: 'Work From Home',
        fromDate: wfh.startDate.toDateString(),
        toDate: wfh.endDate.toDateString(),
        totalDays: wfh.noOfDays,
        reason: wfh.reason,
        approvalLink: `${appUrl}/manager/actions/wfh/${wfh._id}`,
        companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS',
      });

      await emailService.sendEmail({
        body: {
          to: manager.email,
          subject: `WFH Request from ${user.name}`,
          text: `${user.name} has requested WFH from ${wfh.startDate.toDateString()} to ${wfh.endDate.toDateString()} (${wfh.noOfDays} days).`,
          html: htmlContent,
        },
      });
    }

    return this.findById(wfh._id as string);
  }

  async updateStatus(id: string | Types.ObjectId, updateData: IWFHStatusUpdate): Promise<IWFH> {
    const wfh = await WFH.findById(id);
    if (!wfh) {
      throw new Error('WFH request not found');
    }

    if (wfh.status !== 'Pending') {
      throw new Error('WFH request has already been processed');
    }

    wfh.status = updateData.status;
    wfh.approvedById = updateData.approvedById;
    wfh.approvedBy = updateData.approvedBy
      ? {
        _id: typeof updateData.approvedBy._id === 'string'
          ? updateData.approvedBy._id
          : updateData.approvedBy._id.toString(),
        name: updateData.approvedBy.name,
        email: updateData.approvedBy.email,
      }
      : undefined;

    if (updateData.status === 'Approved') {
      wfh.approvedAt = new Date();
    } else if (updateData.status === 'Rejected') {
      wfh.rejectedAt = new Date();
    } else if (updateData.status === 'Cancelled') {
      wfh.cancelledAt = new Date();
    }

    if (updateData.remarks) wfh.remarks = updateData.remarks;
    await wfh.save();

    // Update WFH summary based on status change
    const year = new Date(wfh.startDate).getFullYear();
    const totalUsedThisYear = await this.getTotalDaysUsedInYear(
      new Types.ObjectId(wfh.userId.toString()),
      year
    );

    await this.wfhSummaryService.createOrUpdateWFHSummary(
      new Types.ObjectId(wfh.userId.toString()),
      year,
      {
        availed: totalUsedThisYear,
      }
    );

    // Send email notification
    const employee: IUser = await User.findById(new Types.ObjectId(wfh.userId)).select('name email');
    const approver: IUser = await User.findById(wfh.approvedById).select('name');

    if (employee) {
      const htmlContent = generateEmailTemplate('leaveApprovalEmail', {
        employeeName: employee.name,
        approverName: approver?.name || 'Manager',
        leaveType: 'Work From Home',
        fromDate: wfh.startDate.toDateString(),
        toDate: wfh.endDate.toDateString(),
        totalDays: wfh.noOfDays,
        remarks: wfh.remarks || '',
        status: wfh.status,
        companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS',
      });

      await emailService.sendEmail({
        body: {
          to: employee.email,
          subject: `Your WFH Request has been ${wfh.status}`,
          text: `Your WFH request from ${wfh.startDate.toDateString()} to ${wfh.endDate.toDateString()} has been ${wfh.status.toLowerCase()} by ${approver?.name || 'manager'}.`,
          html: htmlContent,
        },
      });
    }

    return this.findById(wfh._id as string);
  }

  async cancel(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<{ message: string }> {
    const wfh = await WFH.findById(id);
    if (!wfh) {
      throw new Error('WFH request not found');
    }

    if (wfh.userId.toString() !== userId.toString()) {
      throw new Error('You can only cancel your own WFH requests');
    }

    if (wfh.status !== 'Pending') {
      throw new Error('Only pending WFH requests can be cancelled');
    }

    wfh.status = 'Cancelled';
    wfh.cancelledAt = new Date();
    await wfh.save();

    // Update summary
    const year = new Date(wfh.startDate).getFullYear();
    const totalUsedThisYear = await this.getTotalDaysUsedInYear(
      new Types.ObjectId(wfh.userId.toString()),
      year
    );

    await this.wfhSummaryService.createOrUpdateWFHSummary(
      new Types.ObjectId(wfh.userId.toString()),
      year,
      {
        availed: totalUsedThisYear,
      }
    );

    return { message: 'WFH request cancelled successfully' };
  }

  async getWFHBalance(userId: Types.ObjectId, year: number): Promise<{
    alloted: number;
    availed: number;
    remaining: number;
  }> {
    return this.wfhSummaryService.getWFHBalance(userId, year);
  }

  private async getTotalDaysUsedInYear(userId: Types.ObjectId, year: number): Promise<number> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

    const approvedWFHs = await WFH.find({
      userId,
      startDate: { $gte: startDate },
      endDate: { $lte: endDate },
      status: 'Approved',
    });

    return approvedWFHs.reduce((total, wfh) => total + wfh.noOfDays, 0);
  }

  /**
   * Get total pending days for a user in a specific year
   * Excludes Rejected and Cancelled WFH requests
   */
  private async getPendingDaysInYear(
    userId: Types.ObjectId,
    year: number
  ): Promise<number> {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

    const pendingWFHs = await WFH.find({
      userId,
      startDate: { $gte: startDate },
      endDate: { $lte: endDate },
      status: 'Pending',
    });

    return pendingWFHs.reduce((total, wfh) => total + wfh.noOfDays, 0);
  }
}

