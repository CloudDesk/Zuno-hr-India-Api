import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { SocialEvent, ISocialEvent } from '../models/social-event.model';
import { User } from '../models/user.model';
import { emailService } from './email.service';
import { Types } from 'mongoose';
import { saveMultipartFile } from '../utilis/parseMultiPartForm';
import { deleteFileFromGCP, uploadFileToGCP } from '../utilis/gcpStorage';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

const getDateKeyInTimeZone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

export class CommunicationService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    private buildAttachmentUrl(storedPath: string): string {
        if (/^https?:\/\//i.test(storedPath)) {
            return storedPath;
        }

        const baseUrl = (process.env.API_URL || config.apiUrl || '').replace(/\/$/, '');
        const normalizedPath = storedPath
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/^uploads\//, '');
        return `${baseUrl}/${normalizedPath}`;
    }

    private getAttachmentLabel(storedPath: string): string {
        return storedPath.split('/').pop()?.split('-').slice(1).join('-') || 'Attachment';
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private buildCommunicationHtml(data: {
        firstName: string;
        message: string;
        attachmentPaths: string[];
    }): string {
        const attachmentList = data.attachmentPaths.length > 0
            ? `<p><strong>Attachments:</strong></p><ul>${data.attachmentPaths.map(attachment => {
                const label = this.escapeHtml(this.getAttachmentLabel(attachment));
                const url = this.escapeHtml(this.buildAttachmentUrl(attachment));
                return `<li><a href="${url}">${label}</a></li>`;
            }).join('')}</ul>`
            : '';

        return [
            `<p>Hi ${this.escapeHtml(data.firstName)},</p>`,
            `<p>${this.escapeHtml(data.message).replace(/\n/g, '<br>')}</p>`,
            attachmentList,
            '<p>Best Regards,<br>Management Team - Cloud Desk Technology Pvt Ltd.</p>'
        ].filter(Boolean).join('');
    }

    /**
     * Send a personalized greeting and record it for the Social Wall
     */
    async sendPersonalizedGreeting(data: {
        employeeIds: string[];
        type: 'Event' | 'Policy' | 'Other' | 'Greeting';
        subject: string;
        message: string;
        eventDate: string | Date;
        adminId: string;
        files?: any[]; // Multipart parts
        socialEventId?: string; // Optional: for re-dispatching to existing event
        active?: boolean;
        retainedAttachments?: string[];
    }): Promise<any> {
        const {
            employeeIds,
            type,
            subject,
            message,
            eventDate,
            adminId,
            files,
            socialEventId,
            active,
            retainedAttachments
        } = data;

        const parsedEventDate = new Date(eventDate);
        if (Number.isNaN(parsedEventDate.getTime())) {
            throw new Error('Please provide a valid event date');
        }

        // Historical events may still be edited, but newly created events cannot
        // be dated before the current business day in India.
        if (!socialEventId) {
            const selectedEventDate = typeof eventDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(eventDate)
                ? eventDate.slice(0, 10)
                : getDateKeyInTimeZone(parsedEventDate, 'Asia/Kolkata');
            const todayInIndia = getDateKeyInTimeZone(new Date(), 'Asia/Kolkata');

            if (selectedEventDate < todayInIndia) {
                throw new Error('Event date cannot be in the past');
            }
        }

        let socialEvent: any;
        let newEmployeeIds = [
            ...new Set((employeeIds || []).map(id => id.toString()))
        ];
        if (newEmployeeIds.some(id => !Types.ObjectId.isValid(id))) {
            throw new Error('One or more employee IDs are invalid');
        }

        if (socialEventId) {
            socialEvent = await SocialEvent.findById(socialEventId);
            if (!socialEvent) throw new Error('Existing event not found');

            // Editing must not resend the communication to recipients who are
            // already assigned. Only genuinely new selections are notified.
            const assignedIds = new Set(
                (socialEvent.targets?.employees || []).map((id: Types.ObjectId) => id.toString())
            );
            newEmployeeIds = newEmployeeIds.filter(id => !assignedIds.has(id.toString()));
        }

        const effectiveType = socialEvent?.type || type;
        const existingAttachmentPaths: string[] = Array.isArray(socialEvent?.attachments)
            ? socialEvent.attachments
            : [];
        let attachmentsToRetain = existingAttachmentPaths;

        if (socialEvent && retainedAttachments !== undefined) {
            const invalidAttachment = retainedAttachments.some(
                attachment => !existingAttachmentPaths.includes(attachment)
            );
            if (invalidAttachment) {
                throw new Error('One or more retained attachments are invalid');
            }
            attachmentsToRetain = existingAttachmentPaths.filter(
                attachment => retainedAttachments.includes(attachment)
            );
        }

        const removedAttachmentPaths = existingAttachmentPaths.filter(
            attachment => !attachmentsToRetain.includes(attachment)
        );
        const employees = await User.find({ _id: { $in: newEmployeeIds.map(id => new Types.ObjectId(id)) } }).lean();
        const employeeById = new Map(
            employees.map(employee => [employee._id.toString(), employee])
        );
        newEmployeeIds = newEmployeeIds.filter(id => employeeById.has(id.toString()));
        if (!socialEventId && newEmployeeIds.length === 0) {
            throw new Error('Please select at least one valid employee');
        }
        const assignedByObjectId = new Types.ObjectId(adminId);
        const assignmentTimestamp = new Date();
        const assignmentEntries = newEmployeeIds.map(id => {
            const employee = employeeById.get(id.toString())!;
            return {
                employeeId: new Types.ObjectId(id),
                employeeName: employee.name,
                employeeCode: employee.employeeCode,
                employeeEmail: employee.email,
                assignedAt: assignmentTimestamp,
                assignedBy: assignedByObjectId,
                assignedByName: this.context.user?.name || 'Admin'
            };
        });

        const attachmentPaths: string[] = [];
        const emailAttachments: any[] = [];
        const temporaryAttachmentPaths: string[] = [];
        const uploadedAttachmentUrls: string[] = [];
        const results = [];
        const eventStorageId = socialEvent?._id || new Types.ObjectId();
        let attachmentsPersisted = false;
        let updateData: any = {};
        try {
            // Follow the same temporary-file -> GCP -> database flow used by
            // documents and payslips. One event owns one shared copy of each
            // attachment, regardless of how many employees receive it.
            if (files && files.length > 0) {
                const uploadDir = path.join(process.cwd(), 'uploads', 'communications');

                for (const [index, file] of files.entries()) {
                    const originalFileName = path.basename(file.filename || `attachment-${index + 1}`);
                    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const storedFileName = `${Date.now() + index}-${safeFileName}`;
                    const targetPath = path.join(uploadDir, storedFileName);

                    await saveMultipartFile(file, targetPath);
                    temporaryAttachmentPaths.push(targetPath);

                    const gcpResult = await uploadFileToGCP({
                        filePath: targetPath,
                        fileName: storedFileName,
                        employeeId: eventStorageId.toString(),
                        category: 'Communication',
                        type: effectiveType
                    });

                    if (!gcpResult.success || !gcpResult.fileUrl) {
                        throw new Error(`Failed to upload communication attachment to GCP: ${gcpResult.error || 'Unknown error'}`);
                    }

                    attachmentPaths.push(gcpResult.fileUrl);
                    uploadedAttachmentUrls.push(gcpResult.fileUrl);
                    emailAttachments.push({
                        filename: originalFileName,
                        path: targetPath,
                        mimetype: file.mimetype
                    });
                }
            }

            // 1. Record/Update the event for the Social Wall
            if (socialEventId && socialEvent) {
                // Update existing event using safer findByIdAndUpdate
                updateData = {
                    $set: {
                        subject,
                        message,
                        eventDate: parsedEventDate,
                        active: active ?? socialEvent.active !== false,
                        attachments: [...attachmentsToRetain, ...attachmentPaths]
                    },
                    $addToSet: {
                        "targets.employees": { $each: newEmployeeIds.map(id => new Types.ObjectId(id)) }
                    }
                };

                if (assignmentEntries.length > 0) {
                    updateData.$push = {
                        assignmentHistory: { $each: assignmentEntries }
                    };
                }

                await SocialEvent.findByIdAndUpdate(socialEventId, updateData);
                // Refresh document for the response
                socialEvent = await SocialEvent.findById(socialEventId);
            } else {
                // Create new event
                socialEvent = await new SocialEvent({
                    _id: eventStorageId,
                    type,
                    subject,
                    message,
                    eventDate: parsedEventDate,
                    active: active ?? true,
                    attachments: attachmentPaths,
                    postedBy: new Types.ObjectId(adminId),
                    targets: {
                        employees: newEmployeeIds.map(id => new Types.ObjectId(id))
                    },
                    assignmentHistory: assignmentEntries
                }).save();
            }
            attachmentsPersisted = true;

            if (removedAttachmentPaths.length > 0) {
                const deletionResults = await Promise.all(
                    removedAttachmentPaths.map(async fileUrl => ({
                        fileUrl,
                        result: await deleteFileFromGCP(fileUrl)
                    }))
                );
                deletionResults.forEach(({ fileUrl, result }) => {
                    if (!result.success) {
                        console.error(`Failed to delete removed communication attachment ${fileUrl}:`, result.error);
                    }
                });
            }

            const storedAttachmentPaths = Array.isArray(socialEvent.attachments)
                ? socialEvent.attachments
                : [];
            const attachmentText = storedAttachmentPaths.length > 0
                ? `\n\nAttachments:\n${storedAttachmentPaths
                    .map((attachment: string) => `- ${this.getAttachmentLabel(attachment)}: ${this.buildAttachmentUrl(attachment)}`)
                    .join('\n')}`
                : '';

            // 2. Notify recipients with bounded concurrency. Each employee still
            // receives an individual personalized email, while multiple SMTP
            // round trips can progress together for large broadcasts.
            const emailConcurrency = Math.min(5, Math.max(1, employees.length));
            const emailResults: any[] = new Array(employees.length);
            let nextEmployeeIndex = 0;

            const sendEmailWorker = async () => {
                while (nextEmployeeIndex < employees.length) {
                    const employeeIndex = nextEmployeeIndex++;
                    const employee = employees[employeeIndex];
                    const firstName = employee.name.split(' ')[0];
                    const text = `Hi ${firstName},\n\n${message}${attachmentText}\n\nBest Regards,\nManagement Team - Cloud Desk Technology Pvt Ltd.`;

                    try {
                        await emailService.sendEmail({
                            body: {
                                to: employee.email,
                                subject: subject || `${effectiveType} from Cloud Desk`,
                                text,
                                html: this.buildCommunicationHtml({
                                    firstName,
                                    message,
                                    attachmentPaths: storedAttachmentPaths
                                })
                            },
                            files: emailAttachments // Only newly uploaded files are attached to new emails.
                        });
                        emailResults[employeeIndex] = {
                            employeeId: employee._id,
                            status: 'success'
                        };
                    } catch (err: any) {
                        emailResults[employeeIndex] = {
                            employeeId: employee._id,
                            status: 'failed',
                            error: err.message
                        };
                    }
                }
            };

            await Promise.all(
                Array.from({ length: emailConcurrency }, () => sendEmailWorker())
            );
            results.push(...emailResults);

            const assignedRecipientIds = (socialEvent.targets?.employees || []).map(
                (id: Types.ObjectId) => id.toString()
            );
            const assignedRecipientRecords = await User.find(
                { _id: { $in: assignedRecipientIds.map((id: string) => new Types.ObjectId(id)) } },
                '_id name email employeeCode'
            ).lean();
            const historyEvent: any = await SocialEvent.findById(socialEvent._id)
                .select('assignmentHistory createdAt')
                .populate('assignmentHistory.employeeId', 'name email employeeCode')
                .populate('assignmentHistory.assignedBy', 'name email employeeCode')
                .lean();
            const assignmentHistory = historyEvent?.assignmentHistory?.length > 0
                ? historyEvent.assignmentHistory
                : assignedRecipientRecords.map(recipient => ({
                    employeeId: {
                        _id: recipient._id.toString(),
                        name: recipient.name,
                        email: recipient.email,
                        employeeCode: recipient.employeeCode
                    },
                    assignedAt: historyEvent?.createdAt || socialEvent.createdAt,
                    assignedBy: null,
                    legacy: true
                }));

            return {
                success: true,
                socialEventId: socialEvent._id,
                total: employees.length,
                results,
                assignedRecipients: assignedRecipientRecords.map(recipient => ({
                    _id: recipient._id.toString(),
                    name: recipient.name,
                    email: recipient.email,
                    employeeCode: recipient.employeeCode
                })),
                assignmentHistory,
                attachments: storedAttachmentPaths,
                active: socialEvent.active !== false,
                type: socialEvent.type
            };
        } catch (error: any) {
            // If persistence failed, avoid leaving uploaded GCP objects that no
            // event references. Once the event is saved, its attachments must
            // remain available even if an individual email later fails.
            if (!attachmentsPersisted && uploadedAttachmentUrls.length > 0) {
                await Promise.allSettled(
                    uploadedAttachmentUrls.map(fileUrl => deleteFileFromGCP(fileUrl))
                );
            }
            console.error('Error in sendPersonalizedGreeting:', error);
            throw error;
        } finally {
            await Promise.allSettled(
                temporaryAttachmentPaths.map(filePath => fs.promises.unlink(filePath))
            );
        }
    }

    async updateCommunicationStatus(id: string, active: boolean): Promise<ISocialEvent> {
        if (!Types.ObjectId.isValid(id)) {
            throw new Error('Invalid communication ID');
        }

        const event = await SocialEvent.findOneAndUpdate(
            {
                _id: new Types.ObjectId(id),
                type: { $nin: ['Birthday', 'Anniversary'] }
            },
            { $set: { active } },
            { new: true }
        ).lean();

        if (!event) {
            throw new Error('Communication not found');
        }

        return event as ISocialEvent;
    }

    /**
     * Automated Milestone Engine: Daily job for Birthdays and Anniversaries
     */
    async processDailyMilestones(): Promise<any> {
        // Use India Standard Time (IST) for milestone detection as per company locale
        const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const currentMonth = istNow.getMonth() + 1;
        const currentDay = istNow.getDate();

        // Normalized date for filtering (matches dashboard UTC midnight boundary for the IST day)
        const normalizedEventDate = new Date(Date.UTC(istNow.getFullYear(), istNow.getMonth(), istNow.getDate()));

        // Fetch Birthdays
        const birthdayUsers = await User.aggregate([
            { $match: { active: true, dateOfBirth: { $exists: true } } },
            {
                $project: {
                    name: 1, email: 1,
                    month: { $month: "$dateOfBirth" },
                    day: { $dayOfMonth: "$dateOfBirth" }
                }
            },
            { $match: { month: currentMonth, day: currentDay } }
        ]);

        // Fetch Anniversaries
        const anniversaryUsers = await User.aggregate([
            { $match: { active: true, joiningDate: { $exists: true } } },
            {
                $project: {
                    name: 1, email: 1, joiningDate: 1,
                    month: { $month: "$joiningDate" },
                    day: { $dayOfMonth: "$joiningDate" },
                    years: { $subtract: [istNow.getFullYear(), { $year: "$joiningDate" }] }
                }
            },
            { $match: { month: currentMonth, day: currentDay, years: { $gt: 0 } } }
        ]);

        console.log(`[CommunicationEngine] Today: ${birthdayUsers.length} birthdays, ${anniversaryUsers.length} anniversaries.`);

        // Record Birthdays
        for (const user of birthdayUsers) {
            const subject = `Happy Birthday, ${user.name.split(' ')[0]}! 🎂`;
            const message = `Warmest wishes on your birthday! We value your contributions and presence in the team.`;

            // Create social wall post only if it doesn't already exist for today
            const existingPost = await SocialEvent.findOne({
                type: 'Birthday',
                employeeId: user._id,
                eventDate: normalizedEventDate
            });

            if (!existingPost) {
                await new SocialEvent({
                    type: 'Birthday',
                    employeeId: user._id,
                    subject,
                    message,
                    eventDate: normalizedEventDate,
                    postedBy: 'SYSTEM'
                }).save();

                // Send Email only for the first time
                await this.sendEmailSilently(user.email, subject, message, user.name);
            }
        }

        // Record Anniversaries
        for (const user of anniversaryUsers) {
            const years = user.years;
            const ordinal = (n: number) => {
                const s = ["th", "st", "nd", "rd"];
                const v = n % 100;
                return n + (s[(v - 20) % 10] || s[v] || s[0]);
            };

            const subject = `Happy ${ordinal(years)} Work Anniversary! 🎖️`;
            const message = `Congratulations on your ${years} year(s) journey with us! We appreciate your dedication and energy.`;

            const existingPost = await SocialEvent.findOne({
                type: 'Anniversary',
                employeeId: user._id,
                eventDate: normalizedEventDate
            });

            if (!existingPost) {
                await new SocialEvent({
                    type: 'Anniversary',
                    employeeId: user._id,
                    subject,
                    message,
                    eventDate: normalizedEventDate,
                    postedBy: 'SYSTEM',
                    metadata: { years }
                }).save();

                await this.sendEmailSilently(user.email, subject, message, user.name);
            }
        }

        return { birthdays: birthdayUsers.length, anniversaries: anniversaryUsers.length };
    }

    private async sendEmailSilently(to: string, subject: string, message: string, name: string) {
        try {
            const firstName = name.split(' ')[0];
            const text = `Hi ${firstName},\n\n${message}\n\nBest Regards,\nManagement Team - Cloud Desk Technology Pvt Ltd.`;

            await emailService.sendEmail({
                body: { to, subject, text }
            });
        } catch (e) {
            console.error(`Failed to send milestone email to ${to}:`, e);
        }
    }

    /**
     * Get events for the Social Wall
     */
    async getSocialWall(query: { limit?: number; offset?: number; viewerId?: string; viewerRole?: string; teamOnly?: boolean; viewerOnly?: boolean } = {}): Promise<ISocialEvent[]> {
        const { limit, viewerId, viewerRole, teamOnly, viewerOnly } = query;
        // Event dates are stored as UTC calendar dates. Derive today's calendar
        // date in IST so visibility is consistent regardless of server timezone.
        const todayInIST = getDateKeyInTimeZone(new Date(), 'Asia/Kolkata');
        const todayAtStartOfIST = new Date(`${todayInIST}T00:00:00.000Z`);
        const tomorrowAtStartOfIST = new Date(todayAtStartOfIST.getTime() + 86400000);

        const milestoneVisibilityQuery = {
            type: { $in: ['Birthday', 'Anniversary'] },
            eventDate: { $gte: todayAtStartOfIST, $lt: tomorrowAtStartOfIST }
        };
        const manualVisibilityQuery = {
            $or: [
                // Policies remain available every day, irrespective of their issue date.
                { type: 'Policy' },
                // Event, Other and legacy Greeting communications are date-specific.
                {
                    type: { $in: ['Event', 'Other', 'Greeting'] },
                    eventDate: { $gte: todayAtStartOfIST, $lt: tomorrowAtStartOfIST }
                }
            ]
        };

        let finalQuery: any = {
            $or: [
                // 1. All Milestones (Global - everyone sees birthdays/anniversaries)
                milestoneVisibilityQuery,

                // 2. Manual communications following their type-based visibility window
                manualVisibilityQuery
            ]
        };

        // The personal dashboard must respect assignments for every role. Without
        // this explicit branch, Admin/HR users received every manual event even
        // when the event was assigned only to specific employees.
        if (viewerId && viewerOnly) {
            const viewerObjectId = new Types.ObjectId(viewerId);
            const viewerTargetFilters: any[] = [
                { 'targets.employees': viewerObjectId }
            ];

            if (this.context.user?.departmentId) {
                viewerTargetFilters.push({ 'targets.departments': this.context.user.departmentId });
            }

            if (viewerRole) {
                const roleVariants = Array.from(new Set([
                    viewerRole,
                    viewerRole.toLowerCase(),
                    viewerRole.toUpperCase()
                ]));
                viewerTargetFilters.push({ 'targets.roles': { $in: roleVariants } });
            }

            viewerTargetFilters.push(
                { 'targets.employees': { $exists: false } },
                { 'targets.employees': { $size: 0 } }
            );

            finalQuery = {
                $or: [
                    milestoneVisibilityQuery,
                    {
                        $and: [
                            manualVisibilityQuery,
                            { $or: viewerTargetFilters }
                        ]
                    }
                ]
            };
            // If not an admin/HR, add restrictive filters for manual events,
            // or enforce strict team filtering when teamOnly is requested.
        } else if (viewerId && (teamOnly || (viewerRole !== 'admin' && viewerRole !== 'humanResources'))) {
            // Find all employees managed by this user
            const managedEmployees = await User.find({ managerId: viewerId }, '_id').lean();
            const managedIds = managedEmployees.map(e => e._id);
            const viewerObjectId = new Types.ObjectId(viewerId);

            finalQuery = {
                $or: [
                    // Milestones stay global
                    milestoneVisibilityQuery,

                    // Manual events restricted to Target list or Team Context
                    {
                        $and: [
                            manualVisibilityQuery,
                            {
                                $or: [
                                    { 'targets.employees': viewerObjectId }, // Directly targeted (Self)
                                    { 'targets.employees': { $in: managedIds } }, // Targeted at team member (Only Team)
                                    // Include Dept/Role only if NOT in strict 'teamOnly' mode
                                    ...(!teamOnly ? [
                                        { 'targets.departments': this.context.user?.departmentId },
                                        { 'targets.roles': this.context.user?.role }
                                    ] : []),
                                    { 'targets.employees': { $exists: false } }, // Public Global fallback
                                    { 'targets.employees': { $size: 0 } } // Public Global fallback
                                ]
                            }
                        ]
                    }
                ]
            };
        } else if (!viewerId || (viewerRole !== 'admin' && viewerRole !== 'humanResources')) {
            // Security Fallback: If identity is missing or not authorized, 
            // strictly show ONLY Global Milestones and Public Global Manual Events.
            // This fixes the "Global Leak" where private events were visible to anonymous/unmapped users.
            finalQuery = {
                $or: [
                    milestoneVisibilityQuery,
                    {
                        $and: [
                            manualVisibilityQuery,
                            {
                                $or: [
                                    { 'targets.employees': { $exists: false } },
                                    { 'targets.employees': { $size: 0 } }
                                ]
                            }
                        ]
                    }
                ]
            };
        }

        // Keep inactive communications in admin history while removing them
        // from every user-facing social-wall response. `$ne: false` preserves
        // visibility for legacy records created before the field existed.
        finalQuery = {
            $and: [
                { active: { $ne: false } },
                finalQuery
            ]
        };

        return SocialEvent.find(finalQuery)
            .sort({ eventDate: 1, createdAt: -1 })
            .limit(limit || 10)
            .populate('employeeId', 'name profilePicture')
            .lean();
    }

    /**
     * Build the birthday and work-anniversary calendar for the current month.
     * This is derived from employee records so future dates do not depend on
     * the daily milestone job having already created a social-wall post.
     */
    async getMonthlyMilestones(referenceDate: Date = new Date()): Promise<any[]> {
        const month = referenceDate.getMonth() + 1;
        const year = referenceDate.getFullYear();

        const employees = await User.find({
            active: true,
            $or: [
                { dateOfBirth: { $exists: true, $ne: null } },
                { joiningDate: { $exists: true, $ne: null } }
            ]
        })
            .select('_id name dateOfBirth joiningDate profilePicture')
            .lean();

        const milestones: any[] = [];

        for (const employee of employees) {
            if (employee.dateOfBirth) {
                const dateOfBirth = new Date(employee.dateOfBirth);
                if (dateOfBirth.getMonth() + 1 === month) {
                    milestones.push({
                        _id: `birthday-${employee._id}`,
                        type: 'Birthday',
                        subject: `${employee.name}'s birthday`,
                        message: '',
                        eventDate: new Date(year, month - 1, dateOfBirth.getDate()),
                        postedBy: 'SYSTEM',
                        employeeId: {
                            _id: employee._id,
                            name: employee.name
                        },
                        metadata: { dateOfBirth: employee.dateOfBirth }
                    });
                }
            }

            if (employee.joiningDate) {
                const joiningDate = new Date(employee.joiningDate);
                const years = year - joiningDate.getFullYear();
                if (joiningDate.getMonth() + 1 === month && years > 0) {
                    milestones.push({
                        _id: `anniversary-${employee._id}`,
                        type: 'Anniversary',
                        subject: `${employee.name}'s work anniversary`,
                        message: '',
                        eventDate: new Date(year, month - 1, joiningDate.getDate()),
                        postedBy: 'SYSTEM',
                        employeeId: {
                            _id: employee._id,
                            name: employee.name
                        },
                        metadata: { joiningDate: employee.joiningDate, years }
                    });
                }
            }
        }

        const monthStart = new Date(year, month - 1, 1);
        const nextMonthStart = new Date(year, month, 1);
        const communicationEvents = await SocialEvent.find({
            type: { $nin: ['Birthday', 'Anniversary'] },
            eventDate: { $gte: monthStart, $lt: nextMonthStart }
        })
            .sort({ eventDate: 1, createdAt: -1 })
            .lean();

        return [...milestones, ...communicationEvents]
            .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
    }

    /**
     * Get communication logs (manual dispatches) including past events
     */
    async getCommunicationLogs(query: { page?: number; limit?: number; search?: string; month?: number; year?: number } = {}): Promise<any> {
        const { page = 1, limit = 10, search, month, year } = query;
        const skip = (Number(page) - 1) * Number(limit);

        const finalQuery: any = {
            type: { $nin: ['Birthday', 'Anniversary'] } // Only manual events
        };

        if (search) {
            finalQuery.$or = [
                { subject: new RegExp(search, 'i') },
                { message: new RegExp(search, 'i') },
                { type: new RegExp(search, 'i') }
            ];
        }

        if (month !== undefined || year !== undefined) {
            const start = new Date(year || new Date().getFullYear(), (month !== undefined ? month - 1 : 0), 1);
            const end = new Date(year || new Date().getFullYear(), (month !== undefined ? month : 12), 0, 23, 59, 59, 999);
            finalQuery.eventDate = { $gte: start, $lte: end };
        }

        const [total, results] = await Promise.all([
            SocialEvent.countDocuments(finalQuery),
            SocialEvent.find(finalQuery)
                .sort({ eventDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate('employeeId', 'name profilePicture')
                .populate('targets.employees', 'name email employeeCode active')
                .populate('assignmentHistory.employeeId', 'name email employeeCode active')
                .populate('assignmentHistory.assignedBy', 'name email employeeCode')
                .lean()
        ]);

        const resultsWithAssignmentHistory = results.map((event: any) => {
            if (event.assignmentHistory?.length > 0) return event;

            return {
                ...event,
                assignmentHistory: (event.targets?.employees || [])
                    .filter(Boolean)
                    .map((employee: any) => ({
                        employeeId: employee,
                        assignedAt: event.createdAt,
                        assignedBy: null,
                        legacy: true
                    }))
            };
        });

        return {
            data: resultsWithAssignmentHistory,
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit))
            }
        };
    }

    async getMyCommunicationHistory(query: { page?: number; limit?: number; search?: string; type?: string; month?: number; year?: number } = {}): Promise<any> {
        const { page = 1, limit = 10, search, type, month, year } = query;
        const skip = (Number(page) - 1) * Number(limit);
        const viewer = this.context.user;

        if (!viewer?._id) {
            throw new Error('User context is required');
        }

        const viewerObjectId = new Types.ObjectId(viewer._id.toString());
        const roleVariants = [
            viewer.role,
            viewer.role?.toLowerCase(),
            viewer.role?.toUpperCase()
        ].filter(Boolean);

        const allowedTypes = ['Event', 'Policy', 'Other', 'Greeting'];
        const finalQuery: any = {
            type: type && allowedTypes.includes(type) ? type : { $in: allowedTypes },
            active: { $ne: false },
            $or: [
                { 'targets.employees': viewerObjectId },
                { 'targets.departments': viewer.departmentId },
                { 'targets.roles': { $in: roleVariants } },
                { 'targets.employees': { $exists: false } },
                { 'targets.employees': { $size: 0 } }
            ]
        };

        if (search) {
            finalQuery.$and = [
                {
                    $or: [
                        { subject: new RegExp(search, 'i') },
                        { message: new RegExp(search, 'i') },
                        { type: new RegExp(search, 'i') }
                    ]
                }
            ];
        }

        if (month !== undefined || year !== undefined) {
            const start = new Date(year || new Date().getFullYear(), (month !== undefined ? month - 1 : 0), 1);
            const end = new Date(year || new Date().getFullYear(), (month !== undefined ? month : 12), 0, 23, 59, 59, 999);
            finalQuery.eventDate = { $gte: start, $lte: end };
        }

        const [total, results] = await Promise.all([
            SocialEvent.countDocuments(finalQuery),
            SocialEvent.find(finalQuery)
                .sort({ eventDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate('postedBy', 'name')
                .lean()
        ]);

        return {
            data: results,
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit))
            }
        };
    }
}
