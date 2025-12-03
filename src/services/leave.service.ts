import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { IUser, Leave, User, LOV } from '../models';
import { FilterQuery, Types } from 'mongoose';
import { ILeave } from '../models/leave.model';
import { LeaveSummaryService } from './leave-summary.service';
import { ILeaveSummary } from '../models/leave-summary.model';
import { AttendanceRecord } from '../models/attendance-record.model';
import { generateEmailTemplate } from '../emails/templates';
import { emailService } from './email.service';
import { validateLeaveTypeForCountry } from '../utilis/leave-type-constants';

export interface ILeaveCreate {
  userId: string | Types.ObjectId;
  leaveTypeId: string | Types.ObjectId;
  startDate: Date;
  endDate: Date;
  remarks?: string;
  leaveType?: string;
  noOfDays?: number;
  reason?: string;
  appliedTo?: {
    _id: string;
    name: string;
  };
  // India-specific: Half-day leave support
  leaveDuration?: 'full-day' | 'half-day';
  halfDayType?: 'first-half' | 'second-half';
}

export interface ILeaveQuery {
  userId?: string | Types.ObjectId;
  status?: 'Pending' | 'Approved' | 'Rejected';
  leaveType?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
  sortBy?: keyof ILeave;
  search?: string;
  searchBy?: keyof ILeave;
  $or?: unknown;
  appliedTo?: string
}

export interface ILeaveStatusUpdate {
  status: 'Approved' | 'Rejected' | 'Cancelled';
  remarks?: string;
  approvedById: Types.ObjectId;
  rejectedById?: Types.ObjectId;
  noOfDays?: number;
  approvedBy?: {
    _id: string | Types.ObjectId;
    name: string;
    email: string;
  };
}

export class LeaveService extends BaseService {
  private leaveSummaryService: LeaveSummaryService;
  constructor(context: RequestContext) {
    super(context);
    this.leaveSummaryService = new LeaveSummaryService(context);
  }

  async findById(id: string | Types.ObjectId): Promise<ILeave> {
    console.log(id, 'ID IS ==>>> ');
    const leave = await Leave.findById(id);
    console.log(leave, 'Leave data');
    if (!leave) {
      throw new Error('Leave request not found');
    }

    // Populate user details
    const [user, approver] = await Promise.all([
      User.findById(leave.userId).select('name email'),
      leave.approvedById ? User.findById(leave.approvedById).select('name email') : null,
    ]);

    if (user) {
      leave.user = {
        name: user.name,
        email: user.email,
      };
    }

    if (approver) {
      leave.approvedBy = {
        _id: approver._id,
        name: approver.name,
        email: approver.email,
      };
    }

    return leave;
  }


  async findByUserId(userId: string | Types.ObjectId,
    filters: {
      search?: string;
      status?: string;
      leaveType?: string;
      startDate?: string; // YYYY-MM-DD
      endDate?: string;   // YYYY-MM-DD
    } = {},
    options: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ leaves: ILeave[]; total: number }> {
    console.log(userId, 'USER ID IS ==>>>');
    const { search, status, leaveType, startDate, endDate } = filters;
    const { page = 1, limit = 10, sortBy = 'startDate', sortOrder = 'desc' } = options;
    // Build query
    const query: any = { userId };

    if (status) {
      query.status = status;
    }

    if (leaveType) {
      query.leaveType = { $regex: leaveType, $options: 'i' }; // Case-insensitive search
    }

    // Handle date filters first
    if (startDate) {
      const start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
      query.startDate = { $gte: start };
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      query.endDate = { $lte: end };
    }

    // Handle search filter
    if (search) {
      // Escape special regex characters in search string
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Search in document fields (leaveType, reason, status)
      const searchConditions: any[] = [
        { leaveType: { $regex: escapedSearch, $options: 'i' } },
        { reason: { $regex: escapedSearch, $options: 'i' } },
        { status: { $regex: escapedSearch, $options: 'i' } },
      ];

      // Search in User collection to find matching users
      // Since user data is populated after query, we need to search users first
      const userSearchFilter: any = {
        $or: [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
        ]
      };

      // Combine with userId filter since we're already filtering by userId
      userSearchFilter._id = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

      const matchingUsers = await User.find(userSearchFilter).select('_id').lean();

      // If users found, add userId filter (though it should match since we're already filtering by userId)
      if (matchingUsers.length > 0) {
        const userIds = matchingUsers.map(u => u._id);
        searchConditions.push({ userId: { $in: userIds } });
      }

      // Combine search with existing filters using $and
      // This ensures search works correctly with date filters and other filters
      const existingFilters = { ...query };
      delete existingFilters.$or;
      
      query.$and = [
        existingFilters,
        { $or: searchConditions }
      ];
    }

    // Fetch leaves and total count concurrently
    const [leaves, total] = await Promise.all([
      Leave.find(query)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Leave.countDocuments(query),
    ]);

    if (!leaves.length) {
      return { leaves: [], total: 0 };
    }

    // Populate user and approver details
    const populatedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const [user, approver] = await Promise.all([
          User.findById(leave.userId).select('name email').lean(),
          leave.approvedById ? User.findById(leave.approvedById).select('name email').lean() : null,
        ]);

        if (user) {
          leave.user = {
            name: user.name,
            email: user.email,
          };
        }

        if (approver) {
          leave.approvedBy = {
            _id: approver._id,
            name: approver.name,
            email: approver.email,
          };
        }

        return leave;
      })
    );

    return { leaves: populatedLeaves, total };
  }


  async findAll(query: ILeaveQuery): Promise<{ leaves: ILeave[], meta: { page: number, limit: number, total: number, totalPages: number } }> {
    const { userId, status, leaveType, startDate, endDate, page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;
    if (leaveType) filter.leaveType = { $regex: `^${leaveType}$`, $options: 'i' }; // Case-insensitive exact match
    
    // Handle date filters
    if (startDate || endDate) {
      filter.$or = [
        {
          startDate: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        },
        {
          endDate: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        },
      ];
    }

    // Handle search filter
    if (search) {
      // Escape special regex characters in search string
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Search in document fields (leaveType, reason, appliedTo.name, status)
      const searchConditions: any[] = [
        { leaveType: { $regex: escapedSearch, $options: 'i' } },
        { reason: { $regex: escapedSearch, $options: 'i' } },
        { 'appliedTo.name': { $regex: escapedSearch, $options: 'i' } },
        { status: { $regex: escapedSearch, $options: 'i' } },
      ];

      // Search in User collection to find matching users
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
        searchConditions.push({ userId: { $in: userIds } });
      }

      // If there's already a $or for dates, we need to combine them properly
      if (filter.$or) {
        // We need to use $and to combine date filter with search filter
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions }
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    console.log(filter);
    const [leaves, total] = await Promise.all([
      Leave.find(filter as FilterQuery<ILeave>).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Leave.countDocuments(filter as FilterQuery<ILeave>),
    ]);

    // Populate all references in parallel for better performance
    const populatedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const [user, approver] = await Promise.all([
          User.findById(leave.userId).select('name email'),
          leave.approvedById ? User.findById(leave.approvedById).select('name email') : null,
        ]);

        if (user) {
          leave.user = {
            name: user.name,
            email: user.email,
          };
        }



        if (approver) {
          leave.approvedBy = {
            _id: approver._id,
            name: approver.name,
            email: approver.email,
          };
        }

        return leave;
      })
    );
    console.log(populatedLeaves);
    return {
      leaves: populatedLeaves,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async create(leaveData: ILeaveCreate): Promise<ILeave> {
    // VALIDATION 1: Check if leave type is valid for employee's country
    const user = await User.findById(leaveData.userId).select('country name email');
    if (!user) {
      throw new Error('User not found');
    }

    // If leaveType is not provided, fetch it from Lov using leaveTypeId
    // Note: leaveTypeId points to a Lov document with values array
    if (!leaveData.leaveType && leaveData.leaveTypeId) {
      const lov = await LOV.findById(leaveData.leaveTypeId);
      if (!lov) {
        throw new Error(`Leave type Lov not found for ID: ${leaveData.leaveTypeId}`);
      }

      // Find the first active value
      let selectedValue = lov.values.find(v => v.isActive !== false);

      // Fallback to first value if no active value found
      if (!selectedValue && lov.values.length > 0) {
        selectedValue = lov.values[0];
      }

      if (!selectedValue) {
        throw new Error('No leave type value found in Lov document');
      }

      leaveData.leaveType = selectedValue.value; // Set the value (e.g., "annual", "sick")
      console.log(`✅ [Leave Type] Fetched from Lov: ${leaveData.leaveType} for leaveTypeId: ${leaveData.leaveTypeId}`);
    }

    // Ensure leaveType is set before proceeding
    if (!leaveData.leaveType) {
      throw new Error('Leave type is required. Please provide leaveType or ensure leaveTypeId points to a valid Lov with values.');
    }

    // India-specific: Validate half-day leave restrictions
    if (leaveData.leaveDuration === 'half-day') {
      if (user.country !== 'IN') {
        throw new Error('Half-day leaves are only available for India employees');
      }

      // Validate half-day specific rules
      const startDateStr = new Date(leaveData.startDate).toDateString();
      const endDateStr = new Date(leaveData.endDate).toDateString();

      if (startDateStr !== endDateStr) {
        throw new Error('Half-day leaves must be on the same day (startDate = endDate)');
      }

      if (!leaveData.halfDayType) {
        throw new Error('halfDayType is required for half-day leaves');
      }

      // Set noOfDays to 0.5 for half-day leaves
      leaveData.noOfDays = 0.5;
    } else {
      // Default to full-day if not specified
      leaveData.leaveDuration = leaveData.leaveDuration || 'full-day';
      // Clear halfDayType for full-day leaves
      if (leaveData.leaveDuration === 'full-day') {
        leaveData.halfDayType = undefined;
      }
    }

    // Validate leave type against country
    if (leaveData.leaveType) {
      try {
        validateLeaveTypeForCountry(user.country, leaveData.leaveType);
        console.log(`✅ [Leave Validation] ${leaveData.leaveType} is valid for ${user.country} employee: ${user.name}`);
      } catch (error: any) {
        console.error(`❌ [Leave Validation] ${error.message}`);
        throw error;
      }
    }

    // Check for overlapping leaves (handle half-day leaves)
    // Exclude 'Rejected' and 'Cancelled' statuses - cancelled leaves can be re-applied
    const baseQuery: any = {
      userId: leaveData.userId,
      status: { $nin: ['Rejected', 'Cancelled'] },
    };

    if (leaveData.leaveDuration === 'half-day') {
      // For half-day leaves:
      // 1. Check if same halfDayType exists on same date
      // 2. Check if full-day leave exists on same date
      const leaveDate = new Date(leaveData.startDate);
      const dayStart = new Date(leaveDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(leaveDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Check 1: Same halfDayType on same date
      const sameHalfDayQuery = {
        ...baseQuery,
        $and: [
          {
            startDate: { $gte: dayStart, $lte: dayEnd }
          },
          {
            endDate: { $gte: dayStart, $lte: dayEnd }
          },
          {
            halfDayType: leaveData.halfDayType
          },
          {
            leaveDuration: 'half-day'
          }
        ]
      };

      // Check 2: Full-day leave on same date
      // Check if any full-day leave (or leave without leaveDuration field) overlaps with the half-day date
      const fullDayQuery = {
        ...baseQuery,
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
        $or: [
          { leaveDuration: { $ne: 'half-day' } },
          { leaveDuration: { $exists: false } } // Old leaves without leaveDuration field are treated as full-day
        ]
      };

      const sameHalfDayLeave = await Leave.findOne(sameHalfDayQuery);
      const fullDayLeave = await Leave.findOne(fullDayQuery);

      if (sameHalfDayLeave) {
        const sessionName = leaveData.halfDayType === 'first-half' ? 'morning' : 'afternoon';
        throw new Error(`A ${sessionName} half-day leave already exists for this date`);
      }

      if (fullDayLeave) {
        throw new Error('A full-day leave already exists for this date. Cannot apply half-day leave.');
      }
    } else {
      // For full-day leaves:
      // 1. Check if any full-day leave overlaps with date range
      // 2. Check if any half-day leave exists on any date in the range
      const startDate = new Date(leaveData.startDate);
      const endDate = new Date(leaveData.endDate);

      // Check 1: Full-day leave overlap
      // Check if any full-day leave (or leave without leaveDuration field) overlaps with the date range
      const fullDayOverlapQuery = {
        ...baseQuery,
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
        $or: [
          { leaveDuration: { $ne: 'half-day' } },
          { leaveDuration: { $exists: false } } // Old leaves without leaveDuration field are treated as full-day
        ]
      };

      // Check 2: Any half-day leave in the date range
      // For each day in the range, check if any half-day exists
      const halfDayOverlapQuery = {
        ...baseQuery,
        leaveDuration: 'half-day',
        $and: [
          {
            startDate: { $lte: endDate }
          },
          {
            endDate: { $gte: startDate }
          }
        ]
      };

      const fullDayOverlap = await Leave.findOne(fullDayOverlapQuery);
      const halfDayOverlap = await Leave.findOne(halfDayOverlapQuery);

      if (fullDayOverlap) {
        throw new Error('Leave dates overlap with existing full-day leave request');
      }

      if (halfDayOverlap) {
        throw new Error('A half-day leave already exists in the selected date range. Cannot apply full-day leave.');
      }
    }
    console.log(leaveData, 'leaveData 2 data');
    const leave: ILeave = await Leave.create(leaveData);
    // Update leave summary when leave is created
    console.log(leave, 'leave data 2 final');


    //Email to Manager 
    const manager: IUser = await User.findById(
      new Types.ObjectId(leave.appliedTo?._id)
    ).select('name email');
    const applier: IUser = await User.findById(new Types.ObjectId(leave.userId)).select('name email');
    //get the Recipient Email
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    console.log(manager, "manager")

    const htmlContent = generateEmailTemplate('leaveApplyEmail', {
      managerName: manager.name,
      employeeName: applier.name,
      leaveType: leave.leaveType,
      fromDate: leave.startDate.toDateString(),
      toDate: leave.endDate.toDateString(),
      totalDays: leave.noOfDays,
      reason: leave.reason,
      approvalLink: `${appUrl}/manager/actions/leaves/${leave._id}`,
      companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS',
    });

    await emailService.sendEmail({
      body: {
        to: manager.email,
        subject: `Leave Request from ${applier.name}`,
        text: `${applier.name} has requested leave from ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} for ${leave.leaveType}.`,
        html: htmlContent,
      }
    });


    console.log("first")
    // Normalize leaveType to lowercase to match leave summary keys (annual, sick, etc.)
    const normalizedLeaveType = (leave.leaveType || '').toLowerCase();
    await this.leaveSummaryService.updateLeaveBalance(
      leave.userId as Types.ObjectId,
      new Date(leave.startDate).getFullYear(),
      normalizedLeaveType,
      leave.noOfDays as number,
      leave._id as Types.ObjectId
    );

    return this.findById(leave._id as string);
  }

  async updateStatus(id: string | Types.ObjectId, updateData: ILeaveStatusUpdate): Promise<ILeave> {
    console.log("updateStatus 1", id);
    const leave = await Leave.findById(id);
    console.log(leave, "updatestatus 2")
    if (!leave) {
      throw new Error('Leave request not found');
    }

    if (leave.status !== 'Pending') {
      throw new Error('Leave request has already been processed');
    }
    console.log(updateData, 'updateData in update Status');
    leave.status = updateData.status;
    leave.approvedById = updateData.approvedById;
    console.log(updateData.approvedBy, 'updateData.approvedBy');
    console.log(updateData.approvedBy?._id, 'updateData.approvedBy?.id');
    console.log(updateData.approvedBy?.name, 'updateData.approvedBy?.name');
    console.log(updateData.approvedBy?.email, 'updateData.approvedBy?.email');
    leave.approvedBy = updateData.approvedBy
      ? {
        _id: typeof updateData.approvedBy._id === 'string'
          ? updateData.approvedBy._id
          : updateData.approvedBy._id.toString(),
        name: updateData.approvedBy.name,
        email: updateData.approvedBy.email,
      }
      : undefined;

    leave.approvedAt = new Date();
    // leave.noOfDays = updateData.noOfDays;
    if (updateData.remarks) leave.remarks = updateData.remarks;
    await leave.save();

    const employee: IUser = await User.findById(new Types.ObjectId(leave.userId)).select('name email');
    const approver: IUser = await User.findById((leave.approvedBy?._id)).select('name');


    const htmlContent = generateEmailTemplate('leaveApprovalEmail', {
      employeeName: employee.name,
      approverName: approver?.name || 'Manager',
      leaveType: leave.leaveType,
      fromDate: leave.startDate.toDateString(),
      toDate: leave.endDate.toDateString(),
      totalDays: leave.noOfDays,
      remarks: leave.remarks || '',
      status: leave.status, // 'Approved' or 'Rejected'
      companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS',
    });
    await emailService.sendEmail({
      body: {
        to: employee.email,
        subject: `Your Leave Request has been ${leave.status}`,
        text: `Your leave from ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} has been ${leave.status.toLowerCase()} by ${approver?.name || 'manager'}.`,
        html: htmlContent,
      }
    });


    // If leave is approved, mark attendance records as onLeave
    if (updateData.status === 'Approved') {
      const startDate = new Date(leave.startDate);
      const endDate = new Date(leave.endDate);

      // Create attendance records for each day of leave
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        console.log(leave.userId);
        console.log(leave, 'leave updated ==>> ');
        let resatten = await AttendanceRecord.findOneAndUpdate(
          {
            userId: leave.userId,
            shiftDay: currentDate,
          },
          {
            $set: {
              // status: 'onLeave',
              attendanceStatus: ['On-Leave'],
              // leaveRequestId: leave._id,
              updatedAt: new Date(),
              updatedBy: updateData.approvedById
            }
          },
          { upsert: true, strict: false }
        );
        console.log(resatten, 'resatten');
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    if (updateData.status === 'Rejected' || updateData.status === 'Cancelled') {
      console.log("3, rejected or cancelled");
      const startDate = new Date(leave.startDate);
      const endDate = new Date(leave.endDate);

      // Iterate through each day of the leave period
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        console.log(leave.userId);
        console.log(leave, 'leave updated ==>> ');

        // Revert attendance records for the leave period
        let resatten = await AttendanceRecord.findOneAndUpdate(
          {
            userId: leave.userId,
            shiftDay: currentDate,
            leaveRequestId: leave._id,
          },
          {
            $set: {
              // status: 'present',
              attendanceStatus: "Absent",
              updatedAt: new Date(),
              updatedBy: updateData.rejectedById,
            },
            $unset: {
              leaveRequestId: '',
            },
          },
          { strict: false }
        );

        console.log(resatten, 'resatten');
        currentDate.setDate(currentDate.getDate() + 1);
      }

      let result = await this.leaveSummaryService.createOrUpdateLeaveSummary(
        leave.userId as Types.ObjectId,
        startDate.getFullYear(),
        leave.leaveType as keyof ILeaveSummary,
        updateData.status as string,
        { availed: (leave.noOfDays as number) }
      );
      console.log(result, 'result');

      // Optionally log the rejection event or notify the user
      console.log(`Leave request ${leave._id} rejected by user ${updateData.rejectedById}`);
    }


    return this.findById(id);
  }

  async cancel(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<{ message: string }> {
    const leave = await Leave.findOne({
      _id: id,
      userId,
    });

    if (!leave) {
      throw new Error('Leave request not found');
    }

    if (leave.status !== 'Pending') {
      throw new Error('Cannot cancel processed leave request');
    }

    await leave.deleteOne();
    return { message: 'Leave request cancelled successfully' };
  }

  async getLeaveBalance(userId: Types.ObjectId, leaveTypeId: Types.ObjectId | string): Promise<{
    total: number;
    used: number;
    remaining: number;
  }> {
    // This is a placeholder for leave balance calculation
    // In a real application, this would involve more complex logic
    const approvedLeaves = await Leave.countDocuments({
      userId,
      leaveTypeId,
      status: 'Approved',
      startDate: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
      },
    });

    return {
      total: 20, // This should come from configuration
      used: approvedLeaves,
      remaining: 20 - approvedLeaves,
    };
  }

  // Service method
  async getLeavesByAppliedTo(query: ILeaveQuery): Promise<{
    data: ILeave[],
    meta: {
      page: number,
      limit: number,
      total: number,
      totalPages: number
    }
  }> {
    console.log(query, "2, query")
    const { appliedTo, userId, status, startDate, endDate, page = 1, limit = 5, search } = query;
    const skip = (page - 1) * limit;

    const filter: any = { 'appliedTo._id': appliedTo }; // Initialize filter with appliedTo

    if (userId) filter.userId = userId;
    if (status) filter.status = status; // Only filter by status if explicitly provided
    if (startDate || endDate) {
      filter.$or = [
        {
          startDate: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        },
        {
          endDate: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        },
      ];
    }

    // Handle search filter
    if (search) {
      // Escape special regex characters in search string
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Search in document fields (leaveType, reason, appliedTo.name, status)
      const searchConditions: any[] = [
        { leaveType: { $regex: escapedSearch, $options: 'i' } },
        { reason: { $regex: escapedSearch, $options: 'i' } },
        { 'appliedTo.name': { $regex: escapedSearch, $options: 'i' } },
        { status: { $regex: escapedSearch, $options: 'i' } },
      ];

      // Search in User collection to find matching users
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
        searchConditions.push({ userId: { $in: userIds } });
      }

      // If there's already a $or for dates, we need to combine them properly
      if (filter.$or) {
        // We need to use $and to combine date filter with search filter
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions }
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    console.log('Filter:', filter);

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Leave.countDocuments(filter),
    ]);
    console.log(leaves, "2. leaves")
    // Populate all references in parallel for better performance
    const populatedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const [user, approver] = await Promise.all([
          User.findById(leave.userId).select('name email'),
          leave.approvedById ? User.findById(leave.approvedById).select('name email') : null,
        ]);

        if (user) {
          leave.user = {
            name: user.name,
            email: user.email,
          };
        }

        if (approver) {
          leave.approvedBy = {
            _id: approver._id,
            name: approver.name,
            email: approver.email,
          };
        }

        return leave;
      })
    );

    console.log(populatedLeaves, "3. populatedLeaves")
    return {
      data: populatedLeaves,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  };

}
