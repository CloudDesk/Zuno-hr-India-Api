import { Types } from 'mongoose';
import { AttendanceRegularization, IAttendanceRegularization } from '../models/attendance-regularization.model';
import { AttendanceRecord } from '../models/attendance-record.model';
import { IShift, IUser, ShiftAssignment, User } from '../models';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { generateEmailTemplate } from '../emails/templates';
import { emailService } from './email.service';

interface IAttendanceMetrics {
    totalWorkHours: string;
    breakHours: string;
    actualWorkHours: string;
    shiftHours: string;
    shortfallHours: string;
    excessHours: string;
    hasShortfall: boolean;
    hasExcessHours: boolean;
}
interface IShiftWindow {
    shiftStart: Date;
    shiftEnd: Date;
    windowStart: Date;
    windowEnd: Date;
}


interface RegularizationFilters {
    status?: 'Pending' | 'Approved' | 'Rejected' | 'Rejected-Absent' | 'Rejected-Leave' | 'Withdrawn';
    statuses?: string; // Comma-separated statuses
    allStatus?: boolean;
    date?: string; // Single date (legacy)
    startDate?: string;
    endDate?: string;
    search?: string;
}

interface AssignedRegularizationListOptions {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}


export class AttendanceRegularizationService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context
    }

    /**
     * Get timezone offset in hours based on user's country
     * @param country - User's country code ('IN' | 'AE')
     * @returns Timezone offset in hours
     */
    private getTimezoneOffsetHours(country: string): number {
        switch (country) {
            case 'IN': return 5.5; // IST (UTC+5:30)
            case 'AE': return 4;   // UAE (UTC+4:00)
            default: return 5.5;   // Default to IST for backward compatibility
        }
    }

    /**
     * Get timezone offset in hours and minutes based on user's country
     * @param country - User's country code ('IN' | 'AE')
     * @returns Object with hours and minutes offset
     */
    private getTimezoneOffset(country: string): { hours: number; minutes: number } {
        switch (country) {
            case 'IN': return { hours: 5, minutes: 30 }; // IST (UTC+5:30)
            case 'AE': return { hours: 4, minutes: 0 };  // UAE (UTC+4:00)
            default: return { hours: 5, minutes: 30 };   // Default to IST for backward compatibility
        }
    }

    async getRegularizationRecords(
        userId: string,
        filters: RegularizationFilters = {}
    ) {
        console.log("getRegularizationRecords", filters);

        // Validate userId
        if (!Types.ObjectId.isValid(userId)) {
            throw new Error('Invalid userId');
        }

        // Build base query
        const query: any = {
            userId: new Types.ObjectId(userId)
        };

        // Handle status filtering with priority order
        if (filters.allStatus) {
            // If allStatus is true, don't add any status filter
            console.log("Fetching records for all statuses");
        } else if (filters.statuses) {
            // Parse comma-separated statuses
            const statusArray = filters.statuses
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            // Validate each status
            const validStatuses = ['Pending', 'Approved', 'Rejected', 'Rejected-Absent', 'Rejected-Leave', 'Withdrawn'];
            const invalidStatuses = statusArray.filter(status => !validStatuses.includes(status));

            if (invalidStatuses.length > 0) {
                throw new Error(`Invalid status values: ${invalidStatuses.join(', ')}`);
            }

            if (statusArray.length > 0) {
                query.status = { $in: statusArray };
            }
        } else {
            // Use single status (legacy behavior)
            query.status = filters.status || 'Pending';
        }

        // Handle date filtering
        if (filters.startDate || filters.endDate) {
            // Date range filtering
            const dateQuery: any = {};

            if (filters.startDate) {
                const startDate = new Date(filters.startDate);
                if (isNaN(startDate.getTime())) {
                    throw new Error('Invalid startDate format. Expected format: YYYY-MM-DD');
                }
                startDate.setUTCHours(0, 0, 0, 0);
                dateQuery.$gte = startDate;
            }

            if (filters.endDate) {
                const endDate = new Date(filters.endDate);
                if (isNaN(endDate.getTime())) {
                    throw new Error('Invalid endDate format. Expected format: YYYY-MM-DD');
                }
                endDate.setUTCHours(23, 59, 59, 999);
                dateQuery.$lte = endDate;
            }

            query.shiftDay = dateQuery;
        } else if (filters.date) {
            // Single date filtering (legacy behavior)
            const parsedDate = new Date(filters.date);
            if (isNaN(parsedDate.getTime())) {
                throw new Error('Invalid date format. Expected format: YYYY-MM-DD');
            }

            const startOfDay = new Date(parsedDate);
            startOfDay.setUTCHours(0, 0, 0, 0);

            const endOfDay = new Date(parsedDate);
            endOfDay.setUTCHours(23, 59, 59, 999);

            query.shiftDay = { $gte: startOfDay, $lte: endOfDay };
        }

        if (filters.search) {
            const escapedSearch = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { reason: { $regex: escapedSearch, $options: 'i' } },
                { status: { $regex: escapedSearch, $options: 'i' } },
                { 'approver.name': { $regex: escapedSearch, $options: 'i' } },
            ];
        }

        console.log("Final query:", JSON.stringify(query, null, 2));

        // Fetch regularization records
        const records = await AttendanceRegularization.find(query).lean();
        console.log(`Found ${records.length} records`);

        if (!records.length) {
            return [];
        }

        return records.map(record => ({
            _id: record._id.toString(),
            attendanceId: record.attendanceId?.toString(),
            shiftDay: record.shiftDay.toISOString(),
            from: record.from.toISOString(),
            to: record.to.toISOString(),
            reason: record.reason,
            status: record.status,
            approver: record.approver,
            approvedDate: record.approvedDate ? record.approvedDate.toISOString() : null,
            comments: record.comments || null
        }));
    }

    // attendance-regularization.service.ts

    async getRegularizationRecordsByUserIdAndDate(userId: string,
        status: 'Pending' | 'Approved' | 'Rejected' | 'Rejected-Absent' | 'Rejected-Leave' | 'Withdrawn' = 'Pending',
        date?: string
    ) {
        console.log("getRegularizationRecordsByUserIdAndDate", status)
        // Validate userId
        /*  if (!Types.ObjectId.isValid(userId)) {
              throw new Error('Invalid userId');
          }
          // Build query
          const query: any = {
              userId: new Types.ObjectId(userId),
              status
          };
          // Add date filter if provided
          if (date) {
              const parsedDate = new Date(date);
              if (isNaN(parsedDate.getTime())) {
                  throw new Error('Invalid date format. Expected format: YYYY-MM-DD');
              }
  
              const startOfDay = new Date(parsedDate);
              startOfDay.setUTCHours(0, 0, 0, 0);
  
              const endOfDay = new Date(parsedDate);
              endOfDay.setUTCHours(23, 59, 59, 999);
  
              query.shiftDay = { $gte: startOfDay, $lte: endOfDay };
          }
  
          // Fetch regularization records for the user on the given date
          const records = await AttendanceRegularization.find(query).lean();
          console.log(records, "records")
          if (!records.length) {
              return [];
              // throw new Error('No regularization records found for the given user and date');
          }
  
          return records.map(record => ({
              _id: record._id.toString(),
              attendanceId: record.attendanceId?.toString(),
              shiftDay: record.shiftDay.toISOString(),
              from: record.from.toISOString(),
              to: record.to.toISOString(),
              reason: record.reason,
              status: record.status,
              approver: record.approver,
              approvedDate: record.approvedDate ? record.approvedDate.toISOString() : null,
              comments: record.comments || null
          }));
          */
        return this.getRegularizationRecords(userId, { status, date });
    }

    async getAssignedRegularizationRecords(
        approverId: string,
        status?: 'Pending' | 'Approved' | 'Rejected' | 'Rejected-Absent' | 'Rejected-Leave' | 'Withdrawn',
        isAdmin: boolean = false,
        date?: string,
        search?: string,
        startDate?: string,
        endDate?: string,
        statuses?: string,
        options: AssignedRegularizationListOptions = {}
    ) {
        // Validate approverId
        if (!Types.ObjectId.isValid(approverId)) {
            throw new Error('Invalid approverId');
        }

        // Build query — omit status filter entirely when undefined (= "All")
        const query: any = {};
        let statusArray: string[] = [];

        if (statuses) {
            const validStatuses = ['Pending', 'Approved', 'Rejected', 'Rejected-Absent', 'Rejected-Leave', 'Withdrawn'];
            statusArray = statuses
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            const invalidStatuses = statusArray.filter((item) => !validStatuses.includes(item));

            if (invalidStatuses.length > 0) {
                throw new Error(`Invalid status values: ${invalidStatuses.join(', ')}`);
            }

            if (statusArray.length === 1) {
                query.status = statusArray[0];
            } else if (statusArray.length > 1) {
                query.status = { $in: statusArray };
            }
        } else if (status !== undefined) {
            query.status = status;
        }

        // If not admin, filter by approverId
        if (!isAdmin) {
            query['approver.id'] = new Types.ObjectId(approverId);
        }

        // Add date range filtering
        if (startDate || endDate) {
            const dateQuery: any = {};
            if (startDate) {
                const sd = new Date(startDate);
                sd.setUTCHours(0, 0, 0, 0);
                dateQuery.$gte = sd;
            }
            if (endDate) {
                const ed = new Date(endDate);
                ed.setUTCHours(23, 59, 59, 999);
                dateQuery.$lte = ed;
            }
            query.shiftDay = dateQuery;
        } else if (date) {
            // Add single date filter if provided
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                throw new Error('Invalid date format. Expected format: YYYY-MM-DD');
            }

            const startOfDay = new Date(parsedDate);
            startOfDay.setUTCHours(0, 0, 0, 0);

            const endOfDay = new Date(parsedDate);
            endOfDay.setUTCHours(23, 59, 59, 999);

            query.shiftDay = { $gte: startOfDay, $lte: endOfDay };
        }

        if (search) {
            const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchConditions: any[] = [
                { reason: { $regex: escapedSearch, $options: 'i' } },
                { status: { $regex: escapedSearch, $options: 'i' } },
            ];

            const userSearchFilter = {
                $or: [
                    { name: { $regex: escapedSearch, $options: 'i' } },
                    { email: { $regex: escapedSearch, $options: 'i' } },
                    { employeeCode: { $regex: escapedSearch, $options: 'i' } },
                ]
            };
            const matchingUsers = await User.find(userSearchFilter).select('_id').lean();
            if (matchingUsers.length > 0) {
                searchConditions.push({ userId: { $in: matchingUsers.map(u => u._id) } });
            }

            query.$or = searchConditions;
        }

        const page = Math.max(1, Number(options.page) || 1);
        const limit = Math.min(Math.max(1, Number(options.limit) || 10), 100);
        const skip = (page - 1) * limit;
        const sortDirection = options.sortOrder === 'asc' ? 1 : -1;
        const sortFieldMap: Record<string, string> = {
            shiftDay: 'shiftDay',
            from: 'from',
            to: 'to',
            reason: 'reason',
            status: 'status',
            createdAt: 'createdAt',
            userName: 'user.name',
            user: 'user.name',
        };

        const sortField = options.sortBy ? sortFieldMap[options.sortBy] : undefined;
        const sortStage: Record<string, 1 | -1> = sortField
            ? { [sortField]: sortDirection, _id: -1 }
            : status === undefined || statusArray.length > 1
                ? { statusRank: 1, createdAt: -1, shiftDay: -1, _id: -1 }
                : { createdAt: -1, shiftDay: -1, _id: -1 };

        const [records, total] = await Promise.all([
            AttendanceRegularization.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user',
                        pipeline: [{ $project: { _id: 1, name: 1 } }]
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        statusRank: { $cond: [{ $eq: ['$status', 'Pending'] }, 0, 1] }
                    }
                },
                { $sort: sortStage },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        attendanceId: 1,
                        shiftDay: 1,
                        from: 1,
                        to: 1,
                        reason: 1,
                        status: 1,
                        approver: 1,
                        approvedDate: 1,
                        comments: 1,
                        userId: '$user._id',
                        userName: '$user.name'
                    }
                }
            ]),
            AttendanceRegularization.countDocuments(query)
        ]);

        const data = records.map(record => ({
            _id: record._id.toString(),
            attendanceId: record.attendanceId?.toString(),
            shiftDay: record.shiftDay.toISOString(),
            from: record.from.toISOString(),
            to: record.to.toISOString(),
            reason: record.reason,
            status: record.status,
            approver: record.approver,
            approvedDate: record.approvedDate ? record.approvedDate.toISOString() : null,
            comments: record.comments || null,
            userId: record.userId?.toString() || '',
            userName: record.userName || ''
        }));

        return {
            data,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getRegularizationRecordById(id: string, user: any) {
        if (!Types.ObjectId.isValid(id)) {
            throw new Error('Invalid regularization record ID');
        }

        const record = await AttendanceRegularization.findById(id)
            .populate('userId', '_id name')
            .lean();

        if (!record) {
            throw new Error('Regularization record not found');
        }

        const isAdmin = user.role?.toLowerCase() === 'admin';
        const isOwner = record.userId._id.toString() === user._id.toString();
        const isApprover = record.approver.id.toString() === user._id.toString();

        if (!isAdmin && !isOwner && !isApprover) {
            throw new Error('Forbidden: You are not authorized to view this record');
        }

        return {
            _id: record._id.toString(),
            attendanceId: record.attendanceId?.toString(),
            shiftDay: record.shiftDay.toISOString(),
            from: record.from.toISOString(),
            to: record.to.toISOString(),
            reason: record.reason,
            status: record.status,
            approver: record.approver,
            approvedDate: record.approvedDate ? record.approvedDate.toISOString() : null,
            comments: record.comments || null,
            userId: record.userId?._id?.toString() || '',
            userName: (record.userId && typeof record.userId !== 'string' && 'name' in record.userId) ? record.userId.name : ''
        };
    }


    async createRegularization(data: Partial<IAttendanceRegularization>): Promise<IAttendanceRegularization> {

        console.log("0 create Att-Regularization", data)


        await this.validateRegularization(data as IAttendanceRegularization)
        const regularization = new AttendanceRegularization(data);
        await regularization.save();
        console.log("1 create Att-Regularization", regularization)

        // update the attendance with fileed 

        const attendance = await AttendanceRecord.findById(data.attendanceId);

        console.log("2 create Att-Regularization", attendance)

        if (attendance) {
            attendance.regularization = {
                hasRegularizationRequest: true,
                isRegularized: false,
                status: 'Pending',
                regularizationId: regularization._id,
            }

            // Set status to pending_regularization if not a special status
            const specialStatuses = ['holiday_swipe', 'leave_swipe', 'overridden', 'regularized'];
            if (!specialStatuses.includes(attendance.status)) {
                attendance.status = 'pending_regularization';
            }

            await attendance.save();
            console.log("3 create Att-Regularization", attendance);
        }

        // Send Email Notification to Approver
        try {
            const approverUser: IUser = await User.findById(new Types.ObjectId(data.approver?.id)).select('name email');
            const employeeUser: IUser = await User.findById(new Types.ObjectId(data.userId)).select('name email country');

            if (approverUser?.email && employeeUser) {
                const appUrl = process.env.APP_URL || 'http://localhost:5173';
                const userCountry = employeeUser.country || 'IN';
                const fromTime = this.formatTimeLocal(regularization.from, userCountry);
                const toTime = this.formatTimeLocal(regularization.to, userCountry);

                const htmlContent = generateEmailTemplate('attendanceRegularizeApply', {
                    approverName: approverUser.name,
                    employeeName: employeeUser.name,
                    shiftDay: regularization.shiftDay.toDateString(),
                    fromTime: fromTime,
                    toTime: toTime,
                    reason: regularization.reason,
                    reviewLink: `${appUrl}/manager/attendance-approvals/${regularization._id}`,
                    companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS'
                });

                await emailService.sendEmail({
                    body: {
                        to: approverUser.email,
                        subject: `Attendance Regularization Request from ${employeeUser.name}`,
                        text: `${employeeUser.name} has requested regularization on ${regularization.shiftDay.toDateString()} from ${fromTime} to ${toTime}.`,
                        html: htmlContent
                    }
                });
            }
        } catch (emailError) {
            console.error('Failed to send email to approver for attendance regularization:', emailError);
            // Don't fail the request if email fails
        }

        // Send Email Notification to All Admins
        try {
            const admins = await User.find({
                $or: [
                    { role: 'admin' },
                    { isSuperAdmin: true }
                ],
                active: true
            }).select('name email').lean();

            if (admins && admins.length > 0) {
                const employeeUser: IUser = await User.findById(new Types.ObjectId(data.userId)).select('name email country');
                const userCountry = employeeUser?.country || 'IN';

                if (employeeUser) {
                    const adminEmails = admins.map(admin => admin.email).filter(Boolean);

                    if (adminEmails.length > 0) {
                        const shiftDayFormatted = regularization.shiftDay.toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                        const fromTime = this.formatTimeLocal(regularization.from, userCountry);
                        const toTime = this.formatTimeLocal(regularization.to, userCountry);

                        const adminEmailText = `Dear Admin,

An attendance regularization request has been submitted by ${employeeUser.name}.

Request Details:
- Employee: ${employeeUser.name} (${employeeUser.email || 'N/A'})
- Date: ${shiftDayFormatted}
- Requested In Time: ${fromTime}
- Requested Out Time: ${toTime}
- Reason: ${regularization.reason}
- Status: Pending
- Approver: ${data.approver?.name || 'N/A'}

This is an automated notification for your records.

Regards,
${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`;

                        await emailService.sendEmail({
                            body: {
                                to: adminEmails,
                                subject: `Attendance Regularization Request Submitted - ${employeeUser.name}`,
                                text: adminEmailText,
                                html: adminEmailText.replace(/\n/g, '<br>'),
                            }
                        });

                        console.log(`Email notification sent to ${adminEmails.length} admin(s) for attendance regularization request ${regularization._id}`);
                    }
                }
            }
        } catch (adminEmailError) {
            console.error('Failed to send email to admins for attendance regularization request:', adminEmailError);
            // Don't fail the request if admin email fails
        }

        return regularization;
    }


    async createBulkRegularization(data: Array<{
        userId: string;
        date: string;
        fromTime: string;  // Local time HH:mm
        toTime: string;    // Local time HH:mm
        reason: string;
        shiftType: string;
        attendanceId?: string | null;
        approver: { id: string; name: string };
    }>): Promise<any> {
        const results = [];
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        const companyName = process.env.COMPANY_NAME || 'CloudDesk HRMS';
        const specialStatuses = ['holiday_swipe', 'leave_swipe', 'overridden', 'regularized'];
        const successfulNotifications: Array<{
            regularization: IAttendanceRegularization;
            userId: string;
            approverId: string;
            approverName: string;
            shiftDay: Date;
            fromTime: string;
            toTime: string;
            reason: string;
        }> = [];

        const normalizeObjectId = (id: string): string => new Types.ObjectId(id).toString();

        const uniqueValidIds = Array.from(new Set(
            data
                .flatMap(entry => [entry.userId, entry.approver?.id])
                .filter((id): id is string => Boolean(id) && Types.ObjectId.isValid(id))
                .map(normalizeObjectId)
        ));

        const uniqueValidAttendanceIds = Array.from(new Set(
            data
                .map(entry => entry.attendanceId)
                .filter((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id))
        ));

        const validShiftDays = Array.from(new Set(
            data
                .map(entry => {
                    const shiftDay = new Date(entry.date);
                    shiftDay.setUTCHours(0, 0, 0, 0);
                    return shiftDay;
                })
                .filter(shiftDay => !isNaN(shiftDay.getTime()))
                .map(shiftDay => shiftDay.getTime())
        )).map(time => new Date(time));

        const earliestShiftDay = validShiftDays.reduce(
            (earliest, shiftDay) => shiftDay < earliest ? shiftDay : earliest,
            new Date(8640000000000000)
        );
        const latestShiftDay = validShiftDays.reduce(
            (latest, shiftDay) => shiftDay > latest ? shiftDay : latest,
            new Date(0)
        );

        const [users, admins, attendanceRecords, shiftAssignments, existingRegularizations] = await Promise.all([
            uniqueValidIds.length
                ? User.find({ _id: { $in: uniqueValidIds.map(id => new Types.ObjectId(id)) } })
                    .select('name email country')
                    .lean()
                : [],
            User.find({
                $or: [
                    { role: 'admin' },
                    { isSuperAdmin: true }
                ],
                active: true
            }).select('name email').lean(),
            uniqueValidAttendanceIds.length
                ? AttendanceRecord.find({ _id: { $in: uniqueValidAttendanceIds.map(id => new Types.ObjectId(id)) } })
                : [],
            uniqueValidIds.length && validShiftDays.length
                ? ShiftAssignment.find({
                    userId: { $in: uniqueValidIds.map(id => new Types.ObjectId(id)) },
                    startDate: { $lte: latestShiftDay },
                    $or: [
                        { endDate: { $gte: earliestShiftDay } },
                        { endDate: null },
                    ],
                }).populate<{ shiftId: any }>('shiftId')
                : [],
            uniqueValidIds.length && validShiftDays.length
                ? AttendanceRegularization.find({
                    userId: { $in: uniqueValidIds.map(id => new Types.ObjectId(id)) },
                    shiftDay: { $in: validShiftDays },
                    status: { $in: ['Pending', 'Approved'] },
                }).select('userId shiftDay status').lean()
                : [],
        ]);

        const usersById = new Map(users.map((user: any) => [user._id.toString(), user]));
        const attendanceById = new Map(attendanceRecords.map((attendance: any) => [attendance._id.toString(), attendance]));
        const existingRegularizationKeys = new Set(
            existingRegularizations.map((regularization: any) =>
                `${regularization.userId.toString()}:${new Date(regularization.shiftDay).getTime()}`
            )
        );

        const findShiftAssignment = (userId: string, shiftDay: Date) => {
            const normalizedUserId = normalizeObjectId(userId);
            return shiftAssignments.find((assignment: any) => {
                const assignmentUserId = assignment.userId?.toString();
                const startDate = new Date(assignment.startDate);
                const endDate = assignment.endDate ? new Date(assignment.endDate) : null;
                return assignmentUserId === normalizedUserId
                    && startDate <= shiftDay
                    && (!endDate || endDate >= shiftDay)
                    && assignment.shiftId;
            });
        };

        const escapeHtml = (value: any): string => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        console.log(`createBulkRegularization processing ${data.length} entries`);
        for (const entry of data) {
            try {
                const { userId, date, fromTime, toTime, reason, approver, attendanceId } = entry;
                const normalizedUserId = normalizeObjectId(userId);
                const normalizedApproverId = normalizeObjectId(approver.id);
                // 1. Parse date and convert local times to UTC
                const shiftDay = new Date(date);
                shiftDay.setUTCHours(0, 0, 0, 0);

                // Get user details to determine timezone based on country
                const user = usersById.get(normalizedUserId);
                if (!user) {
                    throw new Error('User not found');
                }

                const timezoneOffset = this.getTimezoneOffsetHours(user.country);

                // Convert fromTime and toTime from local timezone to UTC
                const parseLocalTime = (timeStr: string, baseDate: Date): Date => {
                    const [hours, minutes] = timeStr.split(':').map(Number);
                    const localDate = new Date(baseDate);
                    localDate.setHours(hours, minutes, 0, 0);
                    // Convert local time to UTC based on user's country
                    return new Date(localDate.getTime() - timezoneOffset * 60 * 60 * 1000);
                };

                const requestedFrom = parseLocalTime(fromTime, shiftDay);
                const requestedTo = parseLocalTime(toTime, shiftDay);
                // Validate time order
                if (requestedTo <= requestedFrom) {
                    throw new Error('toTime must be after fromTime');
                }


                // 2. Get shift assignment first (needed for both cases)
                let shiftAssignment = findShiftAssignment(userId, shiftDay);
                if (!shiftAssignment) {
                    shiftAssignment = await this.getCurrentShiftAssignment(
                        new Types.ObjectId(userId),
                        shiftDay
                    );
                }
                const shift = shiftAssignment.shiftId;

                //3. shift window
                const shiftWindow = this.getShiftTimings(shift, shiftDay, user.country);

                // 4. Find or create attendance record
                let attendance;
                if (attendanceId) {
                    if (!Types.ObjectId.isValid(attendanceId)) {
                        throw new Error('Invalid attendanceId');
                    }
                    attendance = attendanceById.get(attendanceId);
                    if (attendance) {
                        // Update missing required fields for existing record
                        attendance.shiftId = attendance.shiftId || shiftAssignment.shiftId;
                        attendance.shiftCode = attendance.shiftCode || shiftAssignment.shiftCode;
                        attendance.shiftStart = attendance.shiftStart || shiftWindow.shiftStart;
                        attendance.shiftEnd = attendance.shiftEnd || shiftWindow.shiftEnd;

                        // Fix invalid status (e.g., 'onLeave')
                        // if (attendance.status === 'leave_swipe') {
                        //     attendance.status = attendance.swipes.length > 0 ? 'incomplete' : 'pending_regularization';
                        // }

                        // Check if the day is marked as leave
                        if (attendance.attendanceStatus.some((status: string) => ['On-Leave', 'Absent'].includes(status))) {
                            throw new Error('Regularization not allowed for leave or absent days');
                        }
                    }
                }
                if (!attendance) {
                    // Create new attendance
                    attendance = new AttendanceRecord({
                        userId: new Types.ObjectId(userId),
                        shiftId: shiftAssignment.shiftId,
                        shiftCode: shiftAssignment.shiftCode,
                        shiftDay,
                        shiftStart: shiftWindow.shiftStart,
                        shiftEnd: shiftWindow.shiftEnd,
                        swipes: [],
                        attendanceStatus: ['Pending-Regularization'],
                        needsRegularization: true,
                        isWithinWindow: true,
                        totalWorkHours: '00:00:00',
                        breakHours: '00:00:00',
                        actualWorkHours: '00:00:00',
                        shortfallHours: '00:00:00',
                        excessHours: '00:00:00',
                        status: 'incomplete',
                    });
                    await attendance.save();
                } else {
                    if (!attendance.attendanceStatus.includes('Pending-Regularization')) {
                        attendance.attendanceStatus.push('Pending-Regularization');
                    }
                    attendance.needsRegularization = true;

                    // Set status to pending_regularization if not a special status
                    if (!specialStatuses.includes(attendance.status)) {
                        attendance.status = 'pending_regularization';
                    }
                }

                // 4. Validate regularization eligibility
                const validationResult = await this.validateRegularizationEligibility(
                    attendance,
                    shiftWindow.shiftStart,
                    shiftWindow.shiftEnd,
                    existingRegularizationKeys
                );

                if (!validationResult.isValid) {
                    throw new Error(validationResult.message);
                }

                // 5. Create regularization record
                const regularization = new AttendanceRegularization({
                    attendanceId: attendance._id,
                    userId: new Types.ObjectId(userId),
                    from: requestedFrom,
                    to: requestedTo,
                    shiftDay,
                    reason,
                    status: 'Pending',
                    approver
                });
                await regularization.save();
                // 6. Update attendance with regularization reference
                attendance.regularization = {
                    hasRegularizationRequest: true,
                    isRegularized: false,
                    status: 'Pending',
                    regularizationId: regularization._id,
                };
                await attendance.save();
                const existingRegularizationKey = `${attendance.userId.toString()}:${new Date(attendance.shiftDay).getTime()}`;
                existingRegularizationKeys.add(existingRegularizationKey);

                successfulNotifications.push({
                    regularization,
                    userId: normalizedUserId,
                    approverId: normalizedApproverId,
                    approverName: approver.name,
                    shiftDay,
                    fromTime,
                    toTime,
                    reason,
                });

                results.push({
                    success: true,
                    regularization,
                    attendance,
                    message: entry.attendanceId ?
                        'Regularization created for existing attendance' :
                        'New attendance record and regularization created'
                });

            } catch (error: any) {
                results.push({
                    success: false,
                    error: error.message,
                    date: entry.date
                });
            }
        }

        const hasSuccesses = results.some(result => result.success);
        console.log(`createBulkRegularization completed: ${results.filter(result => result.success).length}/${results.length} succeeded`);
        if (!hasSuccesses) {
            throw new Error(results[0].error || 'All regularization attempts failed');
        }

        void (async () => {
            try {
            const groupedByEmployeeAndApprover = successfulNotifications.reduce((groups, item) => {
                const groupKey = `${item.userId}:${item.approverId}`;
                const existing = groups.get(groupKey) || [];
                existing.push(item);
                groups.set(groupKey, existing);
                return groups;
            }, new Map<string, typeof successfulNotifications>());

            const adminEmails = admins.map((admin: any) => admin.email).filter(Boolean);

            for (const group of groupedByEmployeeAndApprover.values()) {
                const firstItem = group[0];
                const employeeUser = usersById.get(firstItem.userId);
                const approverUser = usersById.get(firstItem.approverId);
                const employeeName = employeeUser?.name || 'Employee';
                const approverName = approverUser?.name || firstItem.approverName || 'Approver';
                const isSingleRequest = group.length === 1;

                if (approverUser?.email) {
                    const requestRowsHtml = group.map(item => {
                        const reviewLink = `${appUrl}/manager/attendance-approvals/${item.regularization._id}`;
                        return `
                            <li style="margin-bottom: 12px;">
                                <strong>Date:</strong> ${escapeHtml(item.shiftDay.toDateString())}<br/>
                                <strong>Requested In Time:</strong> ${escapeHtml(item.fromTime)}<br/>
                                <strong>Requested Out Time:</strong> ${escapeHtml(item.toTime)}<br/>
                                <strong>Reason:</strong> ${escapeHtml(item.reason)}<br/>
                                <a href="${escapeHtml(reviewLink)}">Review this request</a>
                            </li>
                        `;
                    }).join('');

                    const requestRowsText = group.map(item => {
                        const reviewLink = `${appUrl}/manager/attendance-approvals/${item.regularization._id}`;
                        return `- ${item.shiftDay.toDateString()} | ${item.fromTime} - ${item.toTime} | Reason: ${item.reason} | Review: ${reviewLink}`;
                    }).join('\n');

                    await emailService.sendEmail({
                        body: {
                            to: approverUser.email,
                            subject: `Attendance Regularization Request${isSingleRequest ? '' : 's'} from ${employeeName}`,
                            text: `${employeeName} has requested attendance regularization for ${group.length} day${isSingleRequest ? '' : 's'}.\n\n${requestRowsText}`,
                            html: `<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
                                <h2>Attendance Regularization Request${isSingleRequest ? '' : 's'}</h2>
                                <p>Dear ${escapeHtml(approverName)},</p>
                                <p>${escapeHtml(employeeName)} has requested attendance regularization for the following ${isSingleRequest ? 'day' : 'days'}:</p>
                                <ul>${requestRowsHtml}</ul>
                                <p>Please review each request in the Zuno HR portal.</p>
                                <p>Regards,</p>
                                <p>${escapeHtml(companyName)} Zuno HR</p>
                            </div>`
                        }
                    });
                }

                if (adminEmails.length > 0 && employeeUser) {
                    const adminRequestRowsText = group.map(item =>
                        `- Date: ${item.shiftDay.toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}, Requested In Time: ${item.fromTime}, Requested Out Time: ${item.toTime}, Reason: ${item.reason}, Approver: ${item.approverName}`
                    ).join('\n');

                    const adminEmailText = `Dear Admin,

Attendance regularization request${isSingleRequest ? '' : 's'} ${isSingleRequest ? 'has' : 'have'} been submitted by ${employeeName}.

Request Details:
- Employee: ${employeeName} (${employeeUser.email || 'N/A'})
- Status: Pending
${adminRequestRowsText}

This is an automated notification for your records.

Regards,
${companyName}`;

                    await emailService.sendEmail({
                        body: {
                            to: adminEmails,
                            subject: `Attendance Regularization Request${isSingleRequest ? '' : 's'} Submitted - ${employeeName}`,
                            text: adminEmailText,
                            html: adminEmailText.replace(/\n/g, '<br>'),
                        }
                    });
                }
            }
            } catch (emailError) {
                console.error('Failed to send grouped email for bulk attendance regularization:', emailError);
                // Don't fail the request if email fails
            }
        })();

        return results;
    }

    async updateRegularizationStatus(
        regularizationId: Types.ObjectId,
        status: 'Approved' | 'Rejected',
        approver: { id: Types.ObjectId; name: string },
        comments?: string,
        options: { sendEmails?: boolean; backgroundEmails?: boolean } = {}
    ): Promise<IAttendanceRegularization> {
        const regularization = await AttendanceRegularization.findById(regularizationId);
        console.log(regularization, "1 get Regularization record ")
        if (!regularization) {
            throw new Error('Regularization request not found');
        }

        if (status === 'Rejected') {
            await this.verifyRejectionEligibility(regularization);
        }

        regularization.status = status;
        regularization.approver = approver;
        regularization.approvedDate = new Date();
        regularization.comments = comments;

        await regularization.save();
        console.log(regularization, "2 get Regularization record ")

        if (status === 'Rejected') {
            await this.handleRejection(regularization);
        }
        if (status === 'Approved') {
            await this.handleApproval(regularization);
        }

        if (options.sendEmails !== false) {
            const emailTask = this.sendRegularizationStatusEmails(regularization, approver);
            if (options.backgroundEmails === false) {
                await emailTask;
            } else {
                void emailTask.catch((emailError) => {
                    console.error('Background attendance regularization status email failed:', emailError);
                });
            }
        }

        return regularization;
    }

    private async sendRegularizationStatusEmails(
        regularization: IAttendanceRegularization,
        approver: { id: Types.ObjectId; name: string }
    ): Promise<void> {
        // Send email notification to employee (the person who applied)
        try {
            // 1. Fetch employee user details
            const employee = await User.findById(regularization.userId).select('name email');
            if (!employee?.email) {
                console.warn(`Cannot send email: Employee not found or email missing for userId: ${regularization.userId}`);
                return; // Exit if no email
            }

            // Get user details for timezone formatting
            const user = await User.findById(regularization.userId).select('country').lean();
            const userCountry = user?.country || 'IN';

            const shiftDayFormatted = regularization.shiftDay.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const fromTimeFormatted = this.formatTimeLocal(regularization.from, userCountry);
            const toTimeFormatted = this.formatTimeLocal(regularization.to, userCountry);

            const htmlContent = generateEmailTemplate('attendanceRegularizeApproval', {
                employeeName: employee.name,
                approverName: approver.name,
                shiftDay: shiftDayFormatted,
                fromTime: fromTimeFormatted,
                toTime: toTimeFormatted,
                reason: regularization.reason,
                comments: regularization.comments || '',
                status: regularization.status,
                companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS'
            });

            // Build detailed text content
            const textContent = `Dear ${employee.name},

Your attendance regularization request has been ${regularization.status.toLowerCase()} by ${approver.name}.

Regularization Details:
- Date: ${shiftDayFormatted}
- From Time: ${fromTimeFormatted}
- To Time: ${toTimeFormatted}
- Reason: ${regularization.reason}
${regularization.comments ? `- Comments: ${regularization.comments}` : ''}

${regularization.status === 'Approved'
                    ? '✅ Your attendance regularization has been approved. The attendance record has been updated accordingly.'
                    : '❌ Your attendance regularization request has been rejected. The attendance record remains unchanged.'}

Thank you for your understanding.

Regards,
${approver.name}
${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`;

            // Send the email
            await emailService.sendEmail({
                body: {
                    to: employee.email,
                    subject: `Your Attendance Regularization has been ${regularization.status}`,
                    text: textContent,
                    html: htmlContent
                }
            });

            console.log(`Email notification sent to ${employee.email} for attendance regularization ${regularization._id} - Status: ${regularization.status}`);
        } catch (emailError) {
            console.error('Failed to send email to employee for attendance regularization:', emailError);
            // Don't fail the request if email fails - log the error but continue
        }

        // Send email notification to all admins
        try {
            const admins = await User.find({
                $or: [
                    { role: 'admin' },
                    { isSuperAdmin: true }
                ],
                active: true
            }).select('name email').lean();

            if (admins && admins.length > 0) {
                // Fetch employee and user country for admin email
                const employeeForAdmin = await User.findById(regularization.userId).select('name email').lean();
                const userForCountry = await User.findById(regularization.userId).select('country').lean();
                const userCountryForAdmin = userForCountry?.country || 'IN';

                const shiftDayFormatted = regularization.shiftDay.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

                const fromTimeFormatted = this.formatTimeLocal(regularization.from, userCountryForAdmin);
                const toTimeFormatted = this.formatTimeLocal(regularization.to, userCountryForAdmin);

                const adminEmails = admins.map(admin => admin.email).filter(Boolean);

                if (adminEmails.length > 0 && employeeForAdmin) {
                    const adminEmailText = `Dear Admin,

An attendance regularization request has been ${regularization.status.toLowerCase()} by ${approver.name}.

Request Details:
- Employee: ${employeeForAdmin.name} (${employeeForAdmin.email})
- Date: ${shiftDayFormatted}
- From Time: ${fromTimeFormatted}
- To Time: ${toTimeFormatted}
- Reason: ${regularization.reason}
- Status: ${regularization.status}
${regularization.comments ? `- Comments: ${regularization.comments}` : ''}
- Approved/Rejected By: ${approver.name}

This is an automated notification for your records.

Regards,
${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`;

                    await emailService.sendEmail({
                        body: {
                            to: adminEmails,
                            subject: `Attendance Regularization ${regularization.status} - ${employeeForAdmin.name}`,
                            text: adminEmailText,
                            html: adminEmailText.replace(/\n/g, '<br>'),
                        }
                    });

                    console.log(`Email notification sent to ${adminEmails.length} admin(s) for attendance regularization ${regularization._id} - Status: ${regularization.status}`);
                }
            }
        } catch (adminEmailError) {
            console.error('Failed to send email to admins for attendance regularization:', adminEmailError);
            // Don't fail the request if admin email fails
        }
    }

    private async sendBulkRegularizationStatusEmails(
        regularizations: IAttendanceRegularization[],
        approver: { id: Types.ObjectId; name: string }
    ): Promise<void> {
        try {
            const userIds = [...new Set(
                regularizations
                    .map((regularization) => regularization.userId?.toString())
                    .filter(Boolean)
            )];

            if (userIds.length === 0) {
                return;
            }

            const [admins, users] = await Promise.all([
                User.find({
                    $or: [
                        { role: 'admin' },
                        { isSuperAdmin: true }
                    ],
                    active: true
                }).select('name email').lean(),
                User.find({
                    _id: { $in: userIds.map((id) => new Types.ObjectId(id)) }
                }).select('name email country').lean()
            ]);

            const adminEmails = admins.map(admin => admin.email).filter(Boolean);
            const usersById = new Map(users.map((user: any) => [user._id.toString(), user]));

            const emailResults = await Promise.allSettled(
                regularizations.map(async (regularization) => {
                    const employee: any = usersById.get(regularization.userId?.toString());
                    if (!employee?.email) {
                        console.warn(`Cannot send email: Employee not found or email missing for userId: ${regularization.userId}`);
                        return;
                    }

                    const userCountry = employee.country || 'IN';
                    const shiftDayFormatted = regularization.shiftDay.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });

                    const fromTimeFormatted = this.formatTimeLocal(regularization.from, userCountry);
                    const toTimeFormatted = this.formatTimeLocal(regularization.to, userCountry);

                    const htmlContent = generateEmailTemplate('attendanceRegularizeApproval', {
                        employeeName: employee.name,
                        approverName: approver.name,
                        shiftDay: shiftDayFormatted,
                        fromTime: fromTimeFormatted,
                        toTime: toTimeFormatted,
                        reason: regularization.reason,
                        comments: regularization.comments || '',
                        status: regularization.status,
                        companyName: process.env.COMPANY_NAME || 'CloudDesk HRMS'
                    });

                    const textContent = `Dear ${employee.name},

Your attendance regularization request has been ${regularization.status.toLowerCase()} by ${approver.name}.

Regularization Details:
- Date: ${shiftDayFormatted}
- From Time: ${fromTimeFormatted}
- To Time: ${toTimeFormatted}
- Reason: ${regularization.reason}
${regularization.comments ? `- Comments: ${regularization.comments}` : ''}

${regularization.status === 'Approved'
                            ? '✅ Your attendance regularization has been approved. The attendance record has been updated accordingly.'
                            : '❌ Your attendance regularization request has been rejected. The attendance record remains unchanged.'}

Thank you for your understanding.

Regards,
${approver.name}
${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`;

                    await emailService.sendEmail({
                        body: {
                            to: employee.email,
                            subject: `Your Attendance Regularization has been ${regularization.status}`,
                            text: textContent,
                            html: htmlContent
                        }
                    });

                    if (adminEmails.length > 0) {
                        const adminEmailText = `Dear Admin,

An attendance regularization request has been ${regularization.status.toLowerCase()} by ${approver.name}.

Request Details:
- Employee: ${employee.name} (${employee.email})
- Date: ${shiftDayFormatted}
- From Time: ${fromTimeFormatted}
- To Time: ${toTimeFormatted}
- Reason: ${regularization.reason}
- Status: ${regularization.status}
${regularization.comments ? `- Comments: ${regularization.comments}` : ''}
- Approved/Rejected By: ${approver.name}

This is an automated notification for your records.

Regards,
${process.env.COMPANY_NAME || 'CloudDesk HRMS'}`;

                        await emailService.sendEmail({
                            body: {
                                to: adminEmails,
                                subject: `Attendance Regularization ${regularization.status} - ${employee.name}`,
                                text: adminEmailText,
                                html: adminEmailText.replace(/\n/g, '<br>'),
                            }
                        });
                    }
                })
            );

            const failedEmails = emailResults.filter((result) => result.status === 'rejected').length;
            if (failedEmails > 0) {
                console.error(`Bulk regularization background email failed for ${failedEmails} request(s)`);
            }
        } catch (emailError) {
            console.error('Failed to send bulk attendance regularization status emails:', emailError);
        }
    }

    async bulkUpdateRegularizationStatus(
        regularizationIds: string[],
        status: 'Approved' | 'Rejected',
        approver: { id: Types.ObjectId; name: string },
        comments?: string
    ): Promise<{
        total: number;
        successCount: number;
        failureCount: number;
        results: Array<{
            id: string;
            success: boolean;
            regularization?: IAttendanceRegularization;
            error?: string;
        }>;
    }> {
        const uniqueIds = [...new Set((regularizationIds || []).filter(Boolean))];

        if (uniqueIds.length === 0) {
            throw new Error('At least one regularization ID is required');
        }

        const results = [];
        const successfulRegularizations: IAttendanceRegularization[] = [];

        for (const id of uniqueIds) {
            try {
                if (!Types.ObjectId.isValid(id)) {
                    throw new Error('Invalid regularization ID');
                }

                const regularization = await this.updateRegularizationStatus(
                    new Types.ObjectId(id),
                    status,
                    approver,
                    comments,
                    { sendEmails: false }
                );

                successfulRegularizations.push(regularization);
                results.push({
                    id,
                    success: true,
                    regularization
                });
            } catch (error: any) {
                results.push({
                    id,
                    success: false,
                    error: error.message || 'Failed to update regularization'
                });
            }
        }

        if (successfulRegularizations.length > 0) {
            void this.sendBulkRegularizationStatusEmails(successfulRegularizations, approver);
        }

        const successCount = results.filter((result) => result.success).length;

        return {
            total: uniqueIds.length,
            successCount,
            failureCount: uniqueIds.length - successCount,
            results
        };
    }


    private async handleRejection(regularization: IAttendanceRegularization): Promise<void> {
        try {
            // Step 1: Update regularization status to Rejected
            regularization.status = 'Rejected';
            await regularization.save();

            // Step 2: Check for existing attendance record
            const attendanceRecord = await AttendanceRecord.findById(regularization.attendanceId);
            if (!attendanceRecord) {
                throw new Error('Attendance record not found');
            }

            // Step 3: Process leave or absent status
            await this.processLeaveOrAbsent(attendanceRecord, regularization);

        } catch (error) {
            console.error('Error in handleRejection:', error);
            throw error;
        }
    }


    private async processLeaveOrAbsent(
        attendanceRecord: any,
        regularization: IAttendanceRegularization
    ): Promise<void> {
        // Step 1: Remove Pending-Regularization from attendanceStatus
        attendanceRecord.attendanceStatus = attendanceRecord.attendanceStatus.filter(
            (status: string) => status !== 'Pending-Regularization'
        );

        // Step 2: Check leave balance
        const year = regularization.shiftDay.getFullYear();
        // const leaveSummary = await this.leaveSummaryService.getLeaveSummary(
        //   regularization.userId as Types.ObjectId,
        //   year
        // );
        // const hasLeaveBalance = leaveSummary && leaveSummary.annual > 0;
        const hasLeaveBalance = false
        if (hasLeaveBalance) {
            // Update leave balance and mark as on-leave
            const leaveUpdated = await this.updateLeaveSummary(
                regularization.userId,
                year,
                'annual'
            );

            if (leaveUpdated) {
                attendanceRecord.attendanceStatus = ['On-Leave'];
                // attendanceRecord.leaveType = 'annual';
            }
            else {
                // Fallback to Absent if leave update fails
                if (!attendanceRecord.attendanceStatus.includes('Absent')) {
                    attendanceRecord.attendanceStatus.push('Absent');
                }
            }
        } else {
            // Step 4: Mark as Absent if no leave balance
            if (!attendanceRecord.attendanceStatus.includes('Absent')) {
                attendanceRecord.attendanceStatus.push('Absent');
            }
        }
        // Step 5: Update regularization status
        attendanceRecord.regularization = {
            hasRegularizationRequest: true,
            isRegularized: false,
            status: 'Rejected-Absent',
            regularizationId: regularization._id,
            remarks: regularization.comments || "Rejected",
        };

        // Step 6: Set all time-related fields to zero
        attendanceRecord.totalWorkHours = '00:00:00';
        attendanceRecord.breakHours = '00:00:00';
        attendanceRecord.actualWorkHours = '00:00:00';
        attendanceRecord.shortfallHours = '00:00:00';
        attendanceRecord.excessHours = '00:00:00';
        attendanceRecord.hasShortfall = false; // No shortfall since no hours expected
        attendanceRecord.hasExcessHours = false;

        // Step 7: No changes to swipes, firstIn, or lastOut
        await attendanceRecord.save();

    }

    private async verifyRejectionEligibility(
        regularization: IAttendanceRegularization
    ): Promise<boolean> {
        if (regularization.status !== 'Pending') {
            throw new Error('Cannot reject a non-pending regularization request');
        }

        const existingRecord = await AttendanceRecord.findOne({
            userId: regularization.userId,
            shiftDay: regularization.shiftDay,
            'regularization.status': { $in: ['Approved', 'Rejected-Leave', 'Rejected-Absent'] },
        });

        if (existingRecord) {
            throw new Error('Another regularization request has already been processed for this date');
        }

        return true;
    }



    private async handleApproval(regularization: IAttendanceRegularization): Promise<void> {
        const attendanceRecord = await AttendanceRecord.findById(regularization.attendanceId);
        if (!attendanceRecord) {
            throw new Error('Attendance record not found');
        }
        console.log(attendanceRecord, "0 handleApproval attendanceRecord")
        // Remove 'Pending-Regularization' from attendanceStatus
        attendanceRecord.attendanceStatus = attendanceRecord.attendanceStatus.filter(
            (status) => status !== 'Pending-Regularization'
        );

        /*
        // Handle existing swipes
            const hasExistingSwipes = attendanceRecord.swipes.length > 0;
            if (hasExistingSwipes) {
            // Optionally merge or flag existing swipes instead of overwriting
    attendanceRecord.swipes = [
    ...attendanceRecord.swipes.filter((swipe) => swipe.deviceId !== 'manual'), // Keep non-regularization swipes
    {timestamp: regularization.from, direction: 'IN', deviceId: 'manual',location: 'regularization',},
    {timestamp: regularization.to,direction: 'OUT',deviceId: 'manual',location: 'regularization', }, ];
} else {
    attendanceRecord.swipes = [{timestamp: regularization.from, direction: 'IN',deviceId: 'manual',location: 'regularization', },
    {timestamp: regularization.to, direction: 'OUT',deviceId: 'manual',location: 'regularization',}, ];
}
        */
        // Update the attendance record with the regularization details
        // IMPORTANT: Preserve existing biometric swipes if they exist and fall within regularization window
        // This maintains multiple swipe history while applying regularization

        const shiftStart = attendanceRecord.shiftStart;
        const shiftEnd = attendanceRecord.shiftEnd;

        // Check if we have existing biometric swipes to preserve
        const hasExistingBiometricSwipes = attendanceRecord.swipes &&
            attendanceRecord.swipes.length > 0 &&
            attendanceRecord.swipes.some(s => s.deviceId !== 'manual');

        let metrics;

        if (hasExistingBiometricSwipes && attendanceRecord.swipes.length > 2) {
            // Multiple swipes exist - preserve them and recalculate metrics using multiple swipe logic
            // Only update firstIn/lastOut if regularization times are different
            if (regularization.from.getTime() !== attendanceRecord.firstIn?.getTime()) {
                attendanceRecord.firstIn = regularization.from;
            }
            if (regularization.to.getTime() !== attendanceRecord.lastOut?.getTime()) {
                attendanceRecord.lastOut = regularization.to;
            }

            // Recalculate metrics using multiple swipe calculation
            // Filter swipes to ensure they have valid direction
            const validSwipes = attendanceRecord.swipes.filter(s => s.direction === 'IN' || s.direction === 'OUT') as Array<{ timestamp: Date; direction: 'IN' | 'OUT' }>;
            metrics = await this.calculateMultipleSwipeMetrics(
                validSwipes,
                shiftStart,
                shiftEnd
            );
        } else {
            // No existing swipes or only 2 swipes - replace with regularization swipes
            attendanceRecord.firstIn = regularization.from;
            attendanceRecord.lastOut = regularization.to;
            attendanceRecord.swipes = [
                {
                    timestamp: regularization.from,
                    direction: 'IN',
                    deviceId: 'manual',
                    location: {
                        latitude: 0,
                        longitude: 0,
                        accuracy: 0,
                        altitude: 0,
                        address: 'regularization'
                    },
                },
                {
                    timestamp: regularization.to,
                    direction: 'OUT',
                    deviceId: 'manual',
                    location: {
                        latitude: 0,
                        longitude: 0,
                        accuracy: 0,
                        altitude: 0,
                        address: 'regularization'
                    },
                },
            ];

            // Calculate metrics using simple 2-swipe logic
            metrics = await this.calculateAttendanceMetrics(
                regularization.from,
                regularization.to,
                shiftStart,
                shiftEnd
            );
        }

        // Update all time-related fields
        attendanceRecord.totalWorkHours = metrics.totalWorkHours;
        attendanceRecord.breakHours = metrics.breakHours;
        attendanceRecord.actualWorkHours = metrics.actualWorkHours;
        attendanceRecord.shortfallHours = metrics.shortfallHours;
        attendanceRecord.excessHours = metrics.excessHours;

        console.log(attendanceRecord, "1 handleApproval attendanceRecord")

        // Update attendance status
        if (!attendanceRecord.attendanceStatus.includes('Regularized')) {
            attendanceRecord.attendanceStatus.push('Regularized');
        }


        // Update attendance status
        if (!attendanceRecord.attendanceStatus.includes('Present')) {
            attendanceRecord.attendanceStatus.push('Present');
        }

        attendanceRecord.status = 'complete';
        attendanceRecord.needsRegularization = false;

        // Update regularization status
        attendanceRecord.regularization = {
            hasRegularizationRequest: true,
            isRegularized: true,
            status: 'Approved',
            regularizationId: regularization._id,
            regularizedAt: new Date(),
            regularizedBy: regularization.approver?.id ? new Types.ObjectId(regularization.approver.id) : undefined,
        };
        console.log(attendanceRecord, "2 handleApproval attendanceRecord")
        await attendanceRecord.save();
        console.log(attendanceRecord, "3 handleApproval attendanceRecord")
    }

    async withdrawRegularization(regularizationId: string): Promise<void> {
        try {
            // 1. Find the regularization record
            const regularization = await AttendanceRegularization.findById(regularizationId);
            console.log(regularization, "regularization withdrawRegularization")
            if (!regularization) {
                throw new Error('Regularization request not found');
            }

            // 2. Validate  status

            if (regularization.status !== 'Pending') {
                throw new Error('Only pending regularization requests can be withdrawn');
            }

            // 3. Update regularization status to Withdrawn
            regularization.status = 'Withdrawn';
            await regularization.save();

            // 4. Find the associated attendance record
            const attendance = await AttendanceRecord.findById(regularization.attendanceId);
            if (!attendance) {
                throw new Error('Associated attendance record not found');
            }
            console.log(attendance, "attendance withdrawRegularization")
            // 5. Update attendance record
            // Remove Pending-Regularization from attendanceStatus
            attendance.attendanceStatus = attendance.attendanceStatus.filter(
                (status: string) => status !== 'Pending-Regularization'
            );

            attendance.regularization = undefined

            attendance.needsRegularization = true; // Allow new regularization requests
            // attendance.status = attendance.swipes.length > 0 ? 'incomplete' : 'incomplete';


            console.log(attendance, "attendance withdrawRegularization")

            // No changes to swipes, firstIn, lastOut, or time metrics
            await attendance.save();

        } catch (error: any) {
            console.error('Error in withdrawRegularization:', error);
            throw error;
        }
    }

    private async validateRegularization(payload: IAttendanceRegularization): Promise<boolean> {
        // 1. Check if attendance record exists
        const attendance = await AttendanceRecord.findById(payload.attendanceId);
        console.log(attendance, "attendance")
        if (!attendance) {
            throw new Error('Attendance record not found');
        }

        // 2. Validate if regularization is needed
        if (!attendance.needsRegularization) {
            throw new Error('This attendance record does not require regularization');
        }

        // 3. Check if the regularization time falls within shift bounds
        if (payload.from < attendance.shiftStart || payload.to > attendance.shiftEnd) {
            throw new Error('Regularization time must be within shift timings');
        }

        // 4. Check if there's no existing approved regularization
        if (attendance.regularization?.isRegularized && attendance.regularization.status === 'Approved') {
            throw new Error('Attendance is already regularized');
        }
        return true;
    }

    private async calculateAttendanceMetrics(
        firstIn: Date,
        lastOut: Date,
        shiftStart: Date,
        shiftEnd: Date
    ): Promise<IAttendanceMetrics> {
        console.log("c firstIn", firstIn, "c lastOut", lastOut);
        console.log("c shiftStart", shiftStart, "c shiftEnd", shiftEnd);
        // Calculate total duration in minutes
        const totalMinutes = (lastOut.getTime() - firstIn.getTime()) / (1000 * 60);
        const shiftMinutes = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60);

        // Default break calculation (can be customized based on your rules)
        const breakMinutes = totalMinutes > 360 ? 30 : 0; // 30 min break for > 6 hours

        // Calculate actual work minutes (for payroll/work hour tracking)
        const actualWorkMinutes = totalMinutes - breakMinutes;

        // Calculate shortfall/excess based on TOTAL work time (not actual work time)
        // This ensures break time doesn't affect shortfall/excess calculation
        const difference = totalMinutes - shiftMinutes;
        console.log(difference, "difference");

        return {
            totalWorkHours: await this.formatDuration(totalMinutes),
            breakHours: await this.formatDuration(breakMinutes),
            actualWorkHours: await this.formatDuration(actualWorkMinutes),
            shiftHours: await this.formatDuration(shiftMinutes),
            shortfallHours: difference < 0 ? await this.formatDuration(Math.abs(difference)) : '00:00:00',
            excessHours: difference > 0 ? await this.formatDuration(difference) : '00:00:00',
            hasShortfall: difference < 0,
            hasExcessHours: difference > 0
        };
    }

    private async formatDuration(minutes: number): Promise<string> {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        const secs = Math.floor((minutes % 1) * 60);
        console.log("return ", `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    private async getCurrentShiftAssignment(userId: Types.ObjectId, timestamp: Date) {
        const shiftDay = new Date(timestamp);
        shiftDay.setUTCHours(0, 0, 0, 0);
        console.log(shiftDay, "shiftDay getCurrentShiftAssignment")
        // Find active shift assignment for the user
        const shiftAssignment = await ShiftAssignment.findOne({
            userId,
            // isActive: true,
            startDate: { $lte: shiftDay },
            $or: [
                { endDate: { $gte: shiftDay } },
                { endDate: null },
            ],
        }).populate<{ shiftId: any }>('shiftId');
        console.log(shiftAssignment, "getCurrentShiftAssignment")
        if (!shiftAssignment || !shiftAssignment.shiftId) {
            throw new Error('No active shift assignment found');
        }
        return shiftAssignment;
    }


    private async updateLeaveSummary(userId: Types.ObjectId, year: number, categoryType: string) {

        // let result = await LeaveSummaryService.createOrUpdateLeaveSummary(
        //     userId as Types.ObjectId,
        //     year,
        //     categoryType as keyof ILeaveSummary,
        //     'Approved',
        //     { availed: 1 }
        // );
        // console.log(result, 'result');
        // if (result) {
        //     return true
        // } else {
        //     return false
        // }
        console.log(userId, year, categoryType)
        return false
    }

    // New validation method specifically for regularization eligibility
    private async validateRegularizationEligibility(
        attendance: any,
        _fromTime: Date,
        _toTime: Date,
        existingRegularizationKeys?: Set<string>
    ): Promise<{ isValid: boolean; message: string }> {
        // 1. Check if already regularized
        if (attendance.regularization?.isRegularized &&
            attendance.regularization.status === 'Approved') {
            return {
                isValid: false,
                message: 'Attendance is already regularized'
            };
        }
        /*
                // 2. Validate against shift timings
                const shiftStart = new Date(attendance.shiftStart);
                const shiftEnd = new Date(attendance.shiftEnd);
        
                if (fromTime < shiftStart || toTime > shiftEnd) {
                    return {
                        isValid: false,
                        message: 'Regularization time must be within shift timings'
                    };
                }
        */
        // 3. Check for overlapping regularizations
        const existingRegularizationKey = `${attendance.userId.toString()}:${new Date(attendance.shiftDay).getTime()}`;
        const hasExistingRegularization = existingRegularizationKeys
            ? existingRegularizationKeys.has(existingRegularizationKey)
            : Boolean(await AttendanceRegularization.findOne({
                userId: attendance.userId,
                shiftDay: attendance.shiftDay,
                status: { $in: ['Pending', 'Approved'] },
            }));

        if (hasExistingRegularization) {
            return {
                isValid: false,
                message: 'Another regularization request exists for this date'
            };
        }

        return { isValid: true, message: '' };
    }


    private getShiftTimings(shift: IShift & Document, shiftDay: Date, userCountry: string = 'IN'): IShiftWindow {
        const parseTime = (timeStr: string): { hours: number; minutes: number } => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) {
                throw new Error('Invalid time format. Expected HH:mm or HH:mm:ss');
            }
            return { hours, minutes };
        };

        const timezoneOffset = this.getTimezoneOffset(userCountry);

        // ✅ FIX: Create a copy of shiftDay to avoid mutating the original parameter
        // This prevents the attendance record from being created with the wrong date
        const baseDate = new Date(shiftDay);

        // ✅ FIX: Track date offsets separately instead of mutating the original shiftDay
        const convertLocalToUTC = (localHours: number, localMinutes: number): { hours: number; minutes: number; dateOffset: number } => {
            let utcHours = localHours - timezoneOffset.hours;
            let utcMinutes = localMinutes - timezoneOffset.minutes;
            let dateOffset = 0; // Track date adjustment needed

            if (utcMinutes < 0) {
                utcMinutes += 60;
                utcHours -= 1;
            }

            if (utcHours < 0) {
                utcHours += 24;
                dateOffset = -1; // Need to go back one day for this time
            }

            return { hours: utcHours, minutes: utcMinutes, dateOffset };
        };

        const startLocal = parseTime(shift.startTime);
        const endLocal = parseTime(shift.endTime);
        const windowStartLocal = parseTime(shift.shiftWindowStart);
        const windowEndLocal = parseTime(shift.shiftWindowEnd);

        const startUTC = convertLocalToUTC(startLocal.hours, startLocal.minutes);
        const endUTC = convertLocalToUTC(endLocal.hours, endLocal.minutes);
        const windowStartUTC = convertLocalToUTC(windowStartLocal.hours, windowStartLocal.minutes);
        const windowEndUTC = convertLocalToUTC(windowEndLocal.hours, windowEndLocal.minutes);

        // ✅ FIX: Create dates from baseDate (copy) and apply date offsets
        // This ensures the original shiftDay parameter is never mutated
        const shiftStart = new Date(baseDate);
        shiftStart.setUTCDate(shiftStart.getUTCDate() + startUTC.dateOffset);
        shiftStart.setUTCHours(startUTC.hours, startUTC.minutes, 0, 0);

        const shiftEnd = new Date(baseDate);
        shiftEnd.setUTCDate(shiftEnd.getUTCDate() + endUTC.dateOffset);
        shiftEnd.setUTCHours(endUTC.hours, endUTC.minutes, 0, 0);

        const windowStart = new Date(baseDate);
        windowStart.setUTCDate(windowStart.getUTCDate() + windowStartUTC.dateOffset);
        windowStart.setUTCHours(windowStartUTC.hours, windowStartUTC.minutes, 0, 0);

        const windowEnd = new Date(baseDate);
        windowEnd.setUTCDate(windowEnd.getUTCDate() + windowEndUTC.dateOffset);
        windowEnd.setUTCHours(windowEndUTC.hours, windowEndUTC.minutes, 0, 0);

        // Handle overnight shifts (end time is next day)
        if (endUTC.hours < startUTC.hours ||
            (endUTC.hours === startUTC.hours && endUTC.minutes < startUTC.minutes)) {
            shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 1);
        }

        if (windowEndUTC.hours < windowStartUTC.hours ||
            (windowEndUTC.hours === windowStartUTC.hours && windowEndUTC.minutes < windowStartUTC.minutes)) {
            windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
        }
        return { shiftStart, shiftEnd, windowStart, windowEnd };
    }

    private formatTimeLocal(date: Date, userCountry: string = 'IN'): string {
        const timezoneOffset = this.getTimezoneOffsetHours(userCountry);
        const localTime = new Date(date.getTime() + timezoneOffset * 60 * 60 * 1000);
        return localTime.toTimeString().slice(0, 5); // "HH:mm"
    }

    // Keep the old method for backward compatibility
    // private formatTimeIST(date: Date): string {
    //     return this.formatTimeLocal(date, 'IN');
    // }

    /**
     * Calculate metrics for multiple swipes (similar to biometric attendance service)
     * This preserves multiple swipe history when regularizing
     */
    private async calculateMultipleSwipeMetrics(
        swipes: Array<{ timestamp: Date; direction: 'IN' | 'OUT' }>,
        shiftStart: Date,
        shiftEnd: Date
    ): Promise<IAttendanceMetrics> {
        const workSessions = this.calculateWorkSessions(swipes, shiftStart, shiftEnd);
        const breakPeriods = this.calculateBreakPeriods(swipes);
        const totalWorkMinutes = workSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
        const totalBreakMinutes = breakPeriods.reduce((sum, breakPeriod) => sum + breakPeriod.durationMinutes, 0);
        const actualWorkMinutes = totalWorkMinutes;
        const shiftMinutes = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60);
        // Calculate shortfall/excess based on TOTAL work time (not actual work time)
        const difference = totalWorkMinutes - shiftMinutes;

        return {
            totalWorkHours: await this.formatDuration(totalWorkMinutes),
            breakHours: await this.formatDuration(totalBreakMinutes),
            actualWorkHours: await this.formatDuration(actualWorkMinutes),
            shiftHours: await this.formatDuration(shiftMinutes),
            shortfallHours: difference < 0 ? await this.formatDuration(Math.abs(difference)) : '00:00:00',
            excessHours: difference > 0 ? await this.formatDuration(difference) : '00:00:00',
            hasShortfall: difference < 0,
            hasExcessHours: difference > 0
        };
    }

    private calculateWorkSessions(
        swipes: Array<{ timestamp: Date; direction: 'IN' | 'OUT' }>,
        _shiftStart: Date, // Kept for API consistency
        shiftEnd: Date
    ): Array<{ sessionNumber: number; inTime: Date; outTime: Date; durationMinutes: number; isOvertime: boolean }> {
        const sessions: Array<{ sessionNumber: number; inTime: Date; outTime: Date; durationMinutes: number; isOvertime: boolean }> = [];
        const sortedSwipes = [...swipes].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        let i = 0;
        while (i < sortedSwipes.length) {
            const currentSwipe = sortedSwipes[i];
            if (currentSwipe.direction === 'IN') {
                const outSwipe = sortedSwipes[i + 1];
                if (outSwipe && outSwipe.direction === 'OUT') {
                    const durationMs = outSwipe.timestamp.getTime() - currentSwipe.timestamp.getTime();
                    if (durationMs >= 0) {
                        sessions.push({
                            sessionNumber: sessions.length + 1,
                            inTime: currentSwipe.timestamp,
                            outTime: outSwipe.timestamp,
                            durationMinutes: durationMs / (1000 * 60),
                            isOvertime: outSwipe.timestamp > shiftEnd
                        });
                    }
                    i += 2;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        return sessions;
    }

    private calculateBreakPeriods(
        swipes: Array<{ timestamp: Date; direction: 'IN' | 'OUT' }>
    ): Array<{ breakNumber: number; startTime: Date; endTime: Date; durationMinutes: number; isLunchBreak: boolean }> {
        const breaks: Array<{ breakNumber: number; startTime: Date; endTime: Date; durationMinutes: number; isLunchBreak: boolean }> = [];
        const sortedSwipes = [...swipes].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        for (let i = 0; i < sortedSwipes.length - 1; i++) {
            const current = sortedSwipes[i];
            const next = sortedSwipes[i + 1];
            if (current.direction === 'OUT' && next.direction === 'IN') {
                const durationMs = next.timestamp.getTime() - current.timestamp.getTime();
                if (durationMs >= 0) {
                    const durationMinutes = durationMs / (1000 * 60);
                    if (durationMinutes >= 15) {
                        breaks.push({
                            breakNumber: breaks.length + 1,
                            startTime: current.timestamp,
                            endTime: next.timestamp,
                            durationMinutes,
                            isLunchBreak: durationMinutes >= 30
                        });
                    }
                }
            }
        }
        return breaks;
    }
}
