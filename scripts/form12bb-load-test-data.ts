import 'dotenv/config';
import argon2 from 'argon2';
import mongoose, { Types } from 'mongoose';
import { Document } from '../src/models/document.model';
import { Form12BBJob } from '../src/models/form12bb-job.model';
import { Form12BBJobItem } from '../src/models/form12bb-job-item.model';
import { LOV } from '../src/models/lov.model';
import { TaxDeclaration } from '../src/models/tax-declaration';
import { User } from '../src/models/user.model';
import { deleteFileFromGCP } from '../src/utilis/gcpStorage';

const BATCH_MARKER = 'FORM12BB_LOAD_500_20260918';
const EMPLOYEE_CODE_PREFIX = 'F12L26';
const RECORD_COUNT = 500;
const FINANCIAL_YEAR = '2026-2027';
const DELETE_CONFIRMATION = `--confirm-delete=${BATCH_MARKER}`;
const TARGET_DATABASE = String(process.env.FORM12BB_LOAD_TEST_DATABASE || '').trim();
const LOCAL_MONGODB_URI = String(
    process.env.FORM12BB_LOAD_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/zuno-hr-india-dev',
).trim();

const connect = async (): Promise<void> => {
    if (!TARGET_DATABASE || !/(dev|test)/i.test(TARGET_DATABASE)) {
        throw new Error('FORM12BB_LOAD_TEST_DATABASE must name a dedicated dev or test database.');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(TARGET_DATABASE)) {
        throw new Error('FORM12BB_LOAD_TEST_DATABASE contains unsupported characters.');
    }
    const configuredUri = new URL(LOCAL_MONGODB_URI);
    if (configuredUri.protocol !== 'mongodb:') {
        throw new Error('Load-test data requires a direct local mongodb:// connection.');
    }
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (!localHosts.has(configuredUri.hostname.toLowerCase())) {
        throw new Error(`Refusing non-local MongoDB host: ${configuredUri.hostname}`);
    }
    configuredUri.pathname = `/${TARGET_DATABASE}`;
    await mongoose.connect(configuredUri.toString());
    if (mongoose.connection.db.databaseName !== TARGET_DATABASE) {
        throw new Error(`Connected to unexpected database ${mongoose.connection.db.databaseName}; refusing to continue.`);
    }
    await Promise.all([User.init(), TaxDeclaration.init()]);
};

const employeeCode = (index: number): string => `${EMPLOYEE_CODE_PREFIX}${String(index).padStart(4, '0')}`;

const buildDeclaration = (employeeId: Types.ObjectId, reviewerId: Types.ObjectId, index: number) => {
    const now = new Date();
    const annualGross = 600_000 + (index % 10) * 12_000;
    const lifeInsurance = 50_000 + (index % 5) * 5_000;
    const healthInsurance = 20_000;
    const totalVerified = lifeInsurance + healthInsurance;
    const reviewHistory = [{
        reviewedBy: reviewerId,
        reviewDate: now,
        status: 'verified',
        comments: `Verified load-test data (${BATCH_MARKER})`,
    }];
    const resubmissionInfo = {
        isResubmitted: false,
        previouslyRejected: false,
        resubmissionAllowed: false,
        rejectionCount: 0,
    };
    return {
        employeeId,
        financialYear: FINANCIAL_YEAR,
        regime: index % 2 === 0 ? 'new' : 'old',
        declarations: [
            {
                section: '80C',
                subSection: 'life_insurance',
                maxLimit: 150_000,
                limitType: 'fixed',
                limitPercentage: 0,
                description: 'Life Insurance Premium',
                declaredAmount: lifeInsurance,
                verifiedAmount: lifeInsurance,
                status: 'verified',
                documents: [],
                reviewHistory,
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
                declaredAmount: healthInsurance,
                verifiedAmount: healthInsurance,
                status: 'verified',
                documents: [],
                reviewHistory,
                lastUpdated: now,
                resubmissionInfo,
            },
        ],
        annualGross,
        cessRate: 4,
        totalDeclaredAmount: totalVerified,
        totalVerifiedAmount: totalVerified,
        totalDeclinedAmount: 0,
        standardDeduction: 50_000,
        ptDeduction: 0,
        initialTaxCalculated: true,
        calculatedTaxAmount: 0,
        revisedTaxAmount: 0,
        previousTaxAmount: 0,
        taxPaid: 0,
        remainingTaxToPay: 0,
        taxAdjustmentRequired: false,
        adjustmentAmount: 0,
        monthlyAdjustment: 0,
        remainingMonths: 0,
        adjustmentReason: 'other',
        adjustmentDistribution: 'equal',
        initialDeclarationDate: now,
        lastDeclarationDate: now,
        monthlyDeductions: [],
        noFurtherTaxDeduction: false,
        excessTaxPaid: 0,
        poiSubmissionStatus: 'verified',
        reviewHistory: [],
        isLocked: false,
        isSubmissionsEnabled: true,
        initialTaxBreakdown: {
            taxAmount: 0,
            slabwiseTax: [],
            cessAmount: 0,
            totalTaxAmount: 0,
            taxableIncome: Math.max(0, annualGross - 50_000 - totalVerified),
            rebateAmount: 0,
            isRebateApplicable: true,
            marginalReliefAmount: 0,
            isMarginalReliefApplicable: false,
            taxWithCess: 0,
            form12bTDSAmount: 0,
            finalTaxWithCess: 0,
            ptDeduction: 0,
        },
        isDeclared: true,
        isPOISubmitted: true,
        isResubmitted: false,
        salaryAssignments: [],
        isForm12BApplicable: false,
        isMigrationAdjusted: false,
        isMigrationInitialized: false,
        createdAt: now,
        updatedAt: now,
    };
};

const seed = async (): Promise<void> => {
    const departmentLov = await LOV.findOne({
        type: 'department',
        values: { $elemMatch: { isActive: true } },
    }).lean();
    const department = departmentLov?.values.find((value) => value.isActive !== false);
    if (!department) throw new Error('No active department exists for the load-test employees.');

    const reviewer = await User.findOne({ role: 'admin', active: true }).select('_id').lean();
    if (!reviewer) throw new Error('No active administrator exists for declaration review metadata.');

    const codePattern = new RegExp(`^${EMPLOYEE_CODE_PREFIX}\\d{4}$`);
    const colliding = await User.findOne({ employeeCode: codePattern, costCenter: { $ne: BATCH_MARKER } })
        .select('employeeCode costCenter')
        .lean();
    if (colliding) {
        throw new Error(`Employee-code collision detected at ${colliding.employeeCode}; no records were created.`);
    }

    const existing = await User.find({ employeeCode: codePattern, costCenter: BATCH_MARKER })
        .select('_id employeeCode')
        .lean();
    const existingCodes = new Set(existing.map((item) => item.employeeCode));
    const passwordHash = await argon2.hash(`disabled-${BATCH_MARKER}`);
    const now = new Date();
    const users = Array.from({ length: RECORD_COUNT }, (_, offset) => offset + 1)
        .filter((index) => !existingCodes.has(employeeCode(index)))
        .map((index) => ({
            name: `Form12BB Load Employee ${String(index).padStart(4, '0')}`,
            email: `form12bb.load.${String(index).padStart(4, '0')}@loadtest.invalid`,
            password: passwordHash,
            role: 'staff',
            specificRole: 'Form 12BB Load Test',
            departmentId: department.value,
            costCenter: BATCH_MARKER,
            employeeCode: employeeCode(index),
            active: true,
            joiningDate: new Date('2026-04-01T00:00:00.000Z'),
            confirmationDate: new Date('2026-04-01T00:00:00.000Z'),
            probationDate: '2026-04-01',
            location: 'Chennai',
            address: `${index}, Load Test Street, Chennai, Tamil Nadu 600001`,
            fatherName: `Load Test Parent ${index}`,
            employmentStatus: 'Active',
            noticePeriod: 30,
            country: 'IN',
            currency: 'INR',
            licenseType: 'employee',
            portalAccess: false,
            isConsultancy: false,
            isIntern: false,
            governmentIds: {
                pan: {
                    number: `TSTAA${String(index).padStart(4, '0')}L`,
                    country: 'IN',
                    verificationStatus: 'Verified',
                },
            },
            currentShiftAssignmentData: null,
            upcomingShiftAssignmentData: null,
            bankDetails: [],
            createdAt: now,
            updatedAt: now,
        }));

    for (let start = 0; start < users.length; start += 100) {
        await User.collection.insertMany(users.slice(start, start + 100), { ordered: true });
    }

    const batchUsers = await User.find({ employeeCode: codePattern, costCenter: BATCH_MARKER })
        .select('_id employeeCode')
        .sort({ employeeCode: 1 })
        .lean();
    if (batchUsers.length !== RECORD_COUNT) {
        throw new Error(`Expected ${RECORD_COUNT} marked employees but found ${batchUsers.length}.`);
    }

    const declarationOperations = batchUsers.map((employee, offset) => ({
        updateOne: {
            filter: { employeeId: employee._id, financialYear: FINANCIAL_YEAR },
            update: { $set: buildDeclaration(employee._id, reviewer._id, offset + 1) },
            upsert: true,
        },
    }));
    for (let start = 0; start < declarationOperations.length; start += 100) {
        await TaxDeclaration.collection.bulkWrite(declarationOperations.slice(start, start + 100), { ordered: true });
    }

    const declarationCount = await TaxDeclaration.countDocuments({
        employeeId: { $in: batchUsers.map((item) => item._id) },
        financialYear: FINANCIAL_YEAR,
    });
    console.log(JSON.stringify({
        action: 'seed',
        marker: BATCH_MARKER,
        database: mongoose.connection.db.databaseName,
        financialYear: FINANCIAL_YEAR,
        employeeCodeRange: `${employeeCode(1)} - ${employeeCode(RECORD_COUNT)}`,
        employees: batchUsers.length,
        declarations: declarationCount,
        createdThisRun: users.length,
        portalAccess: false,
        cleanupCommand: `npm run testdata:form12bb:delete -- ${DELETE_CONFIRMATION}`,
    }, null, 2));
};

const cleanup = async (): Promise<void> => {
    if (!process.argv.includes(DELETE_CONFIRMATION)) {
        throw new Error(`Cleanup requires the exact confirmation argument: ${DELETE_CONFIRMATION}`);
    }
    const codePattern = new RegExp(`^${EMPLOYEE_CODE_PREFIX}\\d{4}$`);
    const users = await User.find({ employeeCode: codePattern, costCenter: BATCH_MARKER })
        .select('_id employeeCode')
        .lean();
    const employeeIds = users.map((item) => item._id);
    if (!employeeIds.length) {
        console.log(JSON.stringify({ action: 'delete', marker: BATCH_MARKER, employeesDeleted: 0 }, null, 2));
        return;
    }

    const activeItems = await Form12BBJobItem.countDocuments({
        employeeId: { $in: employeeIds },
        status: { $in: ['Queued', 'Processing'] },
    });
    if (activeItems) {
        throw new Error(`Refusing cleanup: ${activeItems} load-test reports are still queued or processing.`);
    }

    const documents: any[] = await Document.find({ employeeId: { $in: employeeIds } })
        .select('filePath metadata.form12BB.previousVersions.filePath')
        .lean();
    const filePaths = new Set<string>();
    documents.forEach((document) => {
        if (document.filePath) filePaths.add(document.filePath);
        (document.metadata?.form12BB?.previousVersions || []).forEach((version: any) => {
            if (version.filePath) filePaths.add(version.filePath);
        });
    });
    const storageFailures: string[] = [];
    for (const filePath of filePaths) {
        try {
            await deleteFileFromGCP(filePath);
        } catch (error: any) {
            storageFailures.push(`${filePath}: ${String(error?.message || error).slice(0, 200)}`);
        }
    }
    if (storageFailures.length) {
        throw new Error(`Refusing database cleanup because ${storageFailures.length} storage files could not be deleted.`);
    }

    const jobItems = await Form12BBJobItem.find({ employeeId: { $in: employeeIds } }).select('jobId').lean();
    const jobIds = Array.from(new Set(jobItems.map((item) => item.jobId.toString()))).map((id) => new Types.ObjectId(id));
    const jobs: any[] = await Form12BBJob.find({ _id: { $in: jobIds } }).select('employeeIds').lean();
    const testIdSet = new Set(employeeIds.map((id) => id.toString()));
    const pureJobIds = jobs
        .filter((job) => job.employeeIds.every((id: Types.ObjectId) => testIdSet.has(id.toString())))
        .map((job) => job._id);

    const [declarationsResult, documentsResult, jobItemsResult, jobsResult, usersResult] = await Promise.all([
        TaxDeclaration.deleteMany({ employeeId: { $in: employeeIds } }),
        Document.deleteMany({ employeeId: { $in: employeeIds } }),
        Form12BBJobItem.deleteMany({ employeeId: { $in: employeeIds } }),
        Form12BBJob.deleteMany({ _id: { $in: pureJobIds } }),
        User.deleteMany({ _id: { $in: employeeIds }, employeeCode: codePattern, costCenter: BATCH_MARKER }),
    ]);

    await Form12BBJob.updateMany(
        { _id: { $in: jobIds, $nin: pureJobIds } },
        {
            $pull: {
                employeeIds: { $in: employeeIds },
                failures: { employeeId: { $in: employeeIds } },
            },
        },
    );

    console.log(JSON.stringify({
        action: 'delete',
        marker: BATCH_MARKER,
        database: mongoose.connection.db.databaseName,
        employeesDeleted: usersResult.deletedCount,
        declarationsDeleted: declarationsResult.deletedCount,
        documentsDeleted: documentsResult.deletedCount,
        jobItemsDeleted: jobItemsResult.deletedCount,
        completeJobsDeleted: jobsResult.deletedCount,
        storageFilesDeleted: filePaths.size,
    }, null, 2));
};

const run = async (): Promise<void> => {
    const action = process.argv[2] || 'seed';
    if (!['seed', 'delete'].includes(action)) throw new Error('Action must be seed or delete.');
    await connect();
    if (action === 'seed') await seed();
    else await cleanup();
};

run()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
