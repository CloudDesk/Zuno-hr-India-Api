/** Read-only projection of the supplied Consolidated Tax Report specification.
 * This module must never update declarations, payroll, or deduction schedules.
 */
export type ReportValue = string | number | null;
export interface ReportColumn { key: string; label: string; type: 'text' | 'date' | 'money'; optional?: boolean; zeroDefault?: boolean; }
export interface ReportRow { employeeId: string; values: Record<string, ReportValue>; warnings: string[]; approvalWarnings?: string[]; }
export interface TaxDeclarationSource {
    regime: 'old' | 'new'; annualGross: number; ptDeduction?: number;
    declarations: Array<{ section: string; status: string; verifiedAmount?: number; maxLimit?: number;
        type?: string; rentDetails?: Array<{ amount: number }> }>;
    initialTaxBreakdown?: { taxableIncome?: number; taxWithCess?: number };
    isMigrationAdjusted?: boolean;
    poiSubmissionStatus?: string;
    isForm12BApplicable?: boolean;
    taxPaid?: number;
    remainingTaxToPay?: number;
    monthlyDeductions?: Array<{ month: string; financialYear: string; actualDeduction: number; isProcessed: boolean }>;
}
export interface TaxSlabSource {
    standardDeduction: number; cessRate: number;
    slabs: Array<{ fromAmount: number; toAmount?: number | null; taxRate: number }>;
}
export interface ReportEmployee {
    _id: unknown; name?: string; employeeCode?: string; joiningDate?: Date | string;
    separationDate?: Date | string; active?: boolean; governmentIds?: { pan?: { number?: string } };
}
export interface SalarySource {
    effectiveFrom: Date | string; effectiveTo: Date | string; monthlyGross: number;
    salaryStructureId?: { fixedEarnings?: { basicPercentage?: number; hraPercentage?: number } };
}
export interface PreviousEmploymentSource {
    status?: string; salaryEarned?: number; tdsDeducted?: number;
    previousIncomeTax?: number; previousPF?: number; professionalTax?: number; previousSurcharge?: number;
}

// All reference columns remain visible, including user-requested zero placeholders.
export const REPORT_COLUMNS: ReportColumn[] = [
    ["serial", "Sl No", "text"],
    ["name", "Name", "text"],
    ["employeeCode", "EmployeeNo", "text"],
    ["pan", "PAN Number", "text"],
    ["joiningDate", "JoinDate", "date"],
    ["leavingDate", "LeavingDate", "date"],
    ["leftOrg", "LeftOrg", "text"],
    ["regime", "Current Regime", "text"],
    ["gross", "D) Gross Salary", "money"],
    ["basic", "E) Basic DA Value", "money"],
    ["excessRent", "E) Excess Rent", "money", true],
    ["hraExemption", "E) House Rent Allowance : Section 10(13a)", "money"],
    ["hraReceived", "E) HRA Received", "money"],
    ["lta", "E) Leave Travel Assistance", "money", true],
    ["exemptions", "E) Total Exemptions", "money"],
    ["rent", "E) Total Rent Paid p.a", "money"],
    ["previousIT", "F) Prev IT", "money", true],
    ["previousPF", "F) Prev PF", "money", true],
    ["previousPT", "F) Prev PT", "money", true],
    ["previousIncome", "F) Prev Total Income", "money"],
    ["afterExemption", "G) Income After Exemption", "money"],
    ["standardDeduction", "H) Deduction Under Section 16", "money"],
    ["pt", "H) Tax on Employment : Sec 16(iii)", "money"],
    ["section16", "H) Standard Deduction : Sec 16(ia)", "money"],
    ["salaryIncome", "I) Income chargeable under the head salaries", "money"],
    ["otherIncome", "J) Other Income", "money"],
    ["gti", "K) Gross Total Income", "money"],
    ["chapterVIA", "I) ChapterVIA Deduction", "money"],
    ["taxable", "M) Taxable Income", "money"],
    ["roundedTaxable", "N) Taxable Income Round off to 10 Rs.", "money"],
    ["incomeTax", "O) Total Income Tax to be Paid", "money"],
    ["surcharge", "O) Total Surcharge to be Paid", "money", true],
    ["cess", "O) Total Cess to be Paid", "money"],
    ["totalTax", "O) Total Tax to be paid", "money"],
    ["rebate", "O) Relief u/s 87A", "money"],
    ["incomeTaxPaid", "P) Income Tax Paid", "money", true],
    ["surchargePaid", "P) Surcharge Paid", "money", true],
    ["cessPaid", "P) Cess Paid", "money", true],
    ["directTdsTax", "P) Direct TDS Income Tax", "money", true],
    ["directTdsSurcharge", "P) Direct TDS Surcharge", "money", true],
    ["directTdsCess", "P) Direct TDS Cess", "money", true],
    ["previousTax", "P) Prev Income Tax", "money"],
    ["previousSurcharge", "P) Prev Surcharge", "money", true],
    ["previousCess", "P) Prev Cess", "money"],
    ["taxPaid", "P) Tax Paid Till Date", "money", true],
    ["relief89Tax", "Q) Relief u/s 89  Income Tax", "money", true],
    ["relief89Surcharge", "Q) Relief u/s 89  Surcharge", "money", true],
    ["relief89Cess", "Q) Relief u/s 89  Cess", "money", true],
    ["relief89Total", "Q) Relief u/s 89  Total Tax", "money", true],
    ["annualTaxBalance", "R) Annual Income Tax Balance", "money", true],
    ["annualSurchargeBalance", "R) Annual Surcharge Balance", "money", true],
    ["annualCessBalance", "R) Annual Cess Balance", "money", true],
    ["annualBalance", "R) Annual Tax Balance", "money", true],
    ["isOverride", "S) Is Override", "money", true],
    ["monthlyTax", "S) Monthly Income Tax", "money", true],
    ["monthlySurcharge", "S) Monthly Surcharge", "money", true],
    ["monthlyCess", "S) Monthly Cess", "money", true],
    ["currentRecovery", "S) TDS Recovered in current month", "money", true],
    ["taxBalance", "T) Tax Balance", "money", true],
    ["taxRate", "Tax Rate( in % )", "money", true],
].map(([key, label, type, zeroDefault]) => ({ key, label, type, zeroDefault } as ReportColumn));

export const REPORT_NOTES = [
    'One consolidated Excel file is generated for the entire financial year. Unapproved or missing declarations are warnings only: administrators may generate or update the file anyway. Unapproved deductions remain excluded; generation does not approve declarations.',
    'Annual gross uses the existing financial-year tax declaration salary projection, including its salary revisions; this is not an actual-payroll earnings statement.',
    'Basic and HRA received use salary-structure percentages across the FY. Employment months follow the existing whole-month tax projection convention.',
    'Only verified declarations are deductible. HRA exemption, professional tax and house-property income/loss follow the PDF old-regime restriction. Under the new regime only 80CCD(2) from the specified Chapter VI-A list is eligible.',
    'Per the PDF, the column labelled Standard Deduction : Sec 16(ia) contains standard deduction plus professional tax. The rounded taxable-income column is identical to taxable income; no rounding to Rs.10 is applied.',
    'Verified previous-employer gross salary for the selected FY is displayed separately and added once to Income After Exemption. Standard deduction is applied once to the combined salary. Total Tax is annual liability before TDS credits; previous TDS is displayed separately and is not subtracted from income or annual liability.',
    'Per the latest display instruction, Excel-only fields not defined in the PDF are numeric zero placeholders, including paid tax, recovery, balance, Direct TDS and Section 89 relief. These zeros are not actual payroll balances or tax credits and are never used in tax calculations.',
    'The previous-TDS split assumes no surcharge: income tax = TDS / 1.04; cess is the remainder. If previous salary exceeds Rs.50 lakh, the split is unavailable pending actual surcharge details.',
    'Unavailable or inapplicable values display as a dash in Excel. Missing or ambiguous PDF-required source data also carries an employee warning. All 60 reference columns stay visible, including numeric zero placeholders.',
    'Previous IT, PF, PT and surcharge display the nonnegative Form 12B declared amount when present; otherwise each displays zero. They are display values only and do not alter current-employer deductions or annual tax.',
    'This export is a read-only calculation from the provided specification. It does not change payroll, tax declarations, Form 12B, Form 12BB, Form 16, or tax deduction schedules.',
];

export function declarationApprovalWarnings(declaration?: TaxDeclarationSource, previous?: PreviousEmploymentSource): string[] {
    const warnings: string[] = [];
    if (!declaration) return ['FY tax declaration is missing or ambiguous; approval cannot be confirmed.'];
    if (declaration.poiSubmissionStatus !== 'verified') {
        warnings.push(`Tax declaration approval is ${String(declaration.poiSubmissionStatus || 'not confirmed').replace(/_/g, ' ')}.`);
    }
    const unapproved = declaration.declarations.filter(item => item.status !== 'verified');
    if (unapproved.length) {
        const sections = [...new Set(unapproved.map(item => `${item.section} (${String(item.status || 'unknown').replace(/_/g, ' ')})`))];
        warnings.push(`${unapproved.length} declaration item(s) not approved: ${sections.join(', ')}.`);
    }
    if (previous && previous.status !== 'Verified') warnings.push(`Form 12B approval is ${previous.status || 'not confirmed'}.`);
    if (declaration.isForm12BApplicable && !previous) warnings.push('Required Form 12B is missing.');
    return warnings;
}

export const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const section = (value: string): string => value.toUpperCase().replace(/[()_\s-]/g, '');
export function financialYearRange(fy: string): { start: Date; end: Date; year: number } {
    const match = /^(\d{4})-(\d{4})$/.exec(fy);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) throw new Error('Select a consecutive financial year in YYYY-YYYY format.');
    const year = Number(match[1]);
    return { year, start: new Date(Date.UTC(year, 3, 1)), end: new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59, 999)) };
}
function dateOnly(value?: Date | string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function splitPreviousTds(total: number): { incomeTax: number; cess: number } {
    if (!numeric(total) || total < 0) throw new Error('Previous TDS must be a nonnegative number.');
    const incomeTax = money(total / 1.04);
    return { incomeTax, cess: money(total - incomeTax) };
}

/** FY-specific rebate; slab rates and standard deduction always come from configured FY records. */
export function calculateReportTax(taxable: number, regime: 'old' | 'new', fy: string, config: TaxSlabSource) {
    if (!numeric(taxable) || taxable < 0) throw new Error('Taxable income must be a nonnegative finite number.');
    if (!['old', 'new'].includes(regime)) throw new Error('Tax regime is invalid.');
    const { year } = financialYearRange(fy);
    if (![2024, 2025, 2026].includes(year)) throw new Error('Rebate rules for this financial year require review; tax liability is unavailable.');
    if (taxable > 5_000_000) throw new Error('Surcharge calculation is not specified; tax liability above Rs.50 lakh requires review.');
    if (config.cessRate !== 4) throw new Error('Configured cess differs from the PDF rate of 4%; resolve the configuration before calculating tax.');
    const slabs = [...config.slabs].sort((a, b) => a.fromAmount - b.fromAmount);
    if (!slabs.length || slabs[0].fromAmount !== 0 || slabs[slabs.length - 1].toAmount != null) throw new Error('Tax slabs must cover income from zero through an open-ended final slab.');
    let tax = 0;
    slabs.forEach((slab, index) => {
        if (!numeric(slab.fromAmount) || slab.fromAmount < 0 || !numeric(slab.taxRate) || slab.taxRate < 0 || slab.taxRate > 100 ||
            (slab.toAmount != null && (!numeric(slab.toAmount) || slab.toAmount <= slab.fromAmount)) ||
            (index > 0 && slabs[index - 1].toAmount !== slab.fromAmount)) throw new Error('Invalid, overlapping or incomplete tax slabs.');
        tax += Math.max(0, Math.min(taxable, slab.toAmount ?? taxable) - slab.fromAmount) * slab.taxRate / 100;
    });
    tax = money(tax);
    const threshold = regime === 'old' ? 500_000 : year === 2024 ? 700_000 : 1_200_000;
    const maximum = regime === 'old' ? 12_500 : year === 2024 ? 25_000 : 60_000;
    const rebate = taxable <= threshold ? Math.min(tax, maximum) : 0;
    const afterRebate = regime === 'new' && taxable > threshold ? Math.min(tax, taxable - threshold) : tax - rebate;
    const incomeTax = money(Math.max(0, afterRebate));
    const cess = money(incomeTax * 0.04);
    // Section 87A relief includes marginal relief above the new-regime threshold.
    return { incomeTax, cess, totalTax: money(incomeTax + cess), rebate: money(tax - incomeTax) };
}

export function buildConsolidatedRow(input: {
    employee: ReportEmployee; declaration?: TaxDeclarationSource; slab?: TaxSlabSource;
    salaries: SalarySource[]; previous?: PreviousEmploymentSource; financialYear: string; serial: number; asOf?: Date;
}): ReportRow {
    const { employee, declaration: declaration, slab, salaries, previous, financialYear } = input;
    const approvalWarnings = declarationApprovalWarnings(declaration, previous);
    const warnings: string[] = [...approvalWarnings];
    const values: Record<string, ReportValue> = Object.fromEntries(REPORT_COLUMNS.map(column => [column.key, column.zeroDefault ? 0 : null]));
    Object.assign(values, { serial: input.serial, name: employee.name || '', employeeCode: employee.employeeCode || '',
        pan: employee.governmentIds?.pan?.number?.trim().toUpperCase() || null, joiningDate: dateOnly(employee.joiningDate),
        leavingDate: employee.active === false ? dateOnly(employee.separationDate) : null,
        leftOrg: typeof employee.active === 'boolean' ? (employee.active ? 'No' : 'Yes') : null,
        regime: declaration?.regime === 'old' ? 'Old Regime' : declaration?.regime === 'new' ? 'New Regime' : null });
    const setPreviousDisplayValue = (key: 'previousIT' | 'previousPF' | 'previousPT' | 'previousSurcharge', value: unknown, label: string) => {
        if (value == null) return;
        if (numeric(value) && value >= 0) values[key] = money(value);
        else warnings.push(`Declared previous ${label} is invalid; displayed as zero.`);
    };
    setPreviousDisplayValue('previousIT', previous?.previousIncomeTax, 'income tax');
    setPreviousDisplayValue('previousPF', previous?.previousPF, 'PF');
    setPreviousDisplayValue('previousPT', previous?.professionalTax, 'PT');
    setPreviousDisplayValue('previousSurcharge', previous?.previousSurcharge, 'surcharge');
    const row = { employeeId: String(employee._id), values, warnings, approvalWarnings };
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(String(values.pan || ''))) warnings.push('Valid PAN is missing.');
    if (!values.joiningDate) warnings.push('Joining date is missing.');
    if (employee.active === false && !values.leavingDate) warnings.push('Inactive employee has no leaving date.');
    if (!declaration || !['old', 'new'].includes(declaration.regime)) { warnings.push('FY tax declaration/regime is missing.'); return row; }
    if (!numeric(declaration.annualGross) || declaration.annualGross < 0) { warnings.push('Annual gross salary is missing or invalid.'); return row; }
    values.gross = money(declaration.annualGross);
    const old = declaration.regime === 'old';
    const { year, start, end } = financialYearRange(financialYear);
    const joined = values.joiningDate ? new Date(String(values.joiningDate)) : start;
    const left = employee.separationDate ? new Date(employee.separationDate) : end;
    let salaryGross = 0, basic = 0, hra = 0, salaryComplete = true;
    for (let offset = 0; offset < 12; offset++) {
        const first = new Date(Date.UTC(year, 3 + offset, 1));
        const last = new Date(Date.UTC(year, 4 + offset, 0, 23, 59, 59, 999));
        if (joined > last || left < first) continue;
        const matches = salaries.filter(s => new Date(s.effectiveFrom) <= last && new Date(s.effectiveTo) >= first);
        if (matches.length !== 1) { salaryComplete = false; continue; }
        const salary = matches[0];
        const percentages = salary.salaryStructureId?.fixedEarnings;
        if (!numeric(salary.monthlyGross) || salary.monthlyGross < 0 || !numeric(percentages?.basicPercentage) || !numeric(percentages?.hraPercentage) ||
            percentages.basicPercentage < 0 || percentages.hraPercentage < 0 || percentages.basicPercentage + percentages.hraPercentage > 100) { salaryComplete = false; continue; }
        salaryGross += salary.monthlyGross;
        basic += salary.monthlyGross * percentages.basicPercentage / 100;
        hra += salary.monthlyGross * percentages.hraPercentage / 100;
    }
    if (salaryComplete && Math.abs(salaryGross - declaration.annualGross) <= 1) {
        values.basic = money(basic); values.hraReceived = money(hra);
    } else warnings.push('Basic/HRA breakdown unavailable: salary history is missing, overlaps, or does not reconcile to the FY annual gross.');
    if (joined.getUTCDate() !== 1 || (left < end && left.getUTCDate() !== new Date(Date.UTC(left.getUTCFullYear(), left.getUTCMonth() + 1, 0)).getUTCDate())) warnings.push('Partial employment month: annual projection follows existing tax declaration; no new payroll proration is applied.');

    const verified = declaration.declarations.filter(d => d.status === 'verified');
    const eligible = (d: typeof verified[number]): number => {
        if (!numeric(d.verifiedAmount) || d.verifiedAmount < 0) throw new Error('A verified deduction has an invalid amount.');
        if (d.maxLimit != null && (!numeric(d.maxLimit) || d.maxLimit < 0)) throw new Error('A verified deduction has an invalid limit.');
        return d.maxLimit && d.maxLimit > 0 ? Math.min(d.verifiedAmount, d.maxLimit) : d.verifiedAmount;
    };
    try {
        const hraItems = declaration.declarations.filter(d => ['1013A', '10A13A'].includes(section(d.section)));
        const rentEntries = hraItems.flatMap(d => d.rentDetails || []);
        if (rentEntries.some(rent => !numeric(rent.amount) || rent.amount < 0)) {
            warnings.push('Declared annual rent is unavailable: a rent entry is missing or invalid.');
        } else if (rentEntries.length) {
            values.rent = money(rentEntries.reduce((total, rent) => total + rent.amount, 0));
        }
        const hraExemption = old ? money(verified.filter(d => ['1013A', '10A13A'].includes(section(d.section))).reduce((total, d) => total + eligible(d), 0)) : 0;
        if (old) { values.hraExemption = hraExemption; values.exemptions = hraExemption; }
        let previousGross = 0;
        if (previous?.status === 'Verified') {
            if (!numeric(previous.salaryEarned) || previous.salaryEarned < 0) throw new Error('Final tax unavailable: previous-employer salary is missing or invalid.');
            previousGross = previous.salaryEarned;
            values.previousIncome = money(previousGross);
            if (previousGross > 0) warnings.push('Annual tax includes previous-employer salary in this report only. Paid-tax, balance and recovery columns are requested zero placeholders, not a payroll reconciliation.');
        } else if (previous) throw new Error('Final tax unavailable until Form 12B is verified. Unverified Form 12B amounts are excluded.');
        else if (declaration.isForm12BApplicable) throw new Error('Final tax unavailable: required Form 12B is missing.');
        values.afterExemption = money(Math.max(0, declaration.annualGross + previousGross - hraExemption));
        if (!slab || !numeric(slab.standardDeduction) || slab.standardDeduction < 0) throw new Error('Active FY tax slab / standard deduction is missing or ambiguous.');
        values.standardDeduction = slab.standardDeduction;
        if (old && (!numeric(declaration.ptDeduction) || declaration.ptDeduction < 0)) throw new Error('Annual professional tax is missing or invalid.');
        const pt = old ? declaration.ptDeduction! : 0;
        if (old) values.pt = pt;
        values.section16 = money(slab.standardDeduction + pt);
        values.salaryIncome = money(Math.max(0, Number(values.afterExemption) - Number(values.section16)));
        const propertyItems = old ? verified.filter(d => ['INCOMELOSSHOUSEPROPERTY', '24B'].includes(section(d.section))) : [];
        if (propertyItems.some(d => d.type !== 'income' && d.type !== 'loss')) throw new Error('House-property declaration must specify income or loss.');
        const otherIncome = money(propertyItems.reduce((total, d) => {
            if (!numeric(d.verifiedAmount)) throw new Error('Verified house-property amount is invalid.');
            // The existing declaration stores the sign separately in type. A deduction
            // ceiling must never reduce positive taxable property income.
            const amount = Math.abs(d.verifiedAmount);
            return total + (d.type === 'income' ? amount : -amount);
        }, 0));
        if (old) values.otherIncome = Math.max(-200_000, otherIncome);
        values.gti = money(Math.max(0, Number(values.salaryIncome) + (old ? Number(values.otherIncome) : 0)));
        const sections = old ? ['80C', '80D', '80DD', '80E', '80GG', '80CCD2'] : ['80CCD2'];
        values.chapterVIA = money(sections.reduce((total, key) => {
            const sum = verified.filter(d => section(d.section) === key).reduce((n, d) => n + eligible(d), 0);
            return total + (key === '80C' ? Math.min(sum, 150_000) : sum);
        }, 0));
        const unsupported = verified.filter(d => !sections.includes(section(d.section)) && !['1013A', '10A13A', 'INCOMELOSSHOUSEPROPERTY', '24B'].includes(section(d.section)) && eligible(d) > 0);
        if (unsupported.length) warnings.push(`Verified sections excluded by this report specification/regime: ${[...new Set(unsupported.map(d => d.section))].join(', ')}.`);
        values.taxable = money(Math.max(0, Number(values.gti) - Number(values.chapterVIA)));
        values.roundedTaxable = values.taxable;
        if (previous?.status === 'Verified') {
            if (numeric(previous.salaryEarned) && previous.salaryEarned >= 0) values.previousIncome = money(previous.salaryEarned);
            else warnings.push('Previous salary is missing or invalid.');
            if (!numeric(previous.salaryEarned) || previous.salaryEarned < 0 || previous.salaryEarned > 5_000_000) warnings.push('Previous TDS split requires confirmed salary/surcharge information.');
            else if (numeric(previous.tdsDeducted) && previous.tdsDeducted >= 0) {
                const split = splitPreviousTds(previous.tdsDeducted);
                values.previousTax = split.incomeTax; values.previousCess = split.cess;
            } else warnings.push('Previous TDS is missing or invalid.');
        } else if (previous) warnings.push('Unverified Form 12B amounts are excluded.');
        if (previous && previous.status !== 'Verified') throw new Error('Final tax unavailable until Form 12B is verified.');
        if (previous?.status === 'Verified' && (!numeric(previous.salaryEarned) || previous.salaryEarned < 0)) throw new Error('Final tax unavailable: previous-employer salary is missing or invalid.');
        Object.assign(values, calculateReportTax(Number(values.taxable), declaration.regime, financialYear, slab));
        if (declaration.isMigrationAdjusted) warnings.push('Migration-adjusted declaration: this PDF calculation does not replace the existing migration tax liability or deduction schedule.');
        const stored = declaration.initialTaxBreakdown?.taxWithCess;
        if (numeric(stored) && Math.abs(stored - Number(values.totalTax)) > 1) warnings.push('PDF calculation differs from the stored tax calculation; existing tax and payroll values are unchanged.');
    } catch (error) { warnings.push((error as Error).message); }
    return row;
}

export function visibleReportColumns(_rows: ReportRow[]): ReportColumn[] {
    return [...REPORT_COLUMNS];
}
