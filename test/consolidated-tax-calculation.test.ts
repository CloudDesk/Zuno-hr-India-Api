import { buildConsolidatedRow, calculateReportTax, financialYearRange, splitPreviousTds, visibleReportColumns, TaxSlabSource, projectFinancialYearGross } from '../src/services/consolidated-tax-calculation';

const oldSlab: TaxSlabSource = { standardDeduction: 50_000, cessRate: 4, slabs: [
    { fromAmount: 0, toAmount: 250_000, taxRate: 0 }, { fromAmount: 250_000, toAmount: 500_000, taxRate: 5 },
    { fromAmount: 500_000, toAmount: 1_000_000, taxRate: 20 }, { fromAmount: 1_000_000, toAmount: null, taxRate: 30 },
] };
const newSlab: TaxSlabSource = { standardDeduction: 75_000, cessRate: 4, slabs: [
    { fromAmount: 0, toAmount: 400_000, taxRate: 0 }, { fromAmount: 400_000, toAmount: 800_000, taxRate: 5 },
    { fromAmount: 800_000, toAmount: 1_200_000, taxRate: 10 }, { fromAmount: 1_200_000, toAmount: 1_600_000, taxRate: 15 },
    { fromAmount: 1_600_000, toAmount: 2_000_000, taxRate: 20 }, { fromAmount: 2_000_000, toAmount: 2_400_000, taxRate: 25 },
    { fromAmount: 2_400_000, toAmount: null, taxRate: 30 },
] };
function input(): Parameters<typeof buildConsolidatedRow>[0] {
    return { employee: { _id: 'employee-1', name: 'Arun', employeeCode: 'E001', active: true, joiningDate: '2020-01-01', governmentIds: { pan: { number: 'ABCDE1234F' } } },
        financialYear: '2025-2026', serial: 1, slab: oldSlab,
        declaration: { regime: 'old', annualGross: 1_200_000, ptDeduction: 2400, declarations: [
            { section: '10_13A', status: 'verified', verifiedAmount: 120_000, rentDetails: [{ amount: 180_000 }] },
            { section: '80C', status: 'verified', verifiedAmount: 150_000 },
            { section: '80D', status: 'pending', verifiedAmount: 25_000 },
        ] },
        salaries: [
            { effectiveFrom: '2025-04-01', effectiveTo: '2025-09-30', monthlyGross: 90_000, salaryStructureId: { fixedEarnings: { basicPercentage: 40, hraPercentage: 20 } } },
            { effectiveFrom: '2025-10-01', effectiveTo: '2026-03-31', monthlyGross: 110_000, salaryStructureId: { fixedEarnings: { basicPercentage: 40, hraPercentage: 20 } } },
        ],
    };
}
describe('Consolidated tax PDF calculations', () => {
    it.each([NaN, Infinity, -1])('does not report a partial annual rent total when a rent entry is invalid (%s)', amount => {
        const source = input();
        source.declaration!.declarations[0].rentDetails = [{ amount: 15000 }, { amount }];
        const row = buildConsolidatedRow(source);
        expect(row.values.rent).toBeNull();
        expect(row.warnings.join(' ')).toContain('rent entry is missing or invalid');
        // Declared rent is display-only; the independently verified HRA exemption still applies.
        expect(row.values.totalTax).toBe(91540.8);
    });
    it('reconciles salary revisions, approved deductions and old-regime tax without mutating sources', () => {
        const source = input();
        const before = JSON.stringify(source);
        const row = buildConsolidatedRow(source);
        expect(row.approvalWarnings?.join(' ')).toContain('80D');
        expect(row.values).toMatchObject({ gross: 1_200_000, basic: 480_000, hraReceived: 240_000, hraExemption: 120_000,
            rent: 180_000, afterExemption: 1_080_000, section16: 52_400, salaryIncome: 1_027_600,
            chapterVIA: 150_000, taxable: 877_600, roundedTaxable: 877_600, incomeTax: 88_020, cess: 3520.8, totalTax: 91540.8 });
        expect(JSON.stringify(source)).toBe(before);
    });
    it('uses fixed PDF percentages independently of salary structure', () => {
        const source = input(); source.salaries[1].salaryStructureId!.fixedEarnings!.basicPercentage = 50;
        expect(buildConsolidatedRow(source).values.basic).toBe(480_000);
    });
    it('uses salary history when the stored declaration gross disagrees', () => {
        const source = input(); source.declaration!.annualGross = 1_300_000;
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ gross: 1_200_000, basic: 480_000, hraReceived: 240_000 });
        expect(row.warnings.join(' ')).toContain('differs');
    });
    it('does not double count overlapping salary assignments', () => {
        const source = input(); source.salaries.push(source.salaries[0]);
        expect(buildConsolidatedRow(source).values.basic).toBeNull();
    });
    it('enforces new-regime applicability while allowing verified employer NPS', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        source.declaration!.declarations.push({ section: '80CCD(2)', status: 'verified', verifiedAmount: 50_000 });
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ hraExemption: null, exemptions: null, pt: null, otherIncome: null, standardDeduction: 75_000, chapterVIA: 200_000, taxable: 925_000, totalTax: 0 });
    });
    it.each([
        [675_000, 600_000, 0, 0, 0],
        [1_275_000, 1_200_000, 0, 0, 0],
        [1_275_001, 1_200_001, 1, 0.04, 1.04],
        [1_500_000, 1_425_000, 93_750, 3_750, 97_500],
    ])('calculates new-regime annual salary %d as taxable %d and tax/cess/total %d/%d/%d',
        (annualGross, taxable, incomeTax, cess, totalTax) => {
            const source = input();
            source.declaration!.regime = 'new';
            source.declaration!.annualGross = annualGross;
            source.declaration!.ptDeduction = undefined;
            source.declaration!.declarations = [];
            source.slab = newSlab;
            source.salaries = [{ effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31', monthlyGross: annualGross / 12 }];
            const row = buildConsolidatedRow(source);
            expect(row.values).toMatchObject({
                gross: annualGross,
                afterExemption: annualGross,
                standardDeduction: 75_000,
                taxable,
                incomeTax,
                cess,
                totalTax,
            });
        });
    it('sums all approved PDF Chapter VI-A sections', () => {
        const source = input();
        source.declaration!.declarations.push(...['80DD', '80GG', '80E', '80CCD(2)', '80C'].map(section => ({ section, status: 'verified', verifiedAmount: 10_000 })));
        expect(buildConsolidatedRow(source).values.chapterVIA).toBe(200_000);
    });
    it('preserves signed property losses and fractional taxable income without rounding to ten', () => {
        const source = input();
        source.declaration!.declarations.push({ section: 'income_loss_house_property', type: 'loss', status: 'verified', verifiedAmount: 12_345.67 });
        const row = buildConsolidatedRow(source);
        expect(row.values.otherIncome).toBe(-12345.67); expect(row.values.roundedTaxable).toBe(865254.33);
    });
    it('never applies a deduction ceiling to positive house-property income', () => {
        const source = input();
        source.declaration!.declarations.push({ section: 'income_loss_house_property', type: 'income', status: 'verified', verifiedAmount: 350_000, maxLimit: 200_000 });
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ otherIncome: 350_000, taxable: 1_227_600, incomeTax: 180_780, cess: 7231.2, totalTax: 188011.2 });
    });
    it('nets signed property income and losses as specified', () => {
        const source = input();
        source.declaration!.declarations.push(
            { section: 'income_loss_house_property', type: 'loss', status: 'verified', verifiedAmount: -400_000, maxLimit: 200_000 },
            { section: 'income_loss_house_property', type: 'income', status: 'verified', verifiedAmount: 150_000, maxLimit: 200_000 },
        );
        expect(buildConsolidatedRow(source).values).toMatchObject({ otherIncome: -250_000, taxable: 627_600 });
    });
    it('keeps current PDF calculation independent of invalid previous salary', () => {
        const source = input(); source.previous = { status: 'Verified', salaryEarned: -1, tdsDeducted: 5000 };
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ previousIncome: null, previousTax: null, totalTax: 91540.8 });
        expect(row.warnings.join(' ')).toContain('salary is missing or invalid');
    });
    it.each([-1, NaN, Infinity])('rejects invalid taxable input %s', taxable => {
        expect(() => calculateReportTax(taxable, 'old', '2025-2026', oldSlab)).toThrow('nonnegative finite');
    });
    it('reconciles marginal relief and net tax with gross slab tax', () => {
        const result = calculateReportTax(1_210_000, 'new', '2025-2026', newSlab);
        expect(result).toEqual({ incomeTax: 10_000, cess: 400, totalTax: 10_400, rebate: 51_500 });
    });
    it('uses the FY2024 new-regime rebate boundary rather than the later year threshold', () => {
        const slab2024 = { ...newSlab, slabs: [
            { fromAmount: 0, toAmount: 300_000, taxRate: 0 }, { fromAmount: 300_000, toAmount: 700_000, taxRate: 5 },
            { fromAmount: 700_000, toAmount: 1_000_000, taxRate: 10 }, { fromAmount: 1_000_000, toAmount: 1_200_000, taxRate: 15 },
            { fromAmount: 1_200_000, toAmount: 1_500_000, taxRate: 20 }, { fromAmount: 1_500_000, toAmount: null, taxRate: 30 },
        ] };
        expect(calculateReportTax(700_000, 'new', '2024-2025', slab2024).totalTax).toBe(0);
        expect(calculateReportTax(700_001, 'new', '2024-2025', slab2024).totalTax).toBe(1.04);
        expect(calculateReportTax(1_200_000, 'new', '2024-2025', slab2024).totalTax).toBe(83_200);
    });
    it('displays previous salary separately from the PDF gross-minus-exemptions formula', () => {
        expect(splitPreviousTds(5000)).toEqual({ incomeTax: 4807.69, cess: 192.31 });
        const source = input(); source.previous = { status: 'Verified', salaryEarned: 100_000, tdsDeducted: 5000 };
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ gross: 1_200_000, previousIncome: 100_000, afterExemption: 1_080_000,
            standardDeduction: 50_000, taxable: 877_600, previousTax: 4807.69, previousCess: 192.31, totalTax: 91540.8 });
    });
    it('does not add previous salary into the current PDF calculation', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        source.previous = { status: 'Verified', salaryEarned: 300_000, tdsDeducted: 10_000 };
        source.declaration!.taxPaid = 40_000; source.declaration!.remainingTaxToPay = 12_345;
        const before = JSON.stringify(source);
        expect(buildConsolidatedRow(source).values).toMatchObject({ gross: 1_200_000, previousIncome: 300_000,
            afterExemption: 1_200_000, standardDeduction: 75_000, taxable: 975_000,
            incomeTax: 0, cess: 0, totalTax: 0, taxPaid: 0, taxBalance: 0 });
        expect(JSON.stringify(source)).toBe(before);
    });
    it('keeps recovery zero even when stored planned or processed amounts exist', () => {
        const source = input(); source.asOf = new Date('2025-05-31T19:00:00Z'); // June in India
        source.declaration!.monthlyDeductions = [{ month: 'Jun', financialYear: '2025-2026', actualDeduction: 5000, isProcessed: false }];
        expect(buildConsolidatedRow(source).values.currentRecovery).toBe(0);
        source.declaration!.monthlyDeductions[0].isProcessed = true;
        expect(buildConsolidatedRow(source).values.currentRecovery).toBe(0);
        source.declaration!.monthlyDeductions.push({ ...source.declaration!.monthlyDeductions[0] });
        expect(buildConsolidatedRow(source).values.currentRecovery).toBe(0);
    });
    it('keeps recovery zero for historical years too', () => {
        const source = input(); source.asOf = new Date('2026-06-01T00:00:00Z');
        source.declaration!.monthlyDeductions = [{ month: 'Jun', financialYear: '2025-2026', actualDeduction: 5000, isProcessed: true }];
        expect(buildConsolidatedRow(source).values.currentRecovery).toBe(0);
    });
    it('keeps current PDF tax available while missing Form12B fields are unavailable', () => {
        const source = input(); source.declaration!.isForm12BApplicable = true;
        expect(buildConsolidatedRow(source).values.totalTax).toBe(91540.8);
    });
    it('excludes unverified previous-employer declarations', () => {
        const source = input(); source.previous = { status: 'Pending', salaryEarned: 100_000, tdsDeducted: 5000 };
        expect(buildConsolidatedRow(source).values).toMatchObject({ previousIncome: null, previousTax: null, totalTax: 91540.8 });
    });
    it('does not claim zero surcharge where previous income requires review', () => {
        const source = input(); source.previous = { status: 'Verified', salaryEarned: 6_000_000, tdsDeducted: 100_000 };
        expect(buildConsolidatedRow(source).values.previousTax).toBeNull();
    });
    it('keeps missing declarations and tax configuration visibly unavailable', () => {
        const source = input(); source.declaration = undefined;
        expect(buildConsolidatedRow(source).values.gross).toBe(1_200_000);
        const missingSlab = input(); missingSlab.slab = undefined;
        expect(buildConsolidatedRow(missingSlab).values.totalTax).toBeNull();
    });
    it('keeps only specification columns visible, including confirmed zero values', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        const row = buildConsolidatedRow(source);
        const columns = visibleReportColumns([row]).map(column => column.key);
        expect(columns).toContain('hraExemption'); expect(columns).toContain('previousIT');
        expect(columns).toHaveLength(34);
        expect(columns).not.toContain('excessRent'); expect(columns).not.toContain('incomeTaxPaid'); expect(columns).not.toContain('directTdsTax'); expect(columns).not.toContain('taxBalance');
        expect(columns).toContain('totalTax'); expect(row.values.totalTax).toBe(0);
    });
    it('prorates employment through the separation date', () => {
        const source = input(); source.employee.active = false; source.employee.separationDate = '2025-10-15';
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ leftOrg: 'Yes', leavingDate: '2025-10-15', gross: 593225.81 });
        expect(row.warnings.join(' ')).toContain('differs');
    });
    it('applies rebate and marginal relief at FY-specific boundaries', () => {
        expect(calculateReportTax(500_000, 'old', '2025-2026', oldSlab).totalTax).toBe(0);
        expect(calculateReportTax(500_001, 'old', '2025-2026', oldSlab).incomeTax).toBe(12500.2);
        expect(calculateReportTax(1_200_000, 'new', '2025-2026', newSlab).totalTax).toBe(0);
        expect(calculateReportTax(1_200_001, 'new', '2025-2026', newSlab).totalTax).toBe(1.04);
    });
    it('rejects incomplete slabs, mismatched cess, unreviewed years and surcharge cases', () => {
        expect(() => calculateReportTax(900_000, 'old', '2025-2026', { ...oldSlab, slabs: oldSlab.slabs.slice(1) })).toThrow('cover');
        expect(() => calculateReportTax(900_000, 'old', '2025-2026', { ...oldSlab, cessRate: 3 })).toThrow('cess');
        expect(() => calculateReportTax(900_000, 'old', '2030-2031', oldSlab)).toThrow('review');
        expect(() => calculateReportTax(5_000_001, 'old', '2025-2026', oldSlab)).toThrow('Surcharge');
        expect(() => financialYearRange('2025-2027')).toThrow('consecutive');
    });
});

describe('Latest report display requirements', () => {
    it('maps every reference field for a complete old-regime calculation', () => {
        const row = buildConsolidatedRow(input());
        expect(row.values).toEqual({
            serial: 1, name: 'Arun', employeeCode: 'E001', pan: 'ABCDE1234F', joiningDate: '2020-01-01', leavingDate: null, leftOrg: 'No', regime: 'Old Regime',
            gross: 1_200_000, basic: 480_000, excessRent: 120_000, hraExemption: 120_000, hraReceived: 240_000, lta: null, exemptions: 120_000, rent: 180_000,
            previousIT: null, previousPF: null, previousPT: null, previousIncome: null, afterExemption: 1_080_000,
            standardDeduction: 50_000, pt: 2_400, section16: 52_400, salaryIncome: 1_027_600, otherIncome: 0, gti: 1_027_600,
            chapterVIA: 150_000, taxable: 877_600, roundedTaxable: 877_600, incomeTax: 88_020, surcharge: 0, cess: 3_520.8, totalTax: 91_540.8, rebate: 0,
            incomeTaxPaid: 0, surchargePaid: 0, cessPaid: 0, directTdsTax: 0, directTdsSurcharge: 0, directTdsCess: 0,
            previousTax: null, previousSurcharge: null, previousCess: null, taxPaid: 0,
            relief89Tax: 0, relief89Surcharge: 0, relief89Cess: 0, relief89Total: 0,
            annualTaxBalance: 0, annualSurchargeBalance: 0, annualCessBalance: 0, annualBalance: 0,
            isOverride: 0, monthlyTax: 0, monthlySurcharge: 0, monthlyCess: 0, currentRecovery: 0, taxBalance: 0, taxRate: 0,
        });
    });
    it('uses captured PF/PT and splits total previous TDS consistently', () => {
        const source = input();
        source.previous = {
            status: 'Verified', salaryEarned: 100000, tdsDeducted: 5000,
            previousIncomeTax: 3_000, previousPF: 1_800, professionalTax: 1_250.5, previousSurcharge: 150,
        };
        const before = JSON.stringify(source);
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ previousIT: 4807.69, previousPF: 1_800, previousPT: 1_250.5, previousSurcharge: 0, previousCess: 192.31 });
        expect(row.values.section16).toBe(52400); // Display-only previous PT does not alter existing deductions.
        expect(JSON.stringify(source)).toBe(before);
    });
    it('keeps missing previous amounts unavailable', () => {
        expect(buildConsolidatedRow(input()).values).toMatchObject({ previousIT: null, previousPT: null, previousPF: null, previousSurcharge: null });
    });
    it('keeps required missing values blank and undefined extra fields zero', () => {
        const source = input(); source.declaration = undefined;
        expect(buildConsolidatedRow(source).values).toMatchObject({ gross: 1_200_000, totalTax: null, previousPT: null,
            directTdsTax: 0, relief89Total: 0, annualBalance: 0, isOverride: 0, taxRate: 0 });
    });
});


describe('FY salary history and reference payment fields', () => {
    it('weights a revision within a month by covered calendar days', () => {
        const source = input();
        source.salaries = [
            { effectiveFrom: '2025-04-01', effectiveTo: '2025-04-15', monthlyGross: 60000 },
            { effectiveFrom: '2025-04-16', effectiveTo: '2026-03-31', monthlyGross: 90000 },
        ];
        expect(projectFinancialYearGross(source.employee, source.salaries, source.financialYear)).toBe(1065000);
    });
    it('projects gap days using the preceding salary rate rather than stored gross', () => {
        const source = input(); source.salaries[1].effectiveFrom = '2025-10-02';
        const row = buildConsolidatedRow(source);
        expect(row.values.gross).toBe(1199354.84);
        expect(row.values.basic).toBe(479741.94);
        expect(row.values.totalTax).not.toBeNull();
    });
    it('calculates previous PT only for old regime while PF and previous IT remain available', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        source.previous = { status: 'Verified', salaryEarned: 100000, tdsDeducted: 5000, previousPF: 1800, professionalTax: 1250 };
        expect(buildConsolidatedRow(source).values).toMatchObject({ previousPT: null, previousPF: 1800, previousIT: 4807.69 });
    });
    it('exports the income-tax part of processed FY deductions and excludes planned or other-FY amounts', () => {
        const source = input();
        source.declaration!.monthlyDeductions = [
            { month: 'Apr', financialYear: '2025-2026', actualDeduction: 5000, isProcessed: true },
            { month: 'May', financialYear: '2025-2026', actualDeduction: 9000, isProcessed: false },
            { month: 'Mar', financialYear: '2024-2025', actualDeduction: 10000, isProcessed: true },
        ];
        expect(buildConsolidatedRow(source).values.incomeTaxPaid).toBe(4807.69);
    });
    it('flags duplicate processed deductions instead of double-counting paid tax', () => {
        const source = input();
        const deduction = { month: 'Apr', financialYear: '2025-2026', actualDeduction: 5000, isProcessed: true };
        source.declaration!.monthlyDeductions = [deduction, deduction];
        const row = buildConsolidatedRow(source);
        expect(row.values.incomeTaxPaid).toBeNull();
        expect(row.warnings.join(' ')).toContain('duplicated');
    });
});


describe('Independent fields survive missing sources', () => {
    it('keeps approved values when salary records and required Form 12B are missing', () => {
        const source = input();
        source.declaration!.isForm12BApplicable = true;
        source.salaries = [];
        source.declaration!.monthlyDeductions = [{month: 'Oct', financialYear: '2025-2026', actualDeduction: 5000, isProcessed: true}];
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({gross: null, basic: null, hraReceived: null,
            hraExemption: 120000, exemptions: 120000, rent: 180000, chapterVIA: 150000,
            standardDeduction: 50000, pt: 2400, section16: 52400, incomeTaxPaid: 4807.69,
            previousIncome: null, previousIT: null, afterExemption: null, salaryIncome: null,
            gti: null, taxable: null, incomeTax: null, totalTax: null});
    });
    it('keeps approved deductions and current PT when tax slab configuration is missing', () => {
        const source = input(); source.slab = undefined;
        expect(buildConsolidatedRow(source).values).toMatchObject({gross: 1200000, rent: 180000,
            exemptions: 120000, afterExemption: 1080000, pt: 2400, chapterVIA: 150000,
            standardDeduction: null, section16: null, totalTax: null});
    });
    it('does not let an invalid HRA amount hide unrelated approved deductions', () => {
        const source = input(); source.declaration!.declarations[0].verifiedAmount = -1;
        expect(buildConsolidatedRow(source).values).toMatchObject({gross: 1200000, rent: 180000,
            hraExemption: null, exemptions: null, chapterVIA: 150000, pt: 2400, totalTax: null});
    });
});


describe('Annual projection without a complete salary history', () => {
    it('annualizes Pavithra monthly gross despite the unrecorded April-August period', () => {
        const source = input(); source.financialYear = '2026-2027'; source.employee.joiningDate = '2026-04-01';
        source.declaration!.annualGross = 1400000; source.declaration!.isForm12BApplicable = true;
        source.salaries = [{effectiveFrom: '2026-09-01', effectiveTo: '2027-03-31', monthlyGross: 200000}];
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({gross: 2400000, basic: 960000, hraReceived: 480000, previousIncome: null});
        expect(row.values.totalTax).not.toBeNull();
        expect(row.warnings.join(' ')).not.toContain('Salary history is missing');
    });
    it('fills internal and trailing gaps with the preceding rate while preserving revisions', () => {
        const source = input();
        source.salaries = [
            {effectiveFrom: '2025-04-01', effectiveTo: '2025-06-30', monthlyGross: 100000},
            {effectiveFrom: '2025-10-01', effectiveTo: '2025-12-31', monthlyGross: 200000},
        ];
        expect(projectFinancialYearGross(source.employee, source.salaries, source.financialYear)).toBe(1800000);
    });
});


describe('Old-regime Excess Rent matches the approved HRA exemption', () => {
    it('uses the verified HRA exemption rather than the entered rent', () => {
        const source = input();
        source.declaration!.declarations[0].rentDetails = [{amount: 100000}, {amount: 80000}];
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({excessRent: 120000, rent: 180000, hraExemption: 120000, totalTax: 91540.8});
    });
    it('shows zero for the new regime even if rent is entered', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        expect(buildConsolidatedRow(source).values.excessRent).toBe(0);
    });
    it('keeps the approved HRA amount even when rent details are absent', () => {
        const source = input(); source.declaration!.declarations[0].rentDetails = [];
        expect(buildConsolidatedRow(source).values.excessRent).toBe(120000);
    });
    it('does not require salary history or Form 12B to show entered rent', () => {
        const source = input(); source.salaries = []; source.declaration!.isForm12BApplicable = true;
        expect(buildConsolidatedRow(source).values).toMatchObject({excessRent: 120000, gross: null, previousIncome: null});
    });
    it('keeps Excess Rent matched to valid HRA even when entered rent is invalid', () => {
        const source = input(); source.declaration!.declarations[0].rentDetails = [{amount: -1}];
        expect(buildConsolidatedRow(source).values.excessRent).toBe(120000);
    });
});


describe('Selected FY tax summary mapping', () => {
    it('exports Net Tax after Rebate with consistent cess and total instead of projected tax', () => {
        const source = input();
        source.declaration!.initialTaxBreakdown = {totalTaxAmount: 50250, rebateAmount: 0, marginalReliefAmount: 0};
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({incomeTax: 50250, cess: 2010, totalTax: 52260, rebate: 0});
        expect(row.warnings.join(' ')).toContain('exported tax amounts use the summary');
    });
    it('preserves confirmed zero net tax and the tax summary relief amount', () => {
        const source = input();
        source.declaration!.initialTaxBreakdown = {totalTaxAmount: 0, rebateAmount: 12500, marginalReliefAmount: 0};
        expect(buildConsolidatedRow(source).values).toMatchObject({incomeTax: 0, cess: 0, totalTax: 0, rebate: 12500});
    });
    it('shows stored tax summary amounts even when salary records are unavailable', () => {
        const source = input(); source.salaries = [];
        source.declaration!.initialTaxBreakdown = {totalTaxAmount: 50250, rebateAmount: 0, marginalReliefAmount: 3500};
        expect(buildConsolidatedRow(source).values).toMatchObject({gross: null, incomeTax: 50250, cess: 2010, totalTax: 52260, rebate: 3500});
    });
    it('does not export a negative stored net tax amount', () => {
        const source = input(); source.declaration!.initialTaxBreakdown = {totalTaxAmount: -1};
        const row = buildConsolidatedRow(source);
        expect(row.values.incomeTax).toBe(88020);
        expect(row.warnings.join(' ')).toContain('Stored Net Tax after Rebate is invalid');
    });
});


describe('Tax summary cess and Total Tax', () => {
    it.each([[50250, 2010, 52260], [0, 0, 0], [50250, 2000.25, 52250.25]])(
        'sums summary income tax %s and summary cess %s as %s', (incomeTax, cess, totalTax) => {
            const source = input();
            source.declaration!.initialTaxBreakdown = {totalTaxAmount: incomeTax, cessAmount: cess};
            const row = buildConsolidatedRow(source);
            expect(row.values).toMatchObject({incomeTax, cess, totalTax});
        });
    it('preserves summary cess when salary-based tax calculation is unavailable', () => {
        const source = input(); source.salaries = [];
        source.declaration!.initialTaxBreakdown = {totalTaxAmount: 50250, cessAmount: 2010};
        expect(buildConsolidatedRow(source).values).toMatchObject({incomeTax: 50250, cess: 2010, totalTax: 52260});
    });
    it('combines calculated net tax with recorded summary cess when summary net tax is absent', () => {
        const source = input(); source.declaration!.initialTaxBreakdown = {cessAmount: 2010};
        expect(buildConsolidatedRow(source).values).toMatchObject({incomeTax: 88020, cess: 2010, totalTax: 90030});
    });
});


describe('Annual professional tax projection', () => {
    it.each([['half_yearly', 1250, 2500], ['monthly', 200, 2400], ['yearly', 2500, 2500]])(
        'projects %s installments of %s as %s annually', (term, amount, expected) => {
            const source = input(); source.financialYear = '2026-2027'; source.employee.joiningDate = '2026-04-01';
            source.declaration!.ptDeduction = 1250;
            source.salaries = [{effectiveFrom: '2026-09-01', effectiveTo: '2027-03-31', monthlyGross: 200000,
                salaryStructureId: {statutoryDeductions: {professionalTax: {term, slabs: [{fromAmount: 0, toAmount: null, taxAmount: amount}]}}}}];
            expect(buildConsolidatedRow(source).values).toMatchObject({pt: expected, section16: 50000 + expected});
        });
    it('does not double stored annual PT when salary PT configuration is unavailable', () => {
        const source = input(); source.declaration!.ptDeduction = 2500;
        expect(buildConsolidatedRow(source).values.pt).toBe(2500);
    });
    it('keeps PT inapplicable under the new regime', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        expect(buildConsolidatedRow(source).values.pt).toBeNull();
    });
});


describe('Available annual PT is preserved without slab configuration', () => {
    it.each([0, 2500])('uses stored annual PT %s when the configured slab list is empty', amount => {
        const source = input(); source.declaration!.ptDeduction = amount;
        for (const salary of source.salaries) salary.salaryStructureId = {
            statutoryDeductions: {professionalTax: {term: 'half_yearly', slabs: []}}
        };
        expect(buildConsolidatedRow(source).values).toMatchObject({pt: amount, section16: 50000 + amount});
    });
});
