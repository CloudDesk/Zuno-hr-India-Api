export const FORM16_TEMPLATE_VERSION = 2;

export interface Form16DeclarationInput {
    section?: string;
    verifiedAmount?: number;
    status?: string;
    type?: 'income' | 'loss';
    maxLimit?: number;
}

export interface Form16TaxSlabInput {
    fromAmount: number;
    toAmount?: number | null;
    taxRate: number;
}

export interface Form16CalculationInput {
    annualGross: number;
    regime: 'old' | 'new';
    standardDeduction: number;
    professionalTax: number;
    declarations: Form16DeclarationInput[];
    financialYear: string;
    taxSlabs: Form16TaxSlabInput[];
    cessRate: number;
}

export interface Form16CalculationResult {
    annualGross: number;
    perquisites: number;
    profitsInLieuOfSalary: number;
    totalGrossSalary: number;
    salaryFromOtherEmployers: number;
    hraExemption: number;
    otherSection10Exemptions: number;
    totalSection10Exemptions: number;
    salaryAfterExemptions: number;
    standardDeduction: number;
    entertainmentAllowance: number;
    professionalTax: number;
    totalSection16Deductions: number;
    salaryIncome: number;
    housePropertyIncomeOrLoss: number;
    otherIncome: number;
    totalOtherIncome: number;
    grossTotalIncome: number;
    section80C: number;
    section80D: number;
    section80E: number;
    section80G: number;
    otherChapterVIA: number;
    totalChapterVIA: number;
    totalTaxableIncome: number;
    taxOnTotalIncome: number;
    rebate: number;
    surcharge: number;
    healthAndEducationCess: number;
    taxPayable: number;
    relief: number;
    form12BAATds: number;
    form12BAATcs: number;
    netTaxPayable: number;
}

const amount = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const normalizedSection = (value: unknown): string => String(value || '')
    .toUpperCase()
    .replace(/[()_\s-]/g, '');

const verifiedDeclarations = (declarations: Form16DeclarationInput[]): Form16DeclarationInput[] =>
    (declarations || []).filter((declaration) => declaration.status === 'verified');

const eligibleDeclarationAmount = (declaration?: Form16DeclarationInput): number => {
    const verifiedAmount = amount(declaration?.verifiedAmount);
    const maxLimit = amount(declaration?.maxLimit);
    return maxLimit > 0 ? Math.min(verifiedAmount, maxLimit) : verifiedAmount;
};

const sumSection = (declarations: Form16DeclarationInput[], section: string): number => {
    const normalized = normalizedSection(section);
    return amount(declarations
        .filter((declaration) => normalizedSection(declaration.section) === normalized)
        .reduce((total, declaration) => total + eligibleDeclarationAmount(declaration), 0));
};

const calculateSlabTax = (taxableIncome: number, slabs: Form16TaxSlabInput[]): number => {
    return amount([...slabs]
        .sort((left, right) => Number(left.fromAmount) - Number(right.fromAmount))
        .reduce((total, slab) => {
            const fromAmount = amount(slab.fromAmount);
            const toAmount = slab.toAmount === null || slab.toAmount === undefined
                ? null
                : amount(slab.toAmount);
            if (taxableIncome <= fromAmount) return total;
            const taxableInSlab = Math.max(0, Math.min(taxableIncome, toAmount ?? taxableIncome) - fromAmount);
            return total + Math.round(taxableInSlab * (Number(slab.taxRate || 0) / 100));
        }, 0));
};

const taxAfterRebateAndMarginalRelief = (
    regime: 'old' | 'new',
    financialYear: string,
    taxableIncome: number,
    slabTax: number,
): number => {
    if (regime === 'old') {
        return taxableIncome <= 500_000 ? Math.max(0, slabTax - Math.min(slabTax, 12_500)) : slabTax;
    }
    const startYear = Number(financialYear.slice(0, 4));
    const rebateIncomeLimit = startYear >= 2025 ? 1_200_000 : startYear >= 2023 ? 700_000 : 500_000;
    const maximumRebate = startYear >= 2025 ? 60_000 : startYear >= 2023 ? 25_000 : 12_500;
    if (taxableIncome <= rebateIncomeLimit) {
        return Math.max(0, slabTax - Math.min(slabTax, maximumRebate));
    }
    return Math.min(slabTax, taxableIncome - rebateIncomeLimit);
};

export function isForm16FinancialYear(value: string): boolean {
    const match = /^(\d{4})-(\d{4})$/.exec(String(value || '').trim());
    if (!match) return false;
    const startYear = Number(match[1]);
    return Number(match[2]) === startYear + 1;
}

export function assertForm16FinancialYear(value: string): void {
    if (!isForm16FinancialYear(value)) {
        throw new Error('Financial year must be a consecutive range in YYYY-YYYY format (for example, 2026-2027).');
    }
}

export function getForm16AssessmentYear(financialYear: string): string {
    assertForm16FinancialYear(financialYear);
    const endYear = Number(financialYear.slice(5));
    return `${endYear}-${String((endYear + 1) % 100).padStart(2, '0')}`;
}

export function calculateForm16(input: Form16CalculationInput): Form16CalculationResult {
    const declarations = verifiedDeclarations(input.declarations);
    const isOldRegime = input.regime === 'old';
    const annualGross = amount(input.annualGross);
    const standardDeduction = amount(input.standardDeduction);
    const professionalTax = isOldRegime ? amount(input.professionalTax) : 0;
    const hraExemption = isOldRegime
        ? amount(declarations
            .filter((declaration) => ['1013A', '10A13A'].includes(normalizedSection(declaration.section)))
            .reduce((total, declaration) => total + eligibleDeclarationAmount(declaration), 0))
        : 0;

    const houseProperty = declarations.find((declaration) =>
        normalizedSection(declaration.section) === 'INCOMELOSSHOUSEPROPERTY' ||
        normalizedSection(declaration.section) === '24B',
    );
    const housePropertyAmount = houseProperty?.type === 'loss'
        ? Math.min(eligibleDeclarationAmount(houseProperty), amount(houseProperty.maxLimit) || 200_000)
        : eligibleDeclarationAmount(houseProperty);
    const housePropertyIncomeOrLoss = houseProperty
        ? (houseProperty.type === 'income' ? housePropertyAmount : -housePropertyAmount)
        : 0;

    const section80C = isOldRegime ? sumSection(declarations, '80C') : 0;
    const section80D = isOldRegime ? sumSection(declarations, '80D') : 0;
    const section80E = isOldRegime ? sumSection(declarations, '80E') : 0;
    const section80G = isOldRegime ? sumSection(declarations, '80G') : 0;

    const totalGrossSalary = annualGross;
    const totalSection10Exemptions = hraExemption;
    const salaryAfterExemptions = Math.max(0, totalGrossSalary - totalSection10Exemptions);
    const totalSection16Deductions = standardDeduction + professionalTax;
    const salaryIncome = Math.max(0, salaryAfterExemptions - totalSection16Deductions);
    const totalOtherIncome = housePropertyIncomeOrLoss;
    const grossTotalIncome = Math.max(0, salaryIncome + totalOtherIncome);
    const totalChapterVIA = section80C + section80D + section80E + section80G;
    const totalTaxableIncome = Math.max(0, grossTotalIncome - totalChapterVIA);

    // Row 13 is deliberately recomputed from the same taxable income printed on
    // row 12. This prevents a stale declaration snapshot from producing a Form
    // 16 whose displayed deductions and final tax do not reconcile.
    const slabTax = calculateSlabTax(totalTaxableIncome, input.taxSlabs || []);
    const taxOnTotalIncome = taxAfterRebateAndMarginalRelief(
        input.regime,
        input.financialYear,
        totalTaxableIncome,
        slabTax,
    );
    const healthAndEducationCess = taxOnTotalIncome > 0
        ? Math.round(taxOnTotalIncome * (Number(input.cessRate || 0) / 100))
        : 0;
    const taxPayable = taxOnTotalIncome + healthAndEducationCess;

    return {
        annualGross,
        perquisites: 0,
        profitsInLieuOfSalary: 0,
        totalGrossSalary,
        salaryFromOtherEmployers: 0,
        hraExemption,
        otherSection10Exemptions: 0,
        totalSection10Exemptions,
        salaryAfterExemptions,
        standardDeduction,
        entertainmentAllowance: 0,
        professionalTax,
        totalSection16Deductions,
        salaryIncome,
        housePropertyIncomeOrLoss,
        otherIncome: 0,
        totalOtherIncome,
        grossTotalIncome,
        section80C,
        section80D,
        section80E,
        section80G,
        otherChapterVIA: 0,
        totalChapterVIA,
        totalTaxableIncome,
        taxOnTotalIncome,
        rebate: 0,
        surcharge: 0,
        healthAndEducationCess,
        taxPayable,
        relief: 0,
        form12BAATds: 0,
        form12BAATcs: 0,
        netTaxPayable: taxPayable,
    };
}
