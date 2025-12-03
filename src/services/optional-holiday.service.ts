import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { User, HolidayCalendar } from '../models';
import { Types } from 'mongoose';
import { IOptionalHolidayRequest, OptionalHolidayRequest } from '../models/optional-holiday-request.model';
import { generateEmailTemplate } from '../emails/templates';
import { emailService } from './email.service';

export interface IOptionalHolidayCreate {
  userId: string | Types.ObjectId;
  holidayDate: Date | string;
  holidayName: string;
  reason?: string;
  appliedTo?: {
    _id: string;
    name: string;
  };
}

export interface IOptionalHolidayQuery {
  userId?: string | Types.ObjectId;
  status?: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  startDate?: Date;
  endDate?: Date;
  year?: number;
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
  sortBy?: keyof IOptionalHolidayRequest;
  search?: string;
  appliedTo?: string;
}

export interface IOptionalHolidayStatusUpdate {
  status: 'Approved' | 'Rejected' | 'Cancelled';
  remarks?: string;
  approvedById: Types.ObjectId;
  approvedBy?: {
    _id: string | Types.ObjectId;
    name: string;
    email: string;
  };
}

export class OptionalHolidayService extends BaseService {
  private readonly MAX_OPTIONAL_HOLIDAYS_PER_YEAR = 2;

  constructor(context: RequestContext) {
    super(context);
  }

  /**
   * Check if employee has reached annual limit for optional holidays
   */
  async checkAnnualLimit(userId: Types.ObjectId, year: number): Promise<{ canRequest: boolean; used: number; remaining: number }> {
    const approvedCount = await OptionalHolidayRequest.countDocuments({
      userId: userId,
      year: year,
      status: 'Approved',
    });

    const canRequest = approvedCount < this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR;
    const remaining = Math.max(0, this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR - approvedCount);

    return {
      canRequest,
      used: approvedCount,
      remaining,
    };
  }

  /**
   * Validate that the holiday date is an optional holiday in the calendar
   */
  private async validateOptionalHoliday(userId: Types.ObjectId, holidayDate: Date): Promise<{ isValid: boolean; holidayName?: string; error?: string }> {
    const user = await User.findById(userId).select('holidayCalendarId').lean();
    if (!user) {
      return { isValid: false, error: 'User not found' };
    }
    if (!user.holidayCalendarId) {
      return { isValid: false, error: 'No holiday calendar assigned to your account. Please contact HR.' };
    }

    const calendar = await HolidayCalendar.findById(user.holidayCalendarId).lean();
    if (!calendar) {
      return { isValid: false, error: 'Holiday calendar not found. Please contact HR.' };
    }

    // Normalize dates to YYYY-MM-DD format for comparison (ignore time)
    const holidayDateObj = new Date(holidayDate);
    const holidayDateStr = holidayDateObj.toISOString().split('T')[0];
    
    const matchingHoliday = calendar.holidays.find((h) => {
      const hDateObj = new Date(h.date);
      const hDateStr = hDateObj.toISOString().split('T')[0];
      return hDateStr === holidayDateStr && h.type === 'optional';
    });

    if (!matchingHoliday) {
      // Check if the date exists in calendar but is not optional
      const dateExists = calendar.holidays.find((h) => {
        const hDateObj = new Date(h.date);
        const hDateStr = hDateObj.toISOString().split('T')[0];
        return hDateStr === holidayDateStr;
      });
      
      if (dateExists) {
        return { isValid: false, error: `The selected date (${holidayDateStr}) exists in your calendar but is not marked as an optional holiday. Only dates marked as "optional" in the holiday calendar can be requested.` };
      } else {
        return { isValid: false, error: `The selected date (${holidayDateStr}) is not found in your holiday calendar as an optional holiday. Please select a date that is marked as optional in your calendar.` };
      }
    }

    return { isValid: true, holidayName: matchingHoliday.name };
  }

  async findById(id: string | Types.ObjectId): Promise<IOptionalHolidayRequest> {
    const request = await OptionalHolidayRequest.findById(id);
    if (!request) {
      throw new Error('Optional holiday request not found');
    }

    const [user, approver] = await Promise.all([
      User.findById(request.userId).select('name email'),
      request.approvedById ? User.findById(request.approvedById).select('name email') : null,
    ]);

    if (user) {
      request.user = {
        name: user.name,
        email: user.email,
      };
    }

    if (approver) {
      request.approvedBy = {
        _id: approver._id,
        name: approver.name,
        email: approver.email,
      };
    }

    return request;
  }

  async findAll(query: IOptionalHolidayQuery): Promise<{
    requests: IOptionalHolidayRequest[];
    total: number;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { userId, status, startDate, endDate, year, appliedTo, page = 1, limit = 10, sort = 'desc', sortBy = 'holidayDate', search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    // ✅ FIX: Convert userId string to ObjectId for proper MongoDB query
    if (userId) {
      filter.userId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    }
    if (status) filter.status = status;
    if (year) filter.year = year;
    // ✅ FIX: appliedTo._id is stored as String in the model, so use it as string
    if (appliedTo) {
      filter['appliedTo._id'] = appliedTo;
    }

    // Search filter - search in holiday name, reason, status, and user name/email
    // Since user data is populated after query, we need to search users first
    if (search) {
      // Escape special regex characters in search string
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Search in holidayName, reason, and status (stored in document)
      const searchFilter: any[] = [
        { 'holidayName': { $regex: escapedSearch, $options: 'i' } },
        { 'reason': { $regex: escapedSearch, $options: 'i' } },
        { 'status': { $regex: escapedSearch, $options: 'i' } },
      ];

      // Also search in user collection to find matching users
      const userSearchFilter: any = {
        $or: [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
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
        holidayDate: {}
      };
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        dateFilter.holidayDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.holidayDate.$lte = end;
      }

      // Combine date filter with existing filters
      if (filter.$and) {
        filter.$and.push(dateFilter);
      } else {
        Object.assign(filter, dateFilter);
      }
    }

    const sortOrder = sort === 'asc' ? 1 : -1;
    const sortField = sortBy || 'holidayDate';

    const [requests, total] = await Promise.all([
      OptionalHolidayRequest.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email employeeCode')
        .lean(),
      OptionalHolidayRequest.countDocuments(filter),
    ]);

    return {
      requests: requests as IOptionalHolidayRequest[],
      total,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async create(data: IOptionalHolidayCreate): Promise<IOptionalHolidayRequest> {
    const userId = typeof data.userId === 'string' ? new Types.ObjectId(data.userId) : data.userId;
    const holidayDate = new Date(data.holidayDate);
    const year = holidayDate.getFullYear();

    // Validate user exists and is active
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.active) {
      throw new Error('User account is inactive');
    }

    // Validate that the date is an optional holiday in calendar
    const validation = await this.validateOptionalHoliday(userId, holidayDate);
    if (!validation.isValid) {
      throw new Error(validation.error || 'The selected date is not an optional holiday in your calendar');
    }

    // Use holiday name from calendar if not provided
    const holidayName = data.holidayName || validation.holidayName || 'Optional Holiday';

    // Check for duplicate request - same date, any status except Rejected/Cancelled
    const startOfDay = new Date(holidayDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(holidayDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const existingRequest = await OptionalHolidayRequest.findOne({
      userId: userId,
      holidayDate: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
      status: { $nin: ['Rejected', 'Cancelled'] },
    });

    if (existingRequest) {
      throw new Error('You have already applied for this optional holiday');
    }

    // Check annual limit (only for new requests, not for pending)
    const limitCheck = await this.checkAnnualLimit(userId, year);
    if (!limitCheck.canRequest) {
      throw new Error(`Annual limit reached. You have already used ${limitCheck.used} out of ${this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR} optional holidays for ${year}`);
    }

    const request = new OptionalHolidayRequest({
      userId: userId,
      holidayDate: holidayDate,
      holidayName: holidayName,
      year: year,
      status: 'Pending',
      reason: data.reason,
      appliedTo: data.appliedTo,
      user: {
        name: user.name,
        email: user.email,
      },
    });

    await request.save();

    // Send email notification to manager/admin
    if (data.appliedTo && data.appliedTo._id && Types.ObjectId.isValid(data.appliedTo._id)) {
      const manager = await User.findById(data.appliedTo._id).select('name email').lean();
      if (manager) {
        const htmlContent = generateEmailTemplate('optionalHolidayRequest', {
          employeeName: user.name,
          holidayName: holidayName,
          holidayDate: holidayDate.toLocaleDateString(),
          reason: data.reason || 'No reason provided',
          requestUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/optional-holidays/${request._id}`,
        });

        await emailService.sendEmail({
          body: {
            to: manager.email,
            subject: `Optional Holiday Request - ${user.name}`,
            text: `${user.name} has requested an optional holiday: ${holidayName} on ${holidayDate.toLocaleDateString()}`,
            html: htmlContent,
          },
        });
      }
    }

    return this.findById(request._id);
  }

  async updateStatus(id: string | Types.ObjectId, updateData: IOptionalHolidayStatusUpdate): Promise<IOptionalHolidayRequest> {
    const request = await OptionalHolidayRequest.findById(id);
    if (!request) {
      throw new Error('Optional holiday request not found');
    }

    if (request.status !== 'Pending') {
      throw new Error('Optional holiday request has already been processed');
    }

    // If approving, check annual limit
    if (updateData.status === 'Approved') {
      const limitCheck = await this.checkAnnualLimit(request.userId, request.year);
      if (!limitCheck.canRequest) {
        throw new Error(`Cannot approve: Employee has already used ${limitCheck.used} out of ${this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR} optional holidays for ${request.year}`);
      }
    }

    request.status = updateData.status;
    request.approvedById = updateData.approvedById;
    request.approvedBy = updateData.approvedBy
      ? {
        _id: typeof updateData.approvedBy._id === 'string' ? updateData.approvedBy._id : updateData.approvedBy._id.toString(),
        name: updateData.approvedBy.name,
        email: updateData.approvedBy.email,
      }
      : undefined;

    if (updateData.status === 'Approved') {
      request.approvedAt = new Date();
    } else if (updateData.status === 'Rejected') {
      request.rejectedAt = new Date();
    } else if (updateData.status === 'Cancelled') {
      request.cancelledAt = new Date();
    }

    if (updateData.remarks) request.remarks = updateData.remarks;
    await request.save();

    // Send email notification to employee
    const employee = await User.findById(request.userId).select('name email').lean();
    if (employee) {
      const htmlContent = generateEmailTemplate('optionalHolidayStatus', {
        employeeName: employee.name,
        holidayName: request.holidayName,
        holidayDate: request.holidayDate.toLocaleDateString(),
        status: updateData.status,
        remarks: updateData.remarks || 'No remarks provided',
      });

      await emailService.sendEmail({
        body: {
          to: employee.email,
          subject: `Optional Holiday Request ${updateData.status} - ${request.holidayName}`,
          text: `Your optional holiday request for ${request.holidayName} on ${request.holidayDate.toLocaleDateString()} has been ${updateData.status.toLowerCase()}.`,
          html: htmlContent,
        },
      });
    }

    return this.findById(request._id);
  }

  async cancel(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<IOptionalHolidayRequest> {
    const request = await OptionalHolidayRequest.findById(id);
    if (!request) {
      throw new Error('Optional holiday request not found');
    }

    if (request.userId.toString() !== userId.toString()) {
      throw new Error('You can only cancel your own optional holiday requests');
    }

    if (request.status !== 'Pending') {
      throw new Error('Only pending requests can be cancelled');
    }

    request.status = 'Cancelled';
    request.cancelledAt = new Date();
    await request.save();

    return this.findById(request._id);
  }

  /**
   * Get approved optional holidays for a user in a specific year/month
   * Used by payroll calculation
   */
  async getApprovedOptionalHolidays(
    userId: Types.ObjectId,
    year: number,
    monthNumber?: number,
  ): Promise<IOptionalHolidayRequest[]> {
    const filter: any = {
      userId: userId,
      year: year,
      status: 'Approved',
    };

    if (monthNumber !== undefined) {
      const firstDay = new Date(year, monthNumber - 1, 1);
      const lastDay = new Date(year, monthNumber, 0);
      filter.holidayDate = {
        $gte: firstDay,
        $lte: lastDay,
      };
    }

    return await OptionalHolidayRequest.find(filter).lean();
  }

  /**
   * Get optional holiday usage summary for a user
   */
  async getUsageSummary(userId: Types.ObjectId, year: number): Promise<{
    total: number;
    used: number;
    remaining: number;
    requests: IOptionalHolidayRequest[];
  }> {
    const requests = await OptionalHolidayRequest.find({
      userId: userId,
      year: year,
    })
      .sort({ holidayDate: 1 })
      .lean();

    const approvedCount = requests.filter((r) => r.status === 'Approved').length;

    return {
      total: this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR,
      used: approvedCount,
      remaining: Math.max(0, this.MAX_OPTIONAL_HOLIDAYS_PER_YEAR - approvedCount),
      requests: requests as IOptionalHolidayRequest[],
    };
  }
}

