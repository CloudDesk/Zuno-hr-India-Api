import 'dotenv/config';
import mongoose from 'mongoose';
import { config } from '../src/config';
import { LOV } from '../src/models/lov.model';
import { User } from '../src/models/user.model';
import { SalaryStructure } from '../src/models/salary-structure.model';
import { SalaryAssignment } from '../src/models/salary-assignments.model';
import { TaxDeclaration } from '../src/models/tax-declaration';
import { POIReportService } from '../src/services/poi-report.service';

const REJECTED_SCENARIO = process.argv.includes('--rejected');
const EMPLOYEE_CODE = REJECTED_SCENARIO ? 'POIREJ001' : 'POITEST001';
const EMPLOYEE_EMAIL = REJECTED_SCENARIO
  ? 'poi.rejected.test@zunohr.test'
  : 'poi.report.test@zunohr.test';
const EMPLOYEE_NAME = REJECTED_SCENARIO
  ? 'POI Rejected Test Employee'
  : 'POI Test Employee';
const INITIAL_PASSWORD = '123456';
const FINANCIAL_YEAR = '2026-2027';
const MONTHLY_GROSS = 100_000;

const connectToConfiguredDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongoUri);
  } catch (error) {
    const configuredUrl = new URL(config.mongoUri);
    const isSrvResolutionFailure = configuredUrl.protocol === 'mongodb+srv:'
      && String((error as NodeJS.ErrnoException)?.message || '').includes('querySrv');
    if (!isSrvResolutionFailure) throw error;

    // Windows/c-ares can occasionally reject Atlas SRV lookups even when the
    // individual hosts resolve. Preserve the configured credentials/database
    // and retry against the three Atlas replica-set members directly.
    const [clusterName, ...domainParts] = configuredUrl.hostname.split('.');
    const shardDomain = domainParts.join('.');
    const hosts = [0, 1, 2]
      .map((index) => `${clusterName}-shard-00-0${index}.${shardDomain}:27017`)
      .join(',');
    configuredUrl.searchParams.set('tls', 'true');
    configuredUrl.searchParams.set('authSource', 'admin');
    configuredUrl.searchParams.set('replicaSet', 'atlas-hly0od-shard-0');
    const directUri = `mongodb://${configuredUrl.username}:${configuredUrl.password}@${hosts}${configuredUrl.pathname}?${configuredUrl.searchParams.toString()}`;
    await mongoose.connect(directUri);
  }
};

const run = async (): Promise<void> => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured. Refusing to use the fallback database.');
  }

  await connectToConfiguredDatabase();

  const departmentLov = await LOV.findOne({
    type: 'department',
    values: { $elemMatch: { isActive: true } },
  }).lean();
  const department = departmentLov?.values.find((value) => value.isActive !== false);
  if (!department) throw new Error('No active department is available for the test employee.');

  const salaryStructure = await SalaryStructure.findOne({ country: 'IN' })
    .sort({ updatedAt: -1 })
    .lean();
  if (!salaryStructure) throw new Error('No India salary structure is available.');

  let employee = await User.findOne({ employeeCode: EMPLOYEE_CODE });
  const wasCreated = !employee;
  if (!employee) {
    employee = new User({
      name: EMPLOYEE_NAME,
      email: EMPLOYEE_EMAIL,
      password: INITIAL_PASSWORD,
      role: 'staff',
      specificRole: 'QA Test Employee',
      departmentId: department.value,
      costCenter: 'TEST-POI',
      employeeCode: EMPLOYEE_CODE,
      active: true,
      joiningDate: new Date('2026-04-01T00:00:00.000Z'),
      confirmationDate: new Date('2026-04-01T00:00:00.000Z'),
      probationDate: '2026-04-01',
      location: 'Chennai',
      address: 'Chennai, Tamil Nadu',
      employmentStatus: 'Active',
      noticePeriod: 30,
      country: 'IN',
      currency: 'INR',
      licenseType: 'employee',
      portalAccess: true,
      isConsultancy: false,
      isIntern: false,
      governmentIds: {
        pan: {
          number: REJECTED_SCENARIO ? 'ABCDE5678R' : 'ABCDE1234F',
          country: 'IN',
          verificationStatus: 'Verified',
        },
      },
    });
  } else {
    employee.set({
      name: EMPLOYEE_NAME,
      email: EMPLOYEE_EMAIL,
      // These are disposable QA accounts. Keep their documented credentials
      // deterministic whenever the idempotent seed is rerun.
      password: INITIAL_PASSWORD,
      role: 'staff',
      specificRole: 'QA Test Employee',
      departmentId: department.value,
      costCenter: 'TEST-POI',
      active: true,
      employmentStatus: 'Active',
      noticePeriod: 30,
      country: 'IN',
      currency: 'INR',
      licenseType: 'employee',
      portalAccess: true,
      isConsultancy: false,
      isIntern: false,
    });
  }
  await employee.save();

  await SalaryAssignment.updateMany(
    { employeeId: employee._id, isActive: true },
    { $set: { isActive: false } },
  );

  let salaryAssignment = await SalaryAssignment.findOne({
    employeeId: employee._id,
    salaryStructureId: salaryStructure._id,
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
  });
  if (!salaryAssignment) {
    salaryAssignment = new SalaryAssignment({
      employeeId: employee._id,
      salaryStructureId: salaryStructure._id,
    });
  }
  salaryAssignment.set({
    monthlyGross: MONTHLY_GROSS,
    reimbursement: 0,
    annualInsurance: 0,
    isActive: true,
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    effectiveTo: new Date('2027-03-31T23:59:59.999Z'),
    updateType: 'POI test data',
    comments: 'Reusable salary assignment for POI report testing',
  });
  await salaryAssignment.save();

  const reviewer = await User.findOne({ role: 'admin', active: true }).select('_id').lean();
  const reviewedBy = reviewer?._id || employee._id;
  const now = new Date();
  const proof = (name: string) => [{
    documentName: `${name}.pdf`,
    documentPath: `test-fixtures/poi/${EMPLOYEE_CODE}/${FINANCIAL_YEAR}/${name}.pdf`,
    uploadDate: now,
    isLatestVersion: true,
    documentType: 'application/pdf',
  }];
  const approvalHistory = [{
    reviewedBy,
    reviewDate: now,
    status: 'verified',
    comments: 'Approved for POI test data',
  }];
  const rejectedHistory = [{
    reviewedBy,
    reviewDate: now,
    status: 'rejected',
    comments: 'Rejected proof for POI non-eligible test data',
  }];
  const resubmissionInfo = {
    isResubmitted: false,
    previouslyRejected: false,
    resubmissionAllowed: false,
    rejectionCount: 0,
  };

  const declaration = await TaxDeclaration.findOneAndUpdate(
    { employeeId: employee._id, financialYear: FINANCIAL_YEAR },
    {
      $set: {
        regime: 'old',
        declarations: [
          {
            section: '80C',
            subSection: 'life_insurance',
            maxLimit: 150_000,
            limitType: 'fixed',
            limitPercentage: 0,
            description: 'Life Insurance Premium',
            declaredAmount: 50_000,
            verifiedAmount: 50_000,
            status: 'verified',
            documents: proof('life-insurance-proof'),
            reviewHistory: approvalHistory,
            lastUpdated: now,
            resubmissionInfo,
          },
          {
            section: '80D',
            subSection: 'self_family',
            maxLimit: 25_000,
            limitType: 'fixed',
            limitPercentage: 0,
            description: 'Health Insurance for Self and Family',
            declaredAmount: 25_000,
            verifiedAmount: REJECTED_SCENARIO ? 0 : 25_000,
            status: REJECTED_SCENARIO ? 'rejected' : 'verified',
            documents: proof('health-insurance-proof'),
            reviewHistory: REJECTED_SCENARIO ? rejectedHistory : approvalHistory,
            lastUpdated: now,
            resubmissionInfo: REJECTED_SCENARIO
              ? {
                isResubmitted: false,
                previouslyRejected: true,
                resubmissionAllowed: true,
                rejectionCount: 1,
              }
              : resubmissionInfo,
          },
        ],
        annualGross: MONTHLY_GROSS * 12,
        cessRate: 4,
        totalDeclaredAmount: 75_000,
        totalVerifiedAmount: REJECTED_SCENARIO ? 50_000 : 75_000,
        totalDeclinedAmount: REJECTED_SCENARIO ? 25_000 : 0,
        standardDeduction: 50_000,
        ptDeduction: 0,
        poiSubmissionStatus: REJECTED_SCENARIO ? 'rejected' : 'verified',
        isDeclared: true,
        isPOISubmitted: true,
        isSubmissionsEnabled: true,
        isLocked: false,
        isResubmitted: false,
        salaryAssignments: [{
          assignmentId: salaryAssignment._id,
          validFrom: salaryAssignment.effectiveFrom,
          validTill: salaryAssignment.effectiveTo,
          monthlyGross: salaryAssignment.monthlyGross,
          isActive: true,
        }],
      },
      $setOnInsert: { employeeId: employee._id, financialYear: FINANCIAL_YEAR },
    },
    { new: true, upsert: true, runValidators: true },
  );

  const eligibility = new POIReportService({} as any).evaluateEligibility(declaration);
  if (!REJECTED_SCENARIO && !eligibility.eligible) {
    throw new Error(`Test employee was created but is not POI eligible: ${eligibility.status} - ${eligibility.reasons.join('; ')}`);
  }
  if (REJECTED_SCENARIO && (eligibility.eligible || eligibility.status !== 'Rejected')) {
    throw new Error(`Rejected test employee has an unexpected eligibility result: ${eligibility.status}`);
  }

  console.log(JSON.stringify({
    employeeId: employee._id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email,
    password: INITIAL_PASSWORD,
    department: department.label,
    salaryStructure: salaryStructure.name,
    monthlyGross: salaryAssignment.monthlyGross,
    annualGross: declaration.annualGross,
    financialYear: declaration.financialYear,
    declarationAmounts: declaration.declarations.map((item) => ({
      section: item.section,
      description: item.description,
      declaredAmount: item.declaredAmount,
      approvedAmount: item.verifiedAmount,
      status: item.status,
    })),
    poiSubmissionStatus: declaration.poiSubmissionStatus,
    isPOISubmitted: declaration.isPOISubmitted,
    isSubmissionsEnabled: declaration.isSubmissionsEnabled,
    eligibility,
    created: wasCreated,
  }, null, 2));
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
