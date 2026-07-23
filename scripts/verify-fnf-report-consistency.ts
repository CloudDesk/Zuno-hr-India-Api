import assert from 'node:assert/strict';
import {
    buildSalaryStatementFinancials,
    getSalaryStatementPayrollType,
    mergeFinalSettlementPayrollsIntoPreview
} from '../src/services/salary-statement.service';
import {
    isPayrollRecordEligibleForPayslip,
    shouldIncludeInactiveFinalSettlementPayslips
} from '../src/services/payroll.service';
import { buildFinalSettlementPayrollReconciliation } from '../src/services/final-settlement.service';
import {
    buildPayslipGenerationOutcome,
    isEmployeeAllowedForPayslipGeneration
} from '../src/services/payslip-generation-result';

const finalSettlementPayroll = {
    status: 'Draft',
    type: 'FinalSettlement',
    isFinalSettlement: true,
    monthlyGross: 21290,
    holdSalary: 28560,
    reimbursement: 0,
    totalDeductions: 10786,
    netSalary: 48483,
    customReimbursements: [
        { name: 'LEAVE ENCASHMENT', value: 387 },
        { name: 'REIMBURSEMENTS', value: 1000 },
        { name: 'LAPTOP', value: 10000 }
    ],
    customDeductions: [
        { name: 'ADDITIONAL LOP', value: 968 },
        { name: 'ASSET', value: 1000 }
    ]
};

const settlementFinancials = buildSalaryStatementFinancials(finalSettlementPayroll);

assert.equal(settlementFinancials.periodGross, 21290);
assert.equal(settlementFinancials.totalEarnings, 61237);
assert.equal(settlementFinancials.totalDeductions, 12754);
assert.equal(settlementFinancials.netPay, 48483);
assert.equal(
    settlementFinancials.totalEarnings - settlementFinancials.totalDeductions,
    settlementFinancials.netPay
);
assert.equal(
    getSalaryStatementPayrollType(finalSettlementPayroll),
    'Final Settlement'
);
assert.equal(
    getSalaryStatementPayrollType({
        status: 'Completed',
        type: 'Regular'
    }),
    'Normal Payroll'
);
assert.equal(
    getSalaryStatementPayrollType({
        status: 'Draft'
    }),
    'Normal Payroll'
);

assert.equal(isPayrollRecordEligibleForPayslip(finalSettlementPayroll), true);
assert.equal(
    isPayrollRecordEligibleForPayslip({ status: 'Draft', isFinalSettlement: true }),
    true
);
assert.equal(
    isPayrollRecordEligibleForPayslip({ status: 'Draft', type: 'FinalSettlement' }),
    true
);
assert.equal(
    isPayrollRecordEligibleForPayslip({ status: 'Completed', type: 'Regular' }),
    true
);
assert.equal(
    isPayrollRecordEligibleForPayslip({ status: 'Draft', type: 'Regular' }),
    false
);
assert.equal(
    isPayrollRecordEligibleForPayslip({ status: 'Cancelled', type: 'FinalSettlement' }),
    false
);
assert.equal(shouldIncludeInactiveFinalSettlementPayslips(undefined), true);
assert.equal(shouldIncludeInactiveFinalSettlementPayslips([]), true);
assert.equal(
    shouldIncludeInactiveFinalSettlementPayslips(['Active', 'Resigned']),
    true
);
assert.equal(shouldIncludeInactiveFinalSettlementPayslips(['Resigned']), true);
assert.equal(
    shouldIncludeInactiveFinalSettlementPayslips(['Active']),
    false,
    'Active-only normal payroll filtering must remain unchanged'
);

assert.equal(
    isEmployeeAllowedForPayslipGeneration(
        { active: true },
        [{ status: 'Completed', type: 'Regular' }]
    ),
    true,
    'An active employee with Completed normal payroll remains eligible'
);
assert.equal(
    isEmployeeAllowedForPayslipGeneration(
        { active: false },
        [{ status: 'Completed', type: 'Regular' }]
    ),
    false,
    'An inactive normal employee must not be eligible'
);
assert.equal(
    isEmployeeAllowedForPayslipGeneration(
        { active: false },
        [{ status: 'Draft', type: 'FinalSettlement' }]
    ),
    true,
    'An inactive employee with an eligible explicit F&F payroll is allowed'
);
assert.equal(
    isEmployeeAllowedForPayslipGeneration(
        { active: false },
        [{ status: 'Cancelled', type: 'FinalSettlement' }]
    ),
    false,
    'A cancelled F&F payroll must not enable an inactive employee'
);
assert.equal(
    isEmployeeAllowedForPayslipGeneration(
        { active: false },
        [{ status: 'Draft', type: 'Regular' }]
    ),
    false,
    'A normal Draft payroll must not enable an inactive employee'
);

assert.deepEqual(
    buildPayslipGenerationOutcome(
        ['employee-1'],
        [{
            userId: 'employee-1',
            status: 'Generated',
            documentId: 'document-1'
        }]
    {
        success: true,
        payslips: [{
            userId: 'employee-1',
            status: 'Generated',
            documentId: 'document-1'
        }],
        summary: {
            total: 1,
            generated: 1,
            failed: 0,
            updated: 1
        }
    }
);

const missingDocumentOutcome = buildPayslipGenerationOutcome(
    ['employee-1'],
    [{
        userId: 'employee-1',
        status: 'Generated'
    }]
);
assert.equal(missingDocumentOutcome.success, false);
assert.deepEqual(missingDocumentOutcome.summary, {
    total: 1,
    generated: 0,
    failed: 1,
    updated: 0
});

const noPayrollOutcome = buildPayslipGenerationOutcome(
    ['employee-1'],
    [{
        userId: 'employee-1',
        status: 'No Payroll Found'
    }]
);
assert.equal(noPayrollOutcome.success, false);
assert.deepEqual(noPayrollOutcome.summary, {
    total: 1,
    generated: 0,
    failed: 1,
    updated: 0
});

const partialPayslipOutcome = buildPayslipGenerationOutcome(
    ['employee-1', 'employee-2'],
    [{
        userId: 'employee-1',
        status: 'Generated',
        documentId: 'document-1'
    }, {
        userId: 'employee-2',
        status: 'Error',
        error: 'PDF generation failed'
    }]
);
assert.equal(partialPayslipOutcome.success, false);
assert.deepEqual(partialPayslipOutcome.summary, {
    total: 2,
    generated: 1,
    failed: 1,
    updated: 1
});

const multiMonthSettlement = {
    noticePeriodRecovery: 7742,
    totalHoldAmount: 28560,
    totalLeaveEncashment: 387,
    totalReimbursements: 1000,
    additionalLopAmount: 968,
    finalCalculation: {
        holdSalaries: 28560,
        leaveEncashment: 387,
        reimbursements: 1000,
        additionalLopAmount: 968,
        noticePeriodRecovery: 7742
    },
    unpaidMonths: [
        {
            month: 6,
            year: 2026,
            salary: 30000,
            lopAmount: 0,
            totalDays: 30,
            daysWorked: 30,
            presentDays: 22,
            lopDays: 0,
            professionalTax: 0,
            incomeTax: 0,
            providentFund: 0,
            esi: 0,
            components: {
                basic: 12000,
                hra: 6000,
                conveyance: 0,
                specialAllowance: 0,
                otherAllowances: 12000,
                gross: 30000
            }
        },
        {
            month: 7,
            year: 2026,
            salary: 21290,
            lopAmount: 1935,
            totalDays: 31,
            daysWorked: 20,
            presentDays: 14,
            lopDays: 2,
            professionalTax: 180,
            incomeTax: 0,
            providentFund: 929,
            esi: 0,
            components: {
                basic: 8516,
                hra: 4258,
                conveyance: 0,
                specialAllowance: 0,
                otherAllowances: 8516,
                gross: 21290
            }
        }
    ],
    otherAdditions: [{ description: 'Laptop', amount: 10000 }],
    otherDeductions: [{ description: 'Asset', amount: 1000 }]
};

const juneReconciliation = buildFinalSettlementPayrollReconciliation(
    { month: 6, year: 2026, type: 'FinalSettlement' },
    multiMonthSettlement
);
const julyReconciliation = buildFinalSettlementPayrollReconciliation(
    { month: 7, year: 2026, type: 'FinalSettlement' },
    multiMonthSettlement
);

assert.ok(juneReconciliation);
assert.equal(juneReconciliation.monthlyGross, 30000);
assert.equal(juneReconciliation.holdSalary, 0);
assert.equal(juneReconciliation.noticePeriodRecovery, 0);
assert.deepEqual(juneReconciliation.customReimbursements, []);
assert.deepEqual(juneReconciliation.customDeductions, []);

assert.ok(julyReconciliation);
assert.equal(julyReconciliation.monthlyGross, 21290);
assert.equal(julyReconciliation.leaveDeductions, 1935);
assert.equal(julyReconciliation.holdSalary, 28560);
assert.equal(julyReconciliation.noticePeriodRecovery, 7742);
assert.equal(julyReconciliation.totalDeductions, 10786);
assert.equal(julyReconciliation.totalCustomReimbursements, 11387);
assert.equal(julyReconciliation.totalCustomDeductions, 1968);
assert.equal(julyReconciliation.netSalary, 48483);
assert.deepEqual(
    julyReconciliation.customReimbursements.map((item: any) => item.name),
    ['LEAVE ENCASHMENT', 'REIMBURSEMENTS', 'Laptop']
);
assert.deepEqual(
    julyReconciliation.customDeductions.map((item: any) => item.name),
    ['ADDITIONAL LOP', 'Asset']
);

const normalPayrollFinancials = buildSalaryStatementFinancials({
    monthlyGross: 30000,
    totalDeductions: 2500,
    netSalary: 27500,
    customReimbursements: [],
    customDeductions: []
});

assert.deepEqual(normalPayrollFinancials, {
    periodGross: 30000,
    holdSalary: 0,
    customEarnings: 0,
    customDeductions: 0,
    totalEarnings: 30000,
    totalDeductions: 2500,
    netPay: 27500
});

const normalArunPreview = {
    employeeId: {
        _id: 'arun-id',
        name: 'Arun',
        active: true
    },
    status: 'Active',
    type: 'Regular',
    netSalary: 28000
};
const inactiveFinalSettlementArun = {
    employeeId: {
        _id: 'arun-id',
        name: 'Arun',
        active: false
    },
    status: 'Draft',
    type: 'FinalSettlement',
    isFinalSettlement: true,
    netSalary: 48483
};
const inactiveFinalSettlementBala = {
    employeeId: {
        _id: 'bala-id',
        name: 'Bala',
        active: false
    },
    status: 'Draft',
    type: 'FinalSettlement',
    isFinalSettlement: true,
    netSalary: 32000
};

assert.deepEqual(
    mergeFinalSettlementPayrollsIntoPreview([normalArunPreview], []),
    [normalArunPreview],
    'Normal preview records must remain unchanged when no F&F payroll exists'
);

const mergedPreview = mergeFinalSettlementPayrollsIntoPreview(
    [
        {
            employeeId: { _id: 'anand-id', name: 'Anand', active: true },
            status: 'Active',
            type: 'Regular',
            netSalary: 30000
        },
        normalArunPreview
    ],
    [
        inactiveFinalSettlementArun,
        // Results are supplied newest-first; an older duplicate must not win.
        {
            ...inactiveFinalSettlementArun,
            _id: 'older-arun-payroll',
            netSalary: 11111
        },
        // A normal Draft can never enter the F&F preview exception.
        {
            employeeId: { _id: 'regular-id', name: 'Regular Draft' },
            status: 'Draft',
            type: 'Regular',
            netSalary: 25000
        },
        // A cancelled F&F can never enter the statement.
        {
            employeeId: { _id: 'cancelled-id', name: 'Cancelled F&F' },
            status: 'Cancelled',
            type: 'FinalSettlement',
            netSalary: 25000
        },
        inactiveFinalSettlementBala
    ]
);

assert.deepEqual(
    mergedPreview.map((record: any) => record.employeeId.name),
    ['Anand', 'Arun', 'Bala']
);
assert.equal(
    mergedPreview.find(
        (record: any) => record.employeeId._id === 'arun-id'
    )?.netSalary,
    48483,
    'The stored F&F payroll must replace Arun’s virtual normal-payroll row'
);
assert.equal(
    mergedPreview.filter(
        (record: any) => record.employeeId._id === 'arun-id'
    ).length,
    1,
    'An employee must appear only once in the salary statement preview'
);

console.log('F&F report consistency checks passed.');
