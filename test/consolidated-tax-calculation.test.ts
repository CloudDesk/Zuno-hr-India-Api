import { buildConsolidatedRow, calculateReportTax, financialYearRange, splitPreviousTds, visibleReportColumns, TaxSlabSource } from '../src/services/consolidated-tax-calculation';

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
    it('uses actual historical structure percentages', () => {
        const source = input(); source.salaries[1].salaryStructureId!.fixedEarnings!.basicPercentage = 50;
        expect(buildConsolidatedRow(source).values.basic).toBe(546_000);
    });
    it('does not manufacture basic/HRA when salary snapshots disagree', () => {
        const source = input(); source.declaration!.annualGross = 1_300_000;
        const row = buildConsolidatedRow(source);
        expect(row.values.basic).toBeNull(); expect(row.values.hraReceived).toBeNull();
        expect(row.warnings.join(' ')).toContain('reconcile');
    });
    it('does not double count overlapping salary assignments', () => {
        const source = input(); source.salaries.push(source.salaries[0]);
        expect(buildConsolidatedRow(source).values.basic).toBeNull();
    });
    it('enforces new-regime applicability while allowing verified employer NPS', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        source.declaration!.declarations.push({ section: '80CCD(2)', status: 'verified', verifiedAmount: 50_000 });
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ hraExemption: null, exemptions: null, pt: null, otherIncome: null, standardDeduction: 75_000, chapterVIA: 50_000, taxable: 1_075_000, totalTax: 0 });
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
    it('includes additional PDF Chapter VI-A sections and caps aggregate 80C', () => {
        const source = input();
        source.declaration!.declarations.push(...['80DD', '80GG', '80E', '80CCD(2)', '80C'].map(section => ({ section, status: 'verified', verifiedAmount: 10_000 })));
        expect(buildConsolidatedRow(source).values.chapterVIA).toBe(190_000);
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
    it('nets property income and signed losses before limiting salary setoff', () => {
        const source = input();
        source.declaration!.declarations.push(
            { section: 'income_loss_house_property', type: 'loss', status: 'verified', verifiedAmount: -400_000, maxLimit: 200_000 },
            { section: 'income_loss_house_property', type: 'income', status: 'verified', verifiedAmount: 150_000, maxLimit: 200_000 },
        );
        expect(buildConsolidatedRow(source).values).toMatchObject({ otherIncome: -200_000, taxable: 677_600 });
    });
    it('does not calculate final tax or split TDS from invalid previous salary', () => {
        const source = input(); source.previous = { status: 'Verified', salaryEarned: -1, tdsDeducted: 5000 };
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ previousIncome: null, previousTax: null, totalTax: null });
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
    it('adds verified previous salary once and keeps TDS separate from annual liability', () => {
        expect(splitPreviousTds(5000)).toEqual({ incomeTax: 4807.69, cess: 192.31 });
        const source = input(); source.previous = { status: 'Verified', salaryEarned: 100_000, tdsDeducted: 5000 };
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ gross: 1_200_000, previousIncome: 100_000, afterExemption: 1_180_000,
            standardDeduction: 50_000, taxable: 977_600, previousTax: 4807.69, previousCess: 192.31, totalTax: 112340.8 });
    });
    it('matches the combined-salary example with one standard deduction', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        source.previous = { status: 'Verified', salaryEarned: 300_000, tdsDeducted: 10_000 };
        source.declaration!.taxPaid = 40_000; source.declaration!.remainingTaxToPay = 12_345;
        const before = JSON.stringify(source);
        expect(buildConsolidatedRow(source).values).toMatchObject({ gross: 1_200_000, previousIncome: 300_000,
            afterExemption: 1_500_000, standardDeduction: 75_000, taxable: 1_425_000,
            incomeTax: 93_750, cess: 3750, totalTax: 97_500, taxPaid: 0, taxBalance: 0 });
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
    it('keeps final tax unavailable for a required missing Form12B', () => {
        const source = input(); source.declaration!.isForm12BApplicable = true;
        expect(buildConsolidatedRow(source).values.totalTax).toBeNull();
    });
    it('excludes unverified previous-employer declarations', () => {
        const source = input(); source.previous = { status: 'Pending', salaryEarned: 100_000, tdsDeducted: 5000 };
        expect(buildConsolidatedRow(source).values).toMatchObject({ previousIncome: null, previousTax: null, totalTax: null });
    });
    it('does not claim zero surcharge where previous income requires review', () => {
        const source = input(); source.previous = { status: 'Verified', salaryEarned: 6_000_000, tdsDeducted: 100_000 };
        expect(buildConsolidatedRow(source).values.previousTax).toBeNull();
    });
    it('keeps missing declarations and tax configuration visibly unavailable', () => {
        const source = input(); source.declaration = undefined;
        expect(buildConsolidatedRow(source).values.gross).toBeNull();
        const missingSlab = input(); missingSlab.slab = undefined;
        expect(buildConsolidatedRow(missingSlab).values.totalTax).toBeNull();
    });
    it('keeps all reference columns visible, including zero and inapplicable values', () => {
        const source = input(); source.declaration!.regime = 'new'; source.slab = newSlab;
        const row = buildConsolidatedRow(source);
        const columns = visibleReportColumns([row]).map(column => column.key);
        expect(columns).toContain('hraExemption'); expect(columns).toContain('previousTax');
        expect(columns).toHaveLength(60);
        expect(columns).toContain('totalTax'); expect(row.values.totalTax).toBe(0);
    });
    it('supports joining/leaving details without changing the annual projection', () => {
        const source = input(); source.employee.active = false; source.employee.separationDate = '2025-10-15';
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ leftOrg: 'Yes', leavingDate: '2025-10-15', gross: 1_200_000 });
        expect(row.warnings.join(' ')).toContain('Partial employment month');
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
            gross: 1_200_000, basic: 480_000, excessRent: 0, hraExemption: 120_000, hraReceived: 240_000, lta: 0, exemptions: 120_000, rent: 180_000,
            previousIT: 0, previousPF: 0, previousPT: 0, previousIncome: null, afterExemption: 1_080_000,
            standardDeduction: 50_000, pt: 2_400, section16: 52_400, salaryIncome: 1_027_600, otherIncome: 0, gti: 1_027_600,
            chapterVIA: 150_000, taxable: 877_600, roundedTaxable: 877_600, incomeTax: 88_020, surcharge: 0, cess: 3_520.8, totalTax: 91_540.8, rebate: 0,
            incomeTaxPaid: 0, surchargePaid: 0, cessPaid: 0, directTdsTax: 0, directTdsSurcharge: 0, directTdsCess: 0,
            previousTax: null, previousSurcharge: 0, previousCess: null, taxPaid: 0,
            relief89Tax: 0, relief89Surcharge: 0, relief89Cess: 0, relief89Total: 0,
            annualTaxBalance: 0, annualSurchargeBalance: 0, annualCessBalance: 0, annualBalance: 0,
            isOverride: 0, monthlyTax: 0, monthlySurcharge: 0, monthlyCess: 0, currentRecovery: 0, taxBalance: 0, taxRate: 0,
        });
    });
    it('shows declared previous Form 12B amounts and defaults missing values to zero', () => {
        const source = input();
        source.previous = {
            status: 'Verified', salaryEarned: 100000, tdsDeducted: 5000,
            previousIncomeTax: 3_000, previousPF: 1_800, professionalTax: 1_250.5, previousSurcharge: 150,
        };
        const before = JSON.stringify(source);
        const row = buildConsolidatedRow(source);
        expect(row.values).toMatchObject({ previousIT: 3_000, previousPF: 1_800, previousPT: 1_250.5, previousSurcharge: 150 });
        expect(row.values.section16).toBe(52400); // Display-only previous PT does not alter existing deductions.
        expect(JSON.stringify(source)).toBe(before);
    });
    it('defaults missing previous Form 12B display values to zero without substituting current-employer deductions', () => {
        expect(buildConsolidatedRow(input()).values).toMatchObject({ previousIT: 0, previousPT: 0, previousPF: 0, previousSurcharge: 0 });
    });
    it('keeps required missing values blank and undefined extra fields zero', () => {
        const source = input(); source.declaration = undefined;
        expect(buildConsolidatedRow(source).values).toMatchObject({ gross: null, totalTax: null, previousPT: 0,
            directTdsTax: 0, relief89Total: 0, annualBalance: 0, isOverride: 0, taxRate: 0 });
    });
});
