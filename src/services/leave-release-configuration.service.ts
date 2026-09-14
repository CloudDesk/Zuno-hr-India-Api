import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { RequestContext } from '../types/context';
import {
  LeaveReleaseConfiguration,
  LeaveReleaseConfigurationStatus,
  LeaveReleaseFrequency,
  User
} from '../models';
import { LeaveReleaseService } from './leave-release.service';

type ConfigurationInput = {
  name: string;
  leaveType: string;
  frequency: LeaveReleaseFrequency;
  daysPerRelease: number;
  effectiveStartDate: string | Date;
  effectiveEndDate?: string | Date | null;
  employeeIds: string[];
  status: LeaveReleaseConfigurationStatus;
};

const startOfUtcDate = (value: string | Date): Date => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const indiaBusinessDate = (value = new Date()): Date => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
};

const daysInUtcMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const addFrequencyFromAnchor = (
  anchor: Date,
  frequency: LeaveReleaseFrequency,
  occurrence: number
): Date => {
  if (frequency === 'daily') {
    const candidate = new Date(anchor);
    candidate.setUTCDate(candidate.getUTCDate() + occurrence);
    return candidate;
  }
  const months = frequency === 'monthly' ? occurrence : frequency === 'quarterly' ? occurrence * 3 : occurrence * 12;
  const targetMonthIndex = anchor.getUTCMonth() + months;
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(anchor.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
};

const nextOccurrenceOnOrAfter = (
  anchor: Date,
  frequency: LeaveReleaseFrequency,
  target: Date
): Date => {
  let occurrence = 0;
  let candidate = addFrequencyFromAnchor(anchor, frequency, occurrence);
  while (candidate < target) {
    occurrence += 1;
    candidate = addFrequencyFromAnchor(anchor, frequency, occurrence);
  }
  return candidate;
};

const nextOccurrenceAfter = (
  anchor: Date,
  frequency: LeaveReleaseFrequency,
  currentOccurrence: Date
): Date => {
  let occurrence = 1;
  let candidate = addFrequencyFromAnchor(anchor, frequency, occurrence);
  while (candidate <= currentOccurrence) {
    occurrence += 1;
    candidate = addFrequencyFromAnchor(anchor, frequency, occurrence);
  }
  return candidate;
};

export class LeaveReleaseConfigurationService {
  constructor(private context: RequestContext) {}

  private getActorId(): Types.ObjectId {
    const actorId = this.context.user?._id;
    if (!actorId) throw new Error('User not authenticated');
    return new Types.ObjectId(actorId.toString());
  }

  private async validateInput(input: ConfigurationInput): Promise<{
    startDate: Date;
    endDate?: Date;
    employeeIds: Types.ObjectId[];
  }> {
    if (!input.name?.trim()) throw new Error('Configuration name is required');
    if (!input.leaveType?.trim()) throw new Error('Leave type is required');
    if (!['daily', 'monthly', 'quarterly', 'yearly'].includes(input.frequency)) {
      throw new Error('Release frequency is invalid');
    }
    if (!['active', 'paused', 'inactive'].includes(input.status)) {
      throw new Error('Invalid activation status');
    }
    if (!Number.isFinite(input.daysPerRelease) || input.daysPerRelease <= 0) {
      throw new Error('Number of days must be greater than zero');
    }
    if (!Array.isArray(input.employeeIds) || input.employeeIds.length === 0) {
      throw new Error('Select at least one eligible employee');
    }

    const uniqueIds = [...new Set(input.employeeIds)];
    if (uniqueIds.some(id => !Types.ObjectId.isValid(id))) {
      throw new Error('One or more selected employees are invalid');
    }

    const employeeIds = uniqueIds.map(id => new Types.ObjectId(id));
    const eligibleCount = await User.countDocuments({
      _id: { $in: employeeIds },
      active: true,
      country: 'IN'
    });
    if (eligibleCount !== employeeIds.length) {
      throw new Error('Eligible employees must be active India employees');
    }

    const startDate = startOfUtcDate(input.effectiveStartDate);
    const endDate = input.effectiveEndDate
      ? startOfUtcDate(input.effectiveEndDate)
      : undefined;
    if (Number.isNaN(startDate.getTime()) || (endDate && Number.isNaN(endDate.getTime()))) {
      throw new Error('Effective period contains an invalid date');
    }
    if (endDate && endDate < startDate) {
      throw new Error('Effective end date cannot be before the start date');
    }

    return { startDate, endDate, employeeIds };
  }

  async list() {
    return LeaveReleaseConfiguration.find()
      .populate('employeeIds', 'name email employeeCode active country')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
  }

  async create(input: ConfigurationInput) {
    const actorId = this.getActorId();
    const { startDate, endDate, employeeIds } = await this.validateInput(input);
    const today = indiaBusinessDate();
    if (startDate < today) {
      throw new Error('Effective start date cannot be in the past');
    }

    return LeaveReleaseConfiguration.create({
      name: input.name.trim(),
      leaveType: input.leaveType,
      frequency: input.frequency,
      daysPerRelease: input.daysPerRelease,
      effectiveStartDate: startDate,
      effectiveEndDate: endDate,
      employeeIds,
      status: input.status,
      nextRunAt: startDate,
      createdBy: actorId,
      updatedBy: actorId
    });
  }

  async update(id: string, input: ConfigurationInput) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Invalid configuration ID');
    const actorId = this.getActorId();
    const existing = await LeaveReleaseConfiguration.findById(id);
    if (!existing) throw new Error('Leave release configuration not found');

    const requestedStartDate = startOfUtcDate(input.effectiveStartDate);
    const requestedEndDate = input.effectiveEndDate
      ? startOfUtcDate(input.effectiveEndDate)
      : undefined;
    const existingEndTime = existing.effectiveEndDate?.getTime();
    const requestedEndTime = requestedEndDate?.getTime();
    const immutableFieldChanged =
      existing.leaveType !== input.leaveType ||
      existing.frequency !== input.frequency ||
      existing.daysPerRelease !== input.daysPerRelease ||
      existing.effectiveStartDate.getTime() !== requestedStartDate.getTime() ||
      existingEndTime !== requestedEndTime;

    if (immutableFieldChanged) {
      throw new Error(
        'Only configuration name, activation status, and eligible employees can be edited after creation'
      );
    }

    const { employeeIds } = await this.validateInput(input);
    const today = indiaBusinessDate();
    const previousStatus = existing.status;

    existing.name = input.name.trim();
    existing.employeeIds = employeeIds;
    existing.status = input.status;
    existing.updatedBy = actorId;
    if (input.status === 'active' && (previousStatus !== 'active' || existing.nextRunAt < today)) {
      existing.nextRunAt = nextOccurrenceOnOrAfter(
        existing.effectiveStartDate,
        existing.frequency,
        today
      );
    }
    return existing.save();
  }

  async setStatus(id: string, status: LeaveReleaseConfigurationStatus) {
    if (!['active', 'paused', 'inactive'].includes(status)) {
      throw new Error('Invalid activation status');
    }
    const actorId = this.getActorId();
    const configuration = await LeaveReleaseConfiguration.findById(id);
    if (!configuration) throw new Error('Leave release configuration not found');
    configuration.status = status;
    configuration.updatedBy = actorId;
    if (status === 'active') {
      configuration.nextRunAt = nextOccurrenceOnOrAfter(
        configuration.effectiveStartDate,
        configuration.frequency,
        indiaBusinessDate()
      );
    }
    return configuration.save();
  }

  static async processDueConfigurations(now = new Date()) {
    const today = indiaBusinessDate(now);
    const staleLock = new Date(now.getTime() - 30 * 60 * 1000);
    const totals = { processed: 0, credited: 0, skipped: 0, failed: 0 };

    await LeaveReleaseConfiguration.updateMany(
      { status: 'active', effectiveEndDate: { $lt: today } },
      { $set: { status: 'inactive', lastRunMessage: 'Effective period completed' } }
    );

    while (true) {
      const processingToken = randomUUID();
      const configuration = await LeaveReleaseConfiguration.findOneAndUpdate(
        {
          status: 'active',
          nextRunAt: { $lte: today },
          $and: [
            {
              $or: [
                { effectiveEndDate: { $exists: false } },
                { effectiveEndDate: null },
                { effectiveEndDate: { $gte: today } }
              ]
            },
            {
              $or: [
                { processingAt: { $exists: false } },
                { processingAt: null },
                { processingAt: { $lt: staleLock } }
              ]
            }
          ]
        },
        { $set: { processingAt: now, processingToken } },
        { new: true }
      );
      if (!configuration) break;

      totals.processed += 1;
      const dueDate = configuration.nextRunAt;
      const creator = await User.findById(configuration.createdBy).lean();
      try {
        if (!creator) throw new Error('Configuration owner no longer exists');
        const context: RequestContext = {
          requestId: `LEAVE-AUTO-${configuration._id}-${dueDate.toISOString()}`,
          reqRole: 'ADMIN',
          user: {
            _id: creator._id,
            email: creator.email,
            name: creator.name,
            role: creator.role,
            departmentId: creator.departmentId,
            active: creator.active,
            country: creator.country,
            currency: creator.currency,
            licenseType: creator.licenseType,
            portalAccess: creator.portalAccess
          }
        };
        const month = dueDate.getUTCMonth() + 1;
        const releaseType = configuration.frequency === 'yearly'
          ? 'annual'
          : configuration.frequency;
        const period = releaseType === 'daily'
          ? { year: dueDate.getUTCFullYear(), month, day: dueDate.getUTCDate() }
          : releaseType === 'monthly'
          ? { year: dueDate.getUTCFullYear(), month }
          : releaseType === 'quarterly'
            ? { year: dueDate.getUTCFullYear(), quarter: Math.ceil(month / 3) }
            : { year: dueDate.getUTCFullYear() };
        const result = await new LeaveReleaseService(context).releaseLeaves({
          employeeIds: configuration.employeeIds.map(id => id.toString()),
          releaseType,
          period,
          leaveType: configuration.leaveType as any,
          daysReleased: configuration.daysPerRelease,
          notes: `Automatic release: ${configuration.name}`,
          requestId: `auto:${configuration._id}:${dueDate.toISOString().slice(0, 10)}`,
          skipExisting: true,
          source: 'automatic',
          automationConfigurationId: configuration._id.toString(),
          scheduledFor: dueDate
        });

        totals.credited += result.success;
        totals.skipped += result.skipped?.length || 0;
        totals.failed += result.failed.length;
        const nextRunAt = nextOccurrenceAfter(
          configuration.effectiveStartDate,
          configuration.frequency,
          dueDate
        );
        const shouldDeactivate = Boolean(
          configuration.effectiveEndDate && nextRunAt > configuration.effectiveEndDate
        );
        await LeaveReleaseConfiguration.updateOne(
          { _id: configuration._id, processingToken },
          {
            $set: {
              nextRunAt,
              lastRunAt: now,
              lastRunStatus: result.failed.length === 0 ? 'success' : result.success > 0 ? 'partial' : 'failed',
              lastRunMessage: `${result.success} credited, ${result.skipped?.length || 0} skipped, ${result.failed.length} failed`,
              ...(shouldDeactivate ? { status: 'inactive' } : {})
            },
            $unset: { processingAt: 1, processingToken: 1 }
          }
        );
      } catch (error: any) {
        totals.failed += configuration.employeeIds.length;
        await LeaveReleaseConfiguration.updateOne(
          { _id: configuration._id, processingToken },
          {
            $set: {
              lastRunAt: now,
              lastRunStatus: 'failed',
              lastRunMessage: error.message || 'Automatic leave release failed',
              status: 'paused'
            },
            $unset: { processingAt: 1, processingToken: 1 }
          }
        );
      }
    }
    return totals;
  }
}
