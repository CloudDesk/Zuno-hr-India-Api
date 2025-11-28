import { Types } from "mongoose";
import { HolidayCalendar, IHolidayCalendar } from "../models/holiday-calendar.model";
import { User } from "../models/user.model";
import { BaseService } from "./base.service";
import { RequestContext } from "../types/context";

interface ICreateHolidayCalendar {
    name: string;
    description?: string;
    year: number;
    holidays: Array<{
        date: Date | string;
        name: string;
        type: "mandatory" | "optional" | "client-specific";
        description?: string;
    }>;
}

interface IUpdateHolidayCalendar {
    _id: string;
    name?: string;
    description?: string;
    year?: number;
    holidays?: Array<{
        date: Date | string;
        name: string;
        type: "mandatory" | "optional" | "client-specific";
        description?: string;
    }>;
    userIds?: string[];
}

interface IAssignEmployees {
    calendarId: string;
    employeeIds: string[];
}


export class HolidayCalendarService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }
    private async validateUserCalendars(userIds: string[], year: number, excludeCalendarId?: string) {
        const usersWithCalendars = await User.find({
            _id: { $in: userIds },
            holidayCalendar: { $exists: true },
        }).populate({
            path: "holidayCalendar",
            match: { year, _id: { $ne: excludeCalendarId } },
        });

        const usersWithConflict = usersWithCalendars.filter((user) => user.holidayCalendarId);
        if (usersWithConflict.length > 0) {
            throw new Error(
                `Users ${usersWithConflict.map((u) => u._id.toString()).join(", ")} already have a calendar for ${year}`,
            );
        }
    }

    async create(data: ICreateHolidayCalendar): Promise<IHolidayCalendar> {
        const session = await HolidayCalendar.startSession();
        session.startTransaction();

        try {
            // Validate holidays are in the correct year
            const holidays = data.holidays.map((h) => ({
                ...h,
                date: new Date(h.date),
            }));
            const invalidHolidays = holidays.filter(
                (holiday) => holiday.date.getFullYear() !== data.year,
            );

            if (invalidHolidays.length > 0) {
                throw new Error("All holidays must be within the specified year");
            }


            // Create calendar
            const calendar = new HolidayCalendar({
                name: data.name,
                description: data.description,
                year: data.year,
                holidays,
                assignedTo: [],
            });

            await calendar.save({ session });

            await session.commitTransaction();
            return calendar;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    async update(data: IUpdateHolidayCalendar): Promise<IHolidayCalendar> {
        const session = await HolidayCalendar.startSession();
        session.startTransaction();

        try {
            const calendar = await HolidayCalendar.findById(data._id);
            if (!calendar) {
                throw new Error("Holiday calendar not found");
            }

            // Determine the year to validate against
            const targetYear = data.year ?? calendar.year;

            // Validate holidays if provided
            let holidays = calendar.holidays;
            if (data.holidays) {
                holidays = data.holidays.map((h) => ({
                    ...h,
                    date: new Date(h.date),
                }));
                const invalidHolidays = holidays.filter(
                    (holiday) => holiday.date.getFullYear() !== targetYear,
                );
                if (invalidHolidays.length > 0) {
                    throw new Error("All holidays must be within the specified year");
                }
            }

            // Validate user calendar assignments
            if (data.userIds && data.userIds.length > 0) {
                await this.validateUserCalendars(data.userIds, targetYear, data._id);
            }

            // Get current assigned users
            const currentUserIds = (calendar.assignedTo ?? []).map((id) => id.toString());

            // Update calendar
            calendar.set({
                name: data.name ?? calendar.name,
                description: data.description ?? calendar.description,
                year: targetYear,
                holidays,
                assignedTo: data.userIds ? data.userIds.map((id) => new Types.ObjectId(id)) : calendar.assignedTo,
            });

            await calendar.save({ session });

            if (data.userIds) {
                // Remove calendar from users no longer assigned
                const removedUsers = currentUserIds.filter((id) => !(data.userIds ?? []).includes(id));
                if (removedUsers.length > 0) {
                    await User.updateMany(
                        { _id: { $in: removedUsers } },
                        { $unset: { holidayCalendar: 1 } },
                        { session },
                    );
                }

                // Add calendar to newly assigned users
                const newUsers = data.userIds.filter((id) => !currentUserIds.includes(id));
                if (newUsers.length > 0) {
                    await User.updateMany(
                        { _id: { $in: newUsers } },
                        { $set: { holidayCalendar: calendar._id } },
                        { session },
                    );
                }
            }

            await session.commitTransaction();
            return calendar;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    async getCalendars(query: { year?: number; page?: number; limit?: number }) {
        const { year, page = 1, limit = 10 } = query;
        const skip = (page - 1) * limit;

        // Build filter
        const filter: any = {};
        if (year) {
            filter.year = year;
        }

        // Execute queries in parallel
        const [calendars, total] = await Promise.all([
            HolidayCalendar.find(filter)
                .sort({ year: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('assignedTo', 'name email'),
            HolidayCalendar.countDocuments(filter)
        ]);

        return {
            calendars,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async assignEmployees({ calendarId, employeeIds }: IAssignEmployees) {
        const session = await HolidayCalendar.startSession();
        session.startTransaction();

        try {
            // Validate calendar exists
            const calendar = await HolidayCalendar.findById(calendarId);
            if (!calendar) {
                throw new Error('Holiday calendar not found');
            }

            // Convert string IDs to ObjectIds
            const employeeObjectIds = employeeIds.map(id => new Types.ObjectId(id));

            // Find other calendars from the same year that have these employees assigned
            const otherCalendars = await HolidayCalendar.find({
                _id: { $ne: calendarId },
                year: calendar.year,
                assignedTo: { $in: employeeObjectIds }
            });

            // Remove employees from other calendars
            if (otherCalendars.length > 0) {
                await Promise.all(otherCalendars.map(async (otherCalendar) => {
                    // Remove employees from assignedTo array
                    otherCalendar.assignedTo = (otherCalendar.assignedTo ?? []).filter(
                        userId => !employeeObjectIds.some(empId => empId.equals(userId))
                    );
                    await otherCalendar.save({ session });
                }));
            }


            // Update calendar's assignedTo array
            calendar.assignedTo = employeeObjectIds;
            await calendar.save({ session });

            // Remove calendar assignment from users not in the list
            await User.updateMany(
                {
                    holidayCalendarId: calendarId,
                    _id: { $nin: employeeObjectIds }
                },
                {
                    $unset: { holidayCalendarId: 1 }
                },
                { session }
            );

            // Update new users with calendar assignment
            await User.updateMany(
                { _id: { $in: employeeObjectIds } },
                {
                    $set: { holidayCalendarId: calendarId }
                },
                { session }
            );

            await session.commitTransaction();

            // Fetch updated calendar with populated user data
            const updatedCalendar = await HolidayCalendar.findById(calendarId)
                .populate('assignedTo', 'name email');

            return updatedCalendar;

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }
    async getCalendarsByUserId(userId: string): Promise<IHolidayCalendar | null> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID');
        }

        const userObjectId = new Types.ObjectId(userId);

        // First, check if user has a direct holidayCalendarId reference (Method 1)
        const user = await User.findById(userId).select('holidayCalendarId').lean();
        if (user?.holidayCalendarId) {
            const calendar = await HolidayCalendar.findById(user.holidayCalendarId)
                .select('-assignedTo -createdAt -updatedAt')
                .lean();
            if (calendar) {
                return calendar;
            }
        }

        // If no direct reference, check calendars where user is in assignedTo array (Method 2)
        const calendar = await HolidayCalendar.findOne({
            assignedTo: userObjectId
        })
            .select('-assignedTo -createdAt -updatedAt')
            .lean();

        return calendar;
    }

    async getUpcomingHolidays(userId: string, isAdmin: boolean = false, showAll: boolean = false) {
        const currentYear = new Date().getFullYear();
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day
        console.log(showAll, "showAll")
        let allCalendars: IHolidayCalendar[] = [];

        if (isAdmin) {
            allCalendars = await HolidayCalendar.find({ year: currentYear }).lean();
        } else {
            allCalendars = await HolidayCalendar.find({
                year: currentYear,
                assignedTo: userId,
            }).lean();
        }
        const holidayMap = new Map<string, {
            name: string;
            date: string;
            types: Set<string>;
            roles: Set<string>;
        }
        >();

        for (const calendar of allCalendars) {
            const roleName = calendar.name.split(" ")[0]; // Better if we use a new `group` field later

            for (const holiday of calendar.holidays) {
                const holidayDate = new Date(holiday.date);
                if (holidayDate < today) continue;

                const dateStr = holidayDate.toISOString().split("T")[0];

                const key = `${dateStr}_${holiday.name}`;

                if (!holidayMap.has(key)) {
                    holidayMap.set(key, {
                        name: holiday.name,
                        date: dateStr,
                        types: new Set([holiday.type]),
                        roles: new Set([roleName]),
                    });
                } else {
                    const entry = holidayMap.get(key)!;
                    entry.types.add(holiday.type);
                    entry.roles.add(roleName);
                }
            }
        }

        const result = Array.from(holidayMap.values()).map(entry => {
            let finalType = "optional";
            if (entry.types.has("mandatory")) finalType = "mandatory";
            else if (entry.types.has("client-specific")) finalType = "client-specific";

            return {
                date: entry.date,
                name: entry.name,
                type: finalType,
                roles: Array.from(entry.roles),
            };
        });

        // Sort by date (ascending)
        const sortedResult = result.sort((a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
        )

        // Return all or limit to 3 based on showAll parameter
        return showAll ? sortedResult : sortedResult.slice(0, 3);

        // const holidayMap = new Map();

        // for (const calendar of allCalendars) {
        //     const role = calendar.group; // e.g., "Admin", "Manager"
        //     for (const holiday of calendar.holidays) {
        //         if (new Date(holiday.date) < today) continue;

        //         const key = `${holiday.date.toISOString().split('T')[0]}|${holiday.name}`;
        //         if (!holidayMap.has(key)) {
        //             holidayMap.set(key, {
        //                 date: holiday.date,
        //                 name: holiday.name,
        //                 type: holiday.type,
        //                 description: holiday.description,
        //                 rolesApplicable: [role]
        //             });
        //         } else {
        //             holidayMap.get(key).rolesApplicable.push(role);
        //         }
        //     }
        // }

        // const upcomingHolidays = Array.from(holidayMap.values());

        // console.log(upcomingHolidays, "upcomingHolidays")
        // return upcomingHolidays;

    }

}

// export const holidayCalendarService = new HolidayCalendarService();