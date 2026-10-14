import 'dotenv/config';
import argon2 from 'argon2';
import dns from 'node:dns';
import mongoose from 'mongoose';
import { LOV } from '../src/models/lov.model';
import { TaxDeclaration } from '../src/models/tax-declaration';
import { User } from '../src/models/user.model';
import {
    getForm12BBJoiningDateQuery,
    isForm12BBJoiningDateEligible,
} from '../src/utilis/form12bb-eligibility';

const MARKER = 'FORM12BB_NONELIGIBLE_FY2026_20260918';
const EMPLOYEE_CODE = 'F12NE2027';
const EMAIL = 'form12bb.noneligible.fy2026@loadtest.invalid';
const FINANCIAL_YEAR = '2026-2027';
const JOINING_DATE = new Date('2027-04-01T06:30:00.000Z');
const CONFIRMATION = `--confirm=${MARKER}`;

async function connect(): Promise<void> {
    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri) throw new Error('MONGODB_URI is required');
    if (!process.argv.includes(CONFIRMATION)) {
        throw new Error(`This command requires the exact confirmation argument: ${CONFIRMATION}`);
    }
    // Some local Windows networks expose an IPv6 DNS resolver that refuses SRV
    // lookups even while the already-running API remains connected to Atlas.
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    await mongoose.connect(uri);
}

async function seed(): Promise<void> {
    const departmentLov = await LOV.findOne({
        type: 'department',
        values: { $elemMatch: { isActive: true } },
    }).lean();
    const department = departmentLov?.values.find((value) => value.isActive !== false);
    if (!department) throw new Error('No active department exists for the test employee');

    const reviewer = await User.findOne({ role: 'admin', active: true }).select('_id').lean();
    if (!reviewer) throw new Error('No active administrator exists for declaration review metadata');

    const collision = await User.findOne({
        $or: [{ employeeCode: EMPLOYEE_CODE }, { email: EMAIL }],
        costCenter: { $ne: MARKER },
    }).select('employeeCode email costCenter').lean();
    if (collision) throw new Error('The test employee code or email is already used by a non-test record');

    let employee = await User.findOne({ employeeCode: EMPLOYEE_CODE, costCenter: MARKER });
    let created = false;
    if (!employee) {
        const password = await argon2.hash(`disabled-${MARKER}`);
        const inserted = await User.collection.insertOne({
            name: 'Form12BB Non Eligible FY 2026-2027',
            email: EMAIL,
            password,
            role: 'staff',
            specificRole: 'Form 12BB Eligibility Test',
            departmentId: department.value,
            costCenter: MARKER,
            employeeCode: EMPLOYEE_CODE,
            active: true,
            joiningDate: JOINING_DATE,
            confirmationDate: JOINING_DATE,
            probationDate: '2027-04-01',
            location: 'Chennai',
            address: 'Form 12BB eligibility test record, Chennai',
            fatherName: 'Test Parent',
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
                    number: 'TSTNE2027X',
                    country: 'IN',
                    verificationStatus: 'Verified',
                },
            },
            currentShiftAssignmentData: null,
            upcomingShiftAssignmentData: null,
            bankDetails: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        employee = await User.findById(inserted.insertedId);
        created = true;
    }
    if (!employee) throw new Error('Failed to create or load the test employee');

    const now = new Date();
    const lifeInsurance = 50_000;
    await TaxDeclaration.findOneAndUpdate(
        { employeeId: employee._id, financialYear: FINANCIAL_YEAR },
        {
            $set: {
                regime: 'old',
                declarations: [{
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
                    reviewHistory: [{
                        reviewedBy: reviewer._id,
                        reviewDate: now,
                        status: 'verified',
                        comments: `Verified eligibility test data (${MARKER})`,
                    }],
                    lastUpdated: now,
                    resubmissionInfo: {
                        isResubmitted: false,
                        previouslyRejected: false,
                        resubmissionAllowed: false,
                        rejectionCount: 0,
                    },
                }],
                annualGross: 600_000,
                cessRate: 4,
                totalDeclaredAmount: lifeInsurance,
                totalVerifiedAmount: lifeInsurance,
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
                    taxableIncome: 500_000,
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
            },
            $setOnInsert: { employeeId: employee._id, financialYear: FINANCIAL_YEAR },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    const [candidateQueryMatches, declarationExists] = await Promise.all([
        User.countDocuments({
            _id: employee._id,
            joiningDate: getForm12BBJoiningDateQuery(FINANCIAL_YEAR),
        }),
        TaxDeclaration.exists({ employeeId: employee._id, financialYear: FINANCIAL_YEAR }),
    ]);

    console.log(JSON.stringify({
        action: 'seed',
        database: mongoose.connection.db.databaseName,
        marker: MARKER,
        created,
        employeeId: employee._id.toString(),
        employeeCode: EMPLOYEE_CODE,
        email: EMAIL,
        financialYear: FINANCIAL_YEAR,
        joiningDate: JOINING_DATE.toISOString().slice(0, 10),
        eligibilityCheck: isForm12BBJoiningDateEligible(employee.joiningDate, FINANCIAL_YEAR)
            ? 'Eligible'
            : 'Not eligible',
        candidateQueryMatches,
        declarationExists: Boolean(declarationExists),
        cleanupCommand: `npx ts-node scripts/form12bb-noneligible-test-data.ts delete ${CONFIRMATION}`,
    }, null, 2));
}

async function cleanup(): Promise<void> {
    const employee = await User.findOne({ employeeCode: EMPLOYEE_CODE, costCenter: MARKER }).select('_id').lean();
    if (!employee) {
        console.log(JSON.stringify({ action: 'delete', marker: MARKER, employeesDeleted: 0 }, null, 2));
        return;
    }
    const declaration = await TaxDeclaration.deleteMany({ employeeId: employee._id, financialYear: FINANCIAL_YEAR });
    const user = await User.deleteOne({ _id: employee._id, employeeCode: EMPLOYEE_CODE, costCenter: MARKER });
    console.log(JSON.stringify({
        action: 'delete',
        database: mongoose.connection.db.databaseName,
        marker: MARKER,
        employeesDeleted: user.deletedCount,
        declarationsDeleted: declaration.deletedCount,
    }, null, 2));
}

async function run(): Promise<void> {
    const action = process.argv[2] || 'seed';
    if (!['seed', 'delete'].includes(action)) throw new Error('Action must be seed or delete');
    await connect();
    if (action === 'seed') await seed();
    else await cleanup();
}

run()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
