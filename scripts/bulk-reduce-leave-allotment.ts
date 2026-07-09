import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { LeaveSummary } from '../src/models/leave-summary.model';
import { User } from '../src/models/user.model';
import dns from "node:dns";
 
dns.setServers(["1.1.1.1", "8.8.8.8"]);
dotenv.config();
console.log(process.env.MONGODB_URI);
type LeaveCategory =
  | 'annual'
  | 'sick'
  | 'compOff'
  | 'lossOfPay'
  | 'otherPaid'
  | 'otherUnpaid'
  | 'maternity'
  | 'restricted_holiday';

const VALID_CATEGORIES: LeaveCategory[] = [
  'annual',
  'sick',
  'compOff',
  'lossOfPay',
  'otherPaid',
  'otherUnpaid',
  'maternity',
  'restricted_holiday',
];

interface Options {
  year: number;
  leaveType: LeaveCategory;
  days: number;
  confirm: boolean;
  outDir: string;
  userId?: string;
  employeeCode?: string;
}

interface ReportRow {
  'Employee Name': string;
  'Employee Code': string;
  'Email': string;
  'Country': string;
  'Year': number;
  'Leave Type': LeaveCategory;
  'Current Allotted in DB': number;
  'Reduction Days': number;
  'New Allotted Should Be': number;
  'Actual Reduction': number;
  'Current Availed in DB': number;
  'Current Remaining in DB': number;
  'New Remaining Should Be': number;
  'Action': string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    year: new Date().getFullYear(),
    leaveType: 'annual',
    days: 4.5,
    confirm: false,
    outDir: 'leave-summary-reconciliation-reports',
  };

  for (const arg of argv) {
    if (arg.startsWith('--year=')) {
      options.year = Number(arg.slice('--year='.length));
    } else if (arg.startsWith('--leaveType=')) {
      options.leaveType = arg.slice('--leaveType='.length) as LeaveCategory;
    } else if (arg.startsWith('--days=')) {
      options.days = Number(arg.slice('--days='.length));
    } else if (arg.startsWith('--outDir=')) {
      options.outDir = arg.slice('--outDir='.length);
    } else if (arg.startsWith('--userId=')) {
      options.userId = arg.slice('--userId='.length);
    } else if (arg.startsWith('--employeeCode=')) {
      options.employeeCode = arg.slice('--employeeCode='.length);
    } else if (arg === '--confirm') {
      options.confirm = true;
    }
  }

  if (!Number.isFinite(options.year)) {
    throw new Error('--year must be a valid number');
  }
  if (!Number.isFinite(options.days) || options.days <= 0) {
    throw new Error('--days must be greater than 0');
  }
  if (!VALID_CATEGORIES.includes(options.leaveType)) {
    throw new Error(`--leaveType must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (options.userId && !mongoose.Types.ObjectId.isValid(options.userId)) {
    throw new Error('--userId must be a valid MongoDB ObjectId');
  }
  if (options.userId && options.employeeCode) {
    throw new Error('Use either --userId or --employeeCode, not both');
  }

  return options;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundDays(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath: string, rows: ReportRow[]): void {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [
    'Employee Name',
    'Employee Code',
    'Email',
    'Country',
    'Year',
    'Leave Type',
    'Current Allotted in DB',
    'Reduction Days',
    'New Allotted Should Be',
    'Actual Reduction',
    'Current Availed in DB',
    'Current Remaining in DB',
    'New Remaining Should Be',
    'Action',
  ];

  const body = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape((row as any)[header])).join(',')),
  ].join('\n');

  fs.writeFileSync(filePath, `${body}\n`, 'utf8');
}

async function connect(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  console.log(mongoUri ,'MOngodb');
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await connect();

  const summaryQuery: Record<string, unknown> = { year: options.year };
  if (options.userId) {
    summaryQuery.userId = new mongoose.Types.ObjectId(options.userId);
  } else if (options.employeeCode) {
    const user = await User.findOne({ employeeCode: options.employeeCode })
      .select('_id name email employeeCode')
      .lean();
    if (!user) {
      throw new Error(`No employee found with employeeCode: ${options.employeeCode}`);
    }
    summaryQuery.userId = user._id;
  }

  const summaries = await LeaveSummary.find(summaryQuery).lean();
  const userIds = summaries.map((summary) => summary.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name email employeeCode country')
    .lean();
  const userMap = new Map(users.map((user: any) => [String(user._id), user]));

  const rows: ReportRow[] = summaries.map((summary: any) => {
    const category = summary[options.leaveType] || {};
    const currentAllotted = numberValue(category.alloted);
    const currentAvailed = numberValue(category.availed);
    const currentRemaining = numberValue(category.remaining);
    const newAllotted = roundDays(Math.max(0, currentAllotted - options.days));
    const actualReduction = roundDays(currentAllotted - newAllotted);
    const newRemaining = roundDays(Math.max(0, newAllotted - currentAvailed));
    const user: any = userMap.get(String(summary.userId)) || {};

    let action = 'Will update';
    if (actualReduction === 0) {
      action = 'No change';
    } else if (actualReduction < options.days) {
      action = 'Will update, clamped to zero';
    }

    return {
      'Employee Name': user.name || '',
      'Employee Code': user.employeeCode || '',
      'Email': user.email || '',
      'Country': user.country || '',
      'Year': options.year,
      'Leave Type': options.leaveType,
      'Current Allotted in DB': currentAllotted,
      'Reduction Days': options.days,
      'New Allotted Should Be': newAllotted,
      'Actual Reduction': actualReduction,
      'Current Availed in DB': currentAvailed,
      'Current Remaining in DB': currentRemaining,
      'New Remaining Should Be': newRemaining,
      'Action': action,
    };
  });

  const outputDir = path.resolve(process.cwd(), options.outDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(
    outputDir,
    `bulk-reduce-${options.leaveType}-allotment-${options.year}-${stamp}.csv`,
  );

  writeCsv(reportPath, rows);

  console.log('Bulk leave allotment reduction report generated.');
  console.log(`Year: ${options.year}`);
  console.log(`Leave Type: ${options.leaveType}`);
  console.log(`Reduction Days: ${options.days}`);
  if (options.userId) {
    console.log(`User ID: ${options.userId}`);
  }
  if (options.employeeCode) {
    console.log(`Employee Code: ${options.employeeCode}`);
  }
  console.log(`Employees in report: ${rows.length}`);
  console.log(`Report CSV: ${reportPath}`);

  if (!options.confirm) {
    console.log('Dry run only. Review the CSV, then re-run with --confirm to update DB.');
    return;
  }

  let updated = 0;
  for (const summary of summaries as any[]) {
    const category = summary[options.leaveType] || {};
    const currentAllotted = numberValue(category.alloted);
    const currentAvailed = numberValue(category.availed);
    const newAllotted = roundDays(Math.max(0, currentAllotted - options.days));
    const newRemaining = roundDays(Math.max(0, newAllotted - currentAvailed));

    if (newAllotted === currentAllotted && newRemaining === numberValue(category.remaining)) {
      continue;
    }

    const result = await LeaveSummary.updateOne(
      { _id: summary._id },
      {
        $set: {
          [`${options.leaveType}.alloted`]: newAllotted,
          [`${options.leaveType}.remaining`]: newRemaining,
        },
      },
    );

    if (result.modifiedCount > 0) {
      updated += 1;
    }
  }

  console.log('Bulk leave allotment reduction completed.');
  console.log(`Updated summaries: ${updated}`);
}

main()
  .catch((error) => {
    console.error('Failed to process bulk leave allotment reduction:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
