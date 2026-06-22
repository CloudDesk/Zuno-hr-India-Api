import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { Leave } from '../src/models/leave.model';
import { LeaveSummary } from '../src/models/leave-summary.model';
import { LeaveCarryForward } from '../src/models/leave-carry-forward.model';
import { User } from '../src/models/user.model';

dotenv.config();

export type LeaveSummaryCategory =
  | 'annual'
  | 'sick'
  | 'compOff'
  | 'lossOfPay'
  | 'otherPaid'
  | 'otherUnpaid'
  | 'maternity'
  | 'workFromHome'
  | 'restricted_holiday';

export interface ReconciliationOptions {
  year?: number;
  userId?: string;
  outDir?: string;
  allYears?: boolean;
}

export interface SummaryReportRow {
  userId: string;
  employeeCode: string;
  employeeName: string;
  email: string;
  country: string;
  year: number;
  category: LeaveSummaryCategory;
  summaryExists: boolean;
  alloted: number;
  currentAvailed: number;
  calculatedAvailed: number;
  availedDiff: number;
  currentRemaining: number;
  calculatedRemaining: number;
  remainingDiff: number;
  carriedForwardOut: number;
  currentLeaveRequestCount: number;
  calculatedLeaveRequestCount: number;
  leaveRequestIdsMatch: boolean;
  missingLeaveRequestIds: string;
  extraLeaveRequestIds: string;
  pendingDays: number;
  approvedDays: number;
  pendingCount: number;
  approvedCount: number;
  needsUpdate: boolean;
}

export interface LeaveDetailRow {
  userId: string;
  employeeCode: string;
  employeeName: string;
  email: string;
  country: string;
  year: number;
  leaveId: string;
  leaveType: string;
  mappedCategory: LeaveSummaryCategory | 'UNKNOWN';
  status: string;
  noOfDays: number;
  startDate: string;
  endDate: string;
  reason: string;
  createdAt: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  options: ReconciliationOptions;
  summaryRows: SummaryReportRow[];
  leaveDetails: LeaveDetailRow[];
  unknownLeaveDetails: LeaveDetailRow[];
  totals: {
    summaryRows: number;
    rowsNeedingUpdate: number;
    leaveDetails: number;
    unknownLeaveDetails: number;
    missingSummaryRows: number;
  };
}

const CATEGORIES: LeaveSummaryCategory[] = [
  'annual',
  'sick',
  'compOff',
  'lossOfPay',
  'otherPaid',
  'otherUnpaid',
  'maternity',
  'workFromHome',
  'restricted_holiday',
];

const LEAVE_RECONCILIATION_CATEGORIES = CATEGORIES.filter(
  (category) => category !== 'workFromHome',
);

function parseArgs(argv: string[]): ReconciliationOptions {
  const options: ReconciliationOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--year=')) {
      options.year = Number(arg.slice('--year='.length));
    } else if (arg.startsWith('--userId=')) {
      options.userId = arg.slice('--userId='.length);
    } else if (arg.startsWith('--outDir=')) {
      options.outDir = arg.slice('--outDir='.length);
    } else if (arg === '--all-years') {
      options.allYears = true;
    }
  }

  if (!options.allYears && !options.year) {
    options.year = new Date().getFullYear();
  }

  return options;
}

export function parseReconciliationArgs(argv: string[]): ReconciliationOptions {
  return parseArgs(argv);
}

function normalizeLeaveType(leaveType: string | undefined | null): LeaveSummaryCategory | undefined {
  const normalized = String(leaveType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const compact = normalized.replace(/_/g, '');

  const mapping: Record<string, LeaveSummaryCategory> = {
    annual: 'annual',
    annual_leave: 'annual',
    annualleaves: 'annual',
    annualleave: 'annual',
    sick: 'sick',
    sick_leave: 'sick',
    sickleaves: 'sick',
    sickleave: 'sick',
    compoff: 'compOff',
    comp_off: 'compOff',
    compensatory_off: 'compOff',
    compensatoryoff: 'compOff',
    loss_of_pay: 'lossOfPay',
    lossofpay: 'lossOfPay',
    lop: 'lossOfPay',
    other_paid: 'otherPaid',
    otherpaid: 'otherPaid',
    other_unpaid: 'otherUnpaid',
    otherunpaid: 'otherUnpaid',
    maternity: 'maternity',
    maternity_leave: 'maternity',
    maternityleave: 'maternity',
    work_from_home: 'workFromHome',
    workfromhome: 'workFromHome',
    wfh: 'workFromHome',
    restricted_holiday: 'restricted_holiday',
    restrictedholiday: 'restricted_holiday',
    optional_holiday: 'restricted_holiday',
    optionalholiday: 'restricted_holiday',
  };

  return mapping[normalized] || mapping[compact];
}

function getYear(date: Date): number {
  return new Date(date).getFullYear();
}

function toDateOnly(value: Date | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function toIso(value: Date | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString();
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundDays(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function diffIds(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((id) => !rightSet.has(id)).sort();
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath: string, rows: Record<string, unknown>[]): void {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const body = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');

  fs.writeFileSync(filePath, `${body}\n`, 'utf8');
}

function buildSimpleReportRows(summaryRows: SummaryReportRow[]): Record<string, unknown>[] {
  return summaryRows
    .filter((row) => row.approvedDays > 0 || row.pendingDays > 0 || row.currentAvailed > 0 || row.needsUpdate)
    .map((row) => ({
      employee: row.employeeName,
      code: row.employeeCode,
      email: row.email,
      year: row.year,
      leaveType: row.category,
      allottedInDb: row.alloted,
      approvedLeaveTaken: row.approvedDays,
      pendingLeaveNow: row.pendingDays,
      currentAvailedInDb: row.currentAvailed,
      correctAvailedShouldBe: row.calculatedAvailed,
      availedDifference: row.availedDiff,
      currentRemainingInDb: row.currentRemaining,
      correctRemainingShouldBe: row.calculatedRemaining,
      remainingDifference: row.remainingDiff,
      needsUpdate: row.needsUpdate,
    }));
}

function defaultCategory() {
  return { alloted: 0, availed: 0, remaining: 0, leaveRequests: [] };
}

export function getDefaultLeaveSummaryDocument(userId: Types.ObjectId, year: number) {
  return {
    userId,
    year,
    annual: defaultCategory(),
    sick: defaultCategory(),
    compOff: defaultCategory(),
    lossOfPay: defaultCategory(),
    otherPaid: defaultCategory(),
    otherUnpaid: defaultCategory(),
    maternity: defaultCategory(),
    workFromHome: defaultCategory(),
    restricted_holiday: defaultCategory(),
    editHistory: [],
  };
}

async function connect(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
  }
}

export async function disconnect(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function buildReconciliationReport(
  options: ReconciliationOptions,
): Promise<ReconciliationReport> {
  await connect();

  const leaveQuery: Record<string, unknown> = {
    status: { $in: ['Pending', 'Approved'] },
  };
  const summaryQuery: Record<string, unknown> = {};
  const carryForwardQuery: Record<string, unknown> = {};

  if (options.userId) {
    const objectId = new Types.ObjectId(options.userId);
    leaveQuery.userId = objectId;
    summaryQuery.userId = objectId;
    carryForwardQuery.employeeId = objectId;
  }

  if (!options.allYears && options.year) {
    const start = new Date(options.year, 0, 1);
    const end = new Date(options.year, 11, 31, 23, 59, 59, 999);
    leaveQuery.startDate = { $gte: start, $lte: end };
    summaryQuery.year = options.year;
    carryForwardQuery.fromYear = options.year;
  }

  const [leaves, summaries, carryForwards] = await Promise.all([
    Leave.find(leaveQuery).lean(),
    LeaveSummary.find(summaryQuery).lean(),
    LeaveCarryForward.find(carryForwardQuery).lean(),
  ]);

  const userIds = new Set<string>();
  for (const leave of leaves) userIds.add(String(leave.userId));
  for (const summary of summaries) userIds.add(String(summary.userId));
  for (const carryForward of carryForwards) userIds.add(String(carryForward.employeeId));

  const users = await User.find({ _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) } })
    .select('name email employeeCode country')
    .lean();
  const userMap = new Map(users.map((user: any) => [String(user._id), user]));

  const summaryMap = new Map<string, any>();
  for (const summary of summaries) {
    const userId = String(summary.userId);
    summaryMap.set(`${userId}:${summary.year}`, summary);
  }

  const carryForwardOut = new Map<string, number>();
  for (const carryForward of carryForwards) {
    const category = normalizeLeaveType(carryForward.leaveType);
    if (!category) continue;

    const key = `${carryForward.employeeId}:${carryForward.fromYear}:${category}`;
    carryForwardOut.set(
      key,
      roundDays((carryForwardOut.get(key) || 0) + numberValue(carryForward.daysCarriedForward)),
    );
  }

  const calculated = new Map<string, {
    userId: string;
    year: number;
    category: LeaveSummaryCategory;
    availed: number;
    leaveRequestIds: string[];
    pendingDays: number;
    approvedDays: number;
    pendingCount: number;
    approvedCount: number;
  }>();

  const leaveDetails: LeaveDetailRow[] = [];
  const unknownLeaveDetails: LeaveDetailRow[] = [];

  for (const leave of leaves) {
    const userId = String(leave.userId);
    const year = getYear(leave.startDate);
    const mappedCategory = normalizeLeaveType(leave.leaveType);
    const user: any = userMap.get(userId) || {};
    const detail: LeaveDetailRow = {
      userId,
      employeeCode: user.employeeCode || '',
      employeeName: user.name || '',
      email: user.email || '',
      country: user.country || '',
      year,
      leaveId: String(leave._id),
      leaveType: leave.leaveType || '',
      mappedCategory: mappedCategory || 'UNKNOWN',
      status: leave.status || '',
      noOfDays: numberValue(leave.noOfDays),
      startDate: toDateOnly(leave.startDate),
      endDate: toDateOnly(leave.endDate),
      reason: leave.reason || '',
      createdAt: toIso((leave as any).createdAt),
    };

    if (!mappedCategory) {
      unknownLeaveDetails.push(detail);
      continue;
    }

    if (!LEAVE_RECONCILIATION_CATEGORIES.includes(mappedCategory)) {
      continue;
    }

    leaveDetails.push(detail);

    const key = `${userId}:${year}:${mappedCategory}`;
    const existing = calculated.get(key) || {
      userId,
      year,
      category: mappedCategory,
      availed: 0,
      leaveRequestIds: [],
      pendingDays: 0,
      approvedDays: 0,
      pendingCount: 0,
      approvedCount: 0,
    };

    existing.availed = roundDays(existing.availed + detail.noOfDays);
    existing.leaveRequestIds.push(detail.leaveId);

    if (leave.status === 'Pending') {
      existing.pendingDays = roundDays(existing.pendingDays + detail.noOfDays);
      existing.pendingCount += 1;
    } else if (leave.status === 'Approved') {
      existing.approvedDays = roundDays(existing.approvedDays + detail.noOfDays);
      existing.approvedCount += 1;
    }

    calculated.set(key, existing);
  }

  const reportKeys = new Set<string>();
  for (const summary of summaries) {
    for (const category of LEAVE_RECONCILIATION_CATEGORIES) {
      reportKeys.add(`${summary.userId}:${summary.year}:${category}`);
    }
  }
  for (const key of calculated.keys()) {
    reportKeys.add(key);
  }

  const summaryRows: SummaryReportRow[] = [];
  for (const key of [...reportKeys].sort()) {
    const [userId, yearText, category] = key.split(':') as [string, string, LeaveSummaryCategory];
    const year = Number(yearText);
    const summary = summaryMap.get(`${userId}:${year}`);
    const summaryCategory = summary ? summary[category] : undefined;
    const calculatedCategory = calculated.get(key);
    const currentLeaveRequestIds = (summaryCategory?.leaveRequests || []).map((id: unknown) => String(id));
    const calculatedLeaveRequestIds = calculatedCategory?.leaveRequestIds || [];
    const carriedForward = carryForwardOut.get(key) || 0;
    const alloted = numberValue(summaryCategory?.alloted);
    const currentAvailed = numberValue(summaryCategory?.availed);
    const calculatedAvailed = roundDays(calculatedCategory?.availed || 0);
    const currentRemaining = numberValue(summaryCategory?.remaining);
    const calculatedRemaining = Math.max(0, roundDays(alloted - calculatedAvailed - carriedForward));
    const leaveRequestIdsMatch = sameIds(currentLeaveRequestIds, calculatedLeaveRequestIds);
    const user: any = userMap.get(userId) || {};
    const availedDiff = roundDays(calculatedAvailed - currentAvailed);
    const remainingDiff = roundDays(calculatedRemaining - currentRemaining);
    const needsUpdate = !summary || Math.abs(availedDiff) > 0.001 || Math.abs(remainingDiff) > 0.001 || !leaveRequestIdsMatch;

    summaryRows.push({
      userId,
      employeeCode: user.employeeCode || '',
      employeeName: user.name || '',
      email: user.email || '',
      country: user.country || '',
      year,
      category,
      summaryExists: Boolean(summary),
      alloted,
      currentAvailed,
      calculatedAvailed,
      availedDiff,
      currentRemaining,
      calculatedRemaining,
      remainingDiff,
      carriedForwardOut: carriedForward,
      currentLeaveRequestCount: currentLeaveRequestIds.length,
      calculatedLeaveRequestCount: calculatedLeaveRequestIds.length,
      leaveRequestIdsMatch,
      missingLeaveRequestIds: diffIds(calculatedLeaveRequestIds, currentLeaveRequestIds).join('|'),
      extraLeaveRequestIds: diffIds(currentLeaveRequestIds, calculatedLeaveRequestIds).join('|'),
      pendingDays: calculatedCategory?.pendingDays || 0,
      approvedDays: calculatedCategory?.approvedDays || 0,
      pendingCount: calculatedCategory?.pendingCount || 0,
      approvedCount: calculatedCategory?.approvedCount || 0,
      needsUpdate,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    options,
    summaryRows,
    leaveDetails,
    unknownLeaveDetails,
    totals: {
      summaryRows: summaryRows.length,
      rowsNeedingUpdate: summaryRows.filter((row) => row.needsUpdate).length,
      leaveDetails: leaveDetails.length,
      unknownLeaveDetails: unknownLeaveDetails.length,
      missingSummaryRows: summaryRows.filter((row) => !row.summaryExists).length,
    },
  };
}

export function writeReconciliationReport(
  report: ReconciliationReport,
  outDir = 'leave-summary-reconciliation-reports',
): { directory: string; simpleCsv: string; summaryCsv: string; detailCsv: string; unknownCsv: string; json: string } {
  const resolvedDir = path.resolve(process.cwd(), outDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `leave-summary-reconciliation-${stamp}`;
  const simpleCsv = path.join(resolvedDir, `${prefix}-simple.csv`);
  const summaryCsv = path.join(resolvedDir, `${prefix}-summary.csv`);
  const detailCsv = path.join(resolvedDir, `${prefix}-leave-details.csv`);
  const unknownCsv = path.join(resolvedDir, `${prefix}-unknown-leave-types.csv`);
  const json = path.join(resolvedDir, `${prefix}.json`);

  writeCsv(simpleCsv, buildSimpleReportRows(report.summaryRows));
  writeCsv(summaryCsv, report.summaryRows as unknown as Record<string, unknown>[]);
  writeCsv(detailCsv, report.leaveDetails as unknown as Record<string, unknown>[]);
  writeCsv(unknownCsv, report.unknownLeaveDetails as unknown as Record<string, unknown>[]);
  fs.writeFileSync(json, JSON.stringify(report, null, 2), 'utf8');

  return { directory: resolvedDir, simpleCsv, summaryCsv, detailCsv, unknownCsv, json };
}

export async function applyReconciliationReport(report: ReconciliationReport): Promise<{
  attempted: number;
  updated: number;
  skipped: number;
}> {
  await connect();

  const rowsToUpdate = report.summaryRows.filter((row) => row.needsUpdate);
  let updated = 0;

  for (const row of rowsToUpdate) {
    const userId = new Types.ObjectId(row.userId);
    const leaveIds = row.missingLeaveRequestIds || row.extraLeaveRequestIds
      ? report.leaveDetails
        .filter((leave) => leave.userId === row.userId && leave.year === row.year && leave.mappedCategory === row.category)
        .map((leave) => new Types.ObjectId(leave.leaveId))
      : undefined;

    const setData: Record<string, unknown> = {
      [`${row.category}.availed`]: row.calculatedAvailed,
      [`${row.category}.remaining`]: row.calculatedRemaining,
    };

    if (leaveIds) {
      setData[`${row.category}.leaveRequests`] = leaveIds;
    }

    const existingSummary = await LeaveSummary.exists({ userId, year: row.year });
    if (!existingSummary) {
      await LeaveSummary.create(getDefaultLeaveSummaryDocument(userId, row.year));
    }

    const result = await LeaveSummary.updateOne(
      { userId, year: row.year },
      { $set: setData },
    );

    if (result.modifiedCount > 0 || result.upsertedCount > 0) {
      updated += 1;
    }
  }

  return {
    attempted: rowsToUpdate.length,
    updated,
    skipped: report.summaryRows.length - rowsToUpdate.length,
  };
}
