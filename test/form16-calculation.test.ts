import {
    assertForm16FinancialYear,
    calculateForm16,
    getForm16AssessmentYear,
} from '../src/services/form16-calculation.service';

describe('Form 16 calculation', () => {
    const oldRegimeSlabs = [
        { fromAmount: 0, toAmount: 250_000, taxRate: 0 },
        { fromAmount: 250_000, toAmount: 500_000, taxRate: 5 },
        { fromAmount: 500_000, toAmount: 1_000_000, taxRate: 20 },
        { fromAmount: 1_000_000, toAmount: null, taxRate: 30 },
    ];

    const newRegime2025Slabs = [
        { fromAmount: 0, toAmount: 400_000, taxRate: 0 },
        { fromAmount: 400_000, toAmount: 800_000, taxRate: 5 },
        { fromAmount: 800_000, toAmount: 1_200_000, taxRate: 10 },
        { fromAmount: 1_200_000, toAmount: 1_600_000, taxRate: 15 },
        { fromAmount: 1_600_000, toAmount: 2_000_000, taxRate: 20 },
        { fromAmount: 2_000_000, toAmount: 2_400_000, taxRate: 25 },
        { fromAmount: 2_400_000, toAmount: null, taxRate: 30 },
    ];

    it('maps verified old-regime declarations to the supported rows', () => {
        const result = calculateForm16({
            annualGross: 1_000_000,
            regime: 'old',
            standardDeduction: 50_000,
            professionalTax: 2_400,
            declarations: [
                { section: '10_13A', verifiedAmount: 120_000, status: 'verified' },
                { section: '80C', verifiedAmount: 150_000, status: 'verified' },
                { section: '80D', verifiedAmount: 25_000, status: 'verified' },
                { section: '80E', verifiedAmount: 10_000, status: 'verified' },
                { section: '80G', verifiedAmount: 5_000, status: 'verified' },
                { section: '80C', verifiedAmount: 50_000, status: 'pending' },
                { section: 'income_loss_house_property', verifiedAmount: 100_000, status: 'verified', type: 'loss' },
            ],
            financialYear: '2025-2026',
            taxSlabs: oldRegimeSlabs,
            cessRate: 4,
        });

        expect(result.totalGrossSalary).toBe(1_000_000);
        expect(result.hraExemption).toBe(120_000);
        expect(result.professionalTax).toBe(2_400);
        expect(result.salaryIncome).toBe(827_600);
        expect(result.housePropertyIncomeOrLoss).toBe(-100_000);
        expect(result.totalChapterVIA).toBe(190_000);
        expect(result.totalTaxableIncome).toBe(537_600);
        expect(result.taxOnTotalIncome).toBe(20_020);
        expect(result.healthAndEducationCess).toBe(801);
        expect(result.netTaxPayable).toBe(20_821);
    });

    it('zero-fills old-regime-only deductions under the new regime', () => {
        const result = calculateForm16({
            annualGross: 600_000,
            regime: 'new',
            standardDeduction: 75_000,
            professionalTax: 2_400,
            declarations: [
                { section: '10_13A', verifiedAmount: 100_000, status: 'verified' },
                { section: '80C', verifiedAmount: 150_000, status: 'verified' },
            ],
            financialYear: '2025-2026',
            taxSlabs: newRegime2025Slabs,
            cessRate: 4,
        });

        expect(result.hraExemption).toBe(0);
        expect(result.professionalTax).toBe(0);
        expect(result.section80C).toBe(0);
        expect(result.totalTaxableIncome).toBe(525_000);
        expect(result.netTaxPayable).toBe(0);
    });

    it('reconciles the displayed old-regime taxable income with sections 13, 16 and 21', () => {
        const result = calculateForm16({
            annualGross: 3_000_000,
            regime: 'old',
            standardDeduction: 50_000,
            professionalTax: 0,
            declarations: [],
            financialYear: '2025-2026',
            taxSlabs: oldRegimeSlabs,
            cessRate: 4,
        });

        expect(result.totalTaxableIncome).toBe(2_950_000);
        expect(result.taxOnTotalIncome).toBe(697_500);
        expect(result.healthAndEducationCess).toBe(27_900);
        expect(result.netTaxPayable).toBe(725_400);
    });

    it('maps any consecutive financial year to its assessment year', () => {
        expect(getForm16AssessmentYear('2025-2026')).toBe('2026-27');
        expect(getForm16AssessmentYear('2026-2027')).toBe('2027-28');
        expect(() => assertForm16FinancialYear('2026-2028')).toThrow(/consecutive range/);
        expect(() => assertForm16FinancialYear('26-27')).toThrow(/YYYY-YYYY/);
    });
});
