/** Read-only projection of the supplied Consolidated Tax Report specification.
 * This module must never update declarations, payroll, or deduction schedules.
 */
export type ReportValue = string | number | null;
export interface ReportColumn { key: string; label: string; type: 'text' | 'date' | 'money'; optional?: boolean; zeroDefault?: boolean; }
export interface ReportRow { employeeId: string; values: Record<string, ReportValue>; warnings: string[]; approvalWarnings?: string[]; form12BApplicable?: boolean; }
export interface TaxDeclarationSource {
    regime: 'old' | 'new'; annualGross: number; ptDeduction?: number;
    declarations: Array<{ section: string; status: string; verifiedAmount?: number; maxLimit?: number;
        type?: string; rentDetails?: Array<{ amount: number }> }>;
    initialTaxBreakdown?: { taxableIncome?: number; taxWithCess?: number; totalTaxAmount?: number; cessAmount?: number; rebateAmount?: number; marginalReliefAmount?: number };
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
    salaryStructureId?: { fixedEarnings?: { basicPercentage?: number; hraPercentage?: number };
        statutoryDeductions?: { professionalTax?: { term?: string; slabs: Array<{fromAmount: number; toAmount?: number | null; taxAmount: number}> } } };
}
export interface PreviousEmploymentSource {
    status?: string; salaryEarned?: number; tdsDeducted?: number;
    previousIncomeTax?: number; previousPF?: number; professionalTax?: number; previousSurcharge?: number;
}

// Preserve the existing calculation values independently of the Excel display schema.
const CALCULATION_COLUMNS: ReportColumn[] = [
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

// Preserve reference workbook order, excluding Income Tax Paid and Excess Rent as requested.
export const REPORT_COLUMNS: ReportColumn[] = CALCULATION_COLUMNS.slice(0, 36).filter(column => !['incomeTaxPaid', 'excessRent'].includes(column.key)).map(column => ({
    ...column,
    // Section 16 total and the standard deduction have separate display columns.
    key: column.key === 'standardDeduction' ? 'section16' : column.key === 'section16' ? 'standardDeduction' : column.key,
}));

export const REPORT_NOTES = [
    'The 34 selected reference Excel fields are exported in template order; P) Income Tax Paid and E) Excess Rent are omitted. Inapplicable cells are blank; confirmed calculated zero values remain numeric.',
    'Annual gross is derived from salary revisions within the FY and employment dates. Complete months use monthly gross; partial months and revisions within a month use covered calendar days. Uncovered periods use the preceding salary rate, or the earliest available rate before the first assignment. A single monthly rate therefore projects across the FY employment period. Overlapping assignments or absent salary records require review.',
    'Basic DA is 40% of report gross and HRA Received is 20%, as specified in the PDF.',
    'Only verified declaration amounts are used. HRA, total exemptions, current professional tax, previous PT and house-property income/loss apply only to the old regime.',
    'Income After Exemption is Gross Salary minus Total Exemptions. Previous-employer income is shown separately and is not added to this formula.',
    'Old-regime PT is projected using the salary structure payment frequency: monthly, half-yearly or yearly, with one installment per applicable FY period. Uncovered salary periods use the same carried rate as gross. If PT configuration is unavailable, stored annual PT is used without multiplying it.',
    'Deduction Under Section 16 displays the configured FY/regime standard deduction plus old-regime professional tax. Standard Deduction : Sec 16(ia) displays only the configured standard deduction. Chapter VI-A is the sum of approved 80C, 80D, 80DD, 80E, 80GG and 80CCD(2) amounts listed in the PDF; this report projection does not change payroll tax rules.',
    'Relief u/s 87A displays the selected FY tax summary rebateAmount plus marginalReliefAmount, or numeric zero when no value is available.',
    'Total Income Tax to be Paid uses the selected FY tax summary Net Tax after Rebate (totalTaxAmount), including zero. If unavailable, the report calculation is used where possible. Total Cess to be Paid uses the selected FY tax summary Cess Amount (cessAmount), including zero; if unavailable, it is calculated at 4% of net income tax. Total Tax sums net income tax and cess.',
    'Rounded taxable income equals taxable income. Cess is 4% of net income tax and Total Tax is income tax plus cess.',
    'Prev IT, Prev PF, Prev PT and Prev Total Income display numeric zero when missing or inapplicable. Review notes still identify missing, unverified or ambiguous sources; this display fallback does not alter tax calculations.',
    'Verified Form 12B provides previous gross, PF and old-regime PT. Missing amounts are unavailable, not assumed zero. Previous TDS is split as total / 1.04 for income tax, with the remaining amount as cess and zero surcharge below the review threshold.',
    'Total Surcharge to be Paid displays an available surcharge value, otherwise numeric zero. This display fallback does not calculate missing surcharge; the PDF does not specify rates above Rs.50 lakh and review warnings remain.',
    'Prev IT displays the income-tax component of verified previous TDS. LTA displays an available report value, otherwise numeric zero. No LTA calculation/source is defined in the supplied PDF.',
    'Leaving Date displays the saved employee separation date from confirmed Final Settlement when available, otherwise a dash. Draft settlements do not update employee separation dates.',
    'Missing Form 12B affects only previous-employment fields. Salary-history errors leave gross-dependent calculations unavailable, while valid rent, approved exemptions, deductions, configured standard deduction and PT are still shown.',
    'This is a read-only report projection. It does not update salary assignments, declarations, payroll or deduction schedules.',
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

export function projectFinancialYearGross(employee: ReportEmployee, salaries: SalarySource[], fy: string): number {
    const { year, start, end } = financialYearRange(fy);
    const day = (value: Date | string): number => Math.floor(new Date(value).getTime() / 86_400_000);
    const joined = day(employee.joiningDate || start), left = day(employee.separationDate || end);
    if (!Number.isFinite(joined) || !Number.isFinite(left) || joined > left) throw new Error('Employment dates are invalid; annual salary is unavailable.');
    const history = salaries.map(salary => ({ start: day(salary.effectiveFrom), end: day(salary.effectiveTo), gross: salary.monthlyGross }));
    if (history.some(item => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start > item.end || !numeric(item.gross) || item.gross < 0)) {
        throw new Error('Salary history contains invalid dates or amounts; annual salary is unavailable.');
    }
    if (!history.length) throw new Error('No salary assignments found for the financial year; annual salary is unavailable.');
    history.sort((a, b) => a.start - b.start);
    let gross = 0;
    for (let offset = 0; offset < 12; offset++) {
        const first = day(new Date(Date.UTC(year, 3 + offset, 1)));
        const last = day(new Date(Date.UTC(year, 4 + offset, 0)));
        const from = Math.max(first, joined), to = Math.min(last, left);
        for (let current = from; current <= to; current++) {
            const applicable = history.filter(item => item.start <= current && item.end >= current);
            if (applicable.length > 1) throw new Error('Salary history overlaps; annual salary requires reconciliation.');
            // Project uncovered days from the preceding rate. Before the first recorded
            // assignment, use its rate so a single monthly salary annualizes across the FY.
            const rate = applicable[0] || [...history].reverse().find(item => item.start <= current) || history[0];
            gross += rate.gross / (last - first + 1);
        }
    }
    return money(gross);
}

/** One configured installment per projected payment period; never multiply stored annual PT. */
export function projectFinancialYearPT(employee: ReportEmployee, salaries: SalarySource[], fy: string): number | undefined {
    if (!salaries.length || salaries.some(item => !item.salaryStructureId?.statutoryDeductions?.professionalTax?.slabs?.length)) return undefined;
    const {year, start, end} = financialYearRange(fy);
    const day = (value: Date | string) => Math.floor(new Date(value).getTime() / 86400000);
    const joined = day(employee.joiningDate || start), left = day(employee.separationDate || end);
    const history = [...salaries].sort((a, b) => day(a.effectiveFrom) - day(b.effectiveFrom));
    if (!Number.isFinite(joined) || !Number.isFinite(left) || joined > left || history.some(item =>
        !Number.isFinite(day(item.effectiveFrom)) || !Number.isFinite(day(item.effectiveTo)) ||
        day(item.effectiveFrom) > day(item.effectiveTo) || !numeric(item.monthlyGross) || item.monthlyGross < 0)) {
        throw new Error('Salary or employment dates are invalid; annual professional tax is unavailable.');
    }
    const payments = new Map<string, number>();
    for (let month = 0; month < 12; month++) {
        const first = day(new Date(Date.UTC(year, 3 + month, 1)));
        const last = day(new Date(Date.UTC(year, 4 + month, 0)));
        if (Math.max(first, joined) > Math.min(last, left)) continue;
        const current = Math.min(last, left);
        const active = history.filter(item => day(item.effectiveFrom) <= current && day(item.effectiveTo) >= current);
        if (active.length > 1) throw new Error('Salary history overlaps; annual professional tax requires reconciliation.');
        const assignment = active[0] || [...history].reverse().find(item => day(item.effectiveFrom) <= current) || history[0];
        const config = assignment.salaryStructureId!.statutoryDeductions!.professionalTax!;
        const term = config.term || 'monthly';
        if (!['monthly', 'half_yearly', 'yearly'].includes(term)) throw new Error('Professional tax payment frequency is invalid.');
        if (config.slabs.some(slab => !numeric(slab.fromAmount) || slab.fromAmount < 0 || !numeric(slab.taxAmount) || slab.taxAmount < 0 ||
            (slab.toAmount != null && (!numeric(slab.toAmount) || slab.toAmount < 0)))) throw new Error('Professional tax slabs are invalid.');
        const slab = config.slabs.find(slab => assignment.monthlyGross >= slab.fromAmount &&
            (slab.toAmount == null || slab.toAmount === 0 || assignment.monthlyGross <= slab.toAmount));
        if (!slab && config.slabs.length && assignment.monthlyGross >= Math.min(...config.slabs.map(item => item.fromAmount))) {
            throw new Error('Professional tax slab is missing for the projected salary.');
        }
        const period = term === 'monthly' ? month : term === 'half_yearly' ? Math.floor(month / 6) : 0;
        payments.set(`${term}:${period}`, slab?.taxAmount || 0);
    }
    return money([...payments.values()].reduce((total, amount) => total + amount, 0));
}

export function buildConsolidatedRow(input: {
    employee: ReportEmployee; declaration?: TaxDeclarationSource; slab?: TaxSlabSource;
    salaries: SalarySource[]; previous?: PreviousEmploymentSource; financialYear: string; serial: number; asOf?: Date;
}): ReportRow {
    const { employee, declaration: declaration, slab, salaries, previous, financialYear } = input;
    const approvalWarnings = declarationApprovalWarnings(declaration, previous);
    const warnings: string[] = [...approvalWarnings];
    const values: Record<string, ReportValue> = Object.fromEntries(CALCULATION_COLUMNS.map(column => [column.key, column.zeroDefault ? 0 : null]));
    Object.assign(values, { serial: input.serial, name: employee.name || '', employeeCode: employee.employeeCode || '',
        pan: employee.governmentIds?.pan?.number?.trim().toUpperCase() || null, joiningDate: dateOnly(employee.joiningDate),
        leavingDate: dateOnly(employee.separationDate),
        leftOrg: typeof employee.active === 'boolean' ? (employee.active ? 'No' : 'Yes') : null,
        regime: declaration?.regime === 'old' ? 'Old Regime' : declaration?.regime === 'new' ? 'New Regime' : null });
    const old = declaration?.regime === 'old';
    const form12BApplicable = Boolean(previous || declaration?.isForm12BApplicable);
    for (const key of ['previousIT', 'previousPF', 'previousPT', 'previousIncome', 'previousTax', 'previousSurcharge', 'previousCess', 'lta', 'surcharge', 'incomeTaxPaid']) values[key] = null;
    values.excessRent = 0;
    // Match the selected FY tax summary: combine rebate and marginal relief.
    const summaryRelief = [declaration?.initialTaxBreakdown?.rebateAmount, declaration?.initialTaxBreakdown?.marginalReliefAmount];
    values.rebate = money(summaryRelief.reduce<number>((total, amount) => total + (numeric(amount) && amount >= 0 ? amount : 0), 0));
    if (summaryRelief.some(amount => amount != null && (!numeric(amount) || amount < 0))) {
        warnings.push('Stored Section 87A relief contains an invalid amount; review the tax summary.');
    }
    const summaryCess = declaration?.initialTaxBreakdown?.cessAmount;
    const hasSummaryCess = numeric(summaryCess) && summaryCess >= 0;
    if (hasSummaryCess) values.cess = money(summaryCess);
    else if (summaryCess != null) warnings.push('Stored Cess Amount is invalid; review the tax summary.');
    const summaryNetTax = declaration?.initialTaxBreakdown?.totalTaxAmount;
    const hasSummaryNetTax = numeric(summaryNetTax) && summaryNetTax >= 0;
    if (hasSummaryNetTax) {
        values.incomeTax = money(summaryNetTax);
        if (!hasSummaryCess) values.cess = money(Number(values.incomeTax) * 0.04);
        values.totalTax = money(Number(values.incomeTax) + Number(values.cess));
    } else if (summaryNetTax != null) {
        warnings.push('Stored Net Tax after Rebate is invalid; review the tax summary.');
    }
    const row: ReportRow = { employeeId: String(employee._id), values, warnings, approvalWarnings, form12BApplicable };
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(String(values.pan || ''))) warnings.push('Valid PAN is missing.');
    if (!values.joiningDate) warnings.push('Joining date is missing.');
    if (employee.active === false && !values.leavingDate) warnings.push('Inactive employee has no leaving date.');
    if (previous?.status === 'Verified') {
        for (const [key, amount, label] of [
            ['previousIncome', previous.salaryEarned, 'salary'],
            ['previousPF', previous.previousPF, 'PF'],
            ...(old ? [['previousPT', previous.professionalTax, 'PT']] : []),
        ] as Array<[string, unknown, string]>) {
            if (numeric(amount) && amount >= 0) values[key] = money(amount);
            else warnings.push(`Verified Form 12B ${label} is missing or invalid; the report does not assume zero.`);
        }
        if (numeric(previous.salaryEarned) && previous.salaryEarned >= 0 && previous.salaryEarned <= 5_000_000) {
            if (numeric(previous.tdsDeducted) && previous.tdsDeducted >= 0) {
                const split = splitPreviousTds(previous.tdsDeducted);
                values.previousIT = split.incomeTax; values.previousTax = split.incomeTax; values.previousCess = split.cess; values.previousSurcharge = 0;
            } else warnings.push('Previous TDS is missing or invalid.');
        } else warnings.push('Previous TDS components require review: the specification does not define surcharge rates above Rs.50 lakh.');
    } else if (previous) warnings.push('Unverified Form 12B amounts are excluded.');
    else if (form12BApplicable) warnings.push('Required Form 12B is missing; previous-employment fields are unavailable.');

    try {
        values.gross = projectFinancialYearGross(employee, salaries, financialYear);
        values.basic = money(Number(values.gross) * 0.40);
        values.hraReceived = money(Number(values.gross) * 0.20);
    } catch (error) { warnings.push((error as Error).message); }
    if (!declaration || !['old', 'new'].includes(declaration.regime)) { warnings.push('FY tax declaration/regime is missing.'); return row; }
    if (numeric(values.gross) && (!numeric(declaration.annualGross) || Math.abs(values.gross - declaration.annualGross) > 1)) {
        warnings.push('FY salary history differs from stored declaration gross; this report uses salary history without changing the declaration.');
    }

    const processed = (declaration.monthlyDeductions || []).filter(item => item.isProcessed && item.financialYear === financialYear);
    if (processed.some(item => !numeric(item.actualDeduction) || item.actualDeduction < 0) || new Set(processed.map(item => item.month)).size !== processed.length) {
        warnings.push('Processed FY deductions are invalid or duplicated; Income Tax Paid is unavailable.');
    } else {
        values.incomeTaxPaid = splitPreviousTds(processed.reduce((total, item) => total + item.actualDeduction, 0)).incomeTax;
    }
    const verified = declaration.declarations.filter(d => d.status === 'verified');
    const eligible = (d: typeof verified[number]): number => {
        if (!numeric(d.verifiedAmount) || d.verifiedAmount < 0) throw new Error('A verified deduction has an invalid amount.');
        if (d.maxLimit != null && (!numeric(d.maxLimit) || d.maxLimit < 0)) throw new Error('A verified deduction has an invalid limit.');
        return d.maxLimit && d.maxLimit > 0 ? Math.min(d.verifiedAmount, d.maxLimit) : d.verifiedAmount;
    };
    // Compute independent source fields separately. A failure must only block its dependants.
    const attempt = (calculate: () => void): void => {
        try { calculate(); } catch (error) { warnings.push((error as Error).message); }
    };
    attempt(() => {
        const hraItems = declaration.declarations.filter(d => ['1013A', '10A13A'].includes(section(d.section)));
        const rentEntries = hraItems.flatMap(d => d.rentDetails || []);
        if (rentEntries.some(rent => !numeric(rent.amount) || rent.amount < 0)) {
            warnings.push('Declared annual rent is unavailable: a rent entry is missing or invalid.');
        } else if (rentEntries.length) {
            values.rent = money(rentEntries.reduce((total, rent) => total + rent.amount, 0));
        }
    });
    if (old) attempt(() => {
        const hra = money(verified.filter(d => ['1013A', '10A13A'].includes(section(d.section))).reduce((total, d) => total + eligible(d), 0));
        values.hraExemption = hra; values.exemptions = hra; values.excessRent = hra;
    });
    attempt(() => {
        if (!slab || !numeric(slab.standardDeduction) || slab.standardDeduction < 0) throw new Error('Active FY tax slab / standard deduction is missing or ambiguous.');
        values.standardDeduction = slab.standardDeduction;
    });
    if (old) attempt(() => {
        const projectedPT = projectFinancialYearPT(employee, salaries, financialYear);
        if (projectedPT !== undefined) values.pt = projectedPT;
        else {
            if (!numeric(declaration.ptDeduction) || declaration.ptDeduction < 0) throw new Error('Annual professional tax is missing or invalid.');
            values.pt = declaration.ptDeduction;
        }
    });
    if (old) attempt(() => {
        const propertyItems = verified.filter(d => ['INCOMELOSSHOUSEPROPERTY', '24B'].includes(section(d.section)));
        if (propertyItems.some(d => d.type !== 'income' && d.type !== 'loss')) throw new Error('House-property declaration must specify income or loss.');
        values.otherIncome = money(propertyItems.reduce((total, d) => {
            if (!numeric(d.verifiedAmount)) throw new Error('Verified house-property amount is invalid.');
            return total + (d.type === 'income' ? Math.abs(d.verifiedAmount) : -Math.abs(d.verifiedAmount));
        }, 0));
    });
    const sections = ['80C', '80D', '80DD', '80E', '80GG', '80CCD2'];
    attempt(() => {
        values.chapterVIA = money(verified.filter(d => sections.includes(section(d.section))).reduce((total, d) => total + eligible(d), 0));
    });
    attempt(() => {
        const unsupported = verified.filter(d => !sections.includes(section(d.section)) && !['1013A', '10A13A', 'INCOMELOSSHOUSEPROPERTY', '24B'].includes(section(d.section)) && eligible(d) > 0);
        if (unsupported.length) warnings.push(`Verified sections excluded by this report specification/regime: ${[...new Set(unsupported.map(d => d.section))].join(', ')}.`);
    });

    if (numeric(values.gross) && (!old || numeric(values.exemptions))) {
        values.afterExemption = money(values.gross - (old ? Number(values.exemptions) : 0));
    }
    if (numeric(values.standardDeduction) && (!old || numeric(values.pt))) {
        values.section16 = money(values.standardDeduction + (old ? Number(values.pt) : 0));
    }
    if (numeric(values.afterExemption) && numeric(values.section16)) {
        values.salaryIncome = money(values.afterExemption - values.section16);
    }
    if (numeric(values.salaryIncome) && (!old || numeric(values.otherIncome))) {
        values.gti = money(values.salaryIncome + (old ? Number(values.otherIncome) : 0));
    }
    if (!numeric(values.gti) || !numeric(values.chapterVIA)) return row;
    try {
        values.taxable = money(Math.max(0, Number(values.gti) - Number(values.chapterVIA)));
        values.roundedTaxable = values.taxable;
        const calculated = calculateReportTax(Number(values.taxable), declaration.regime, financialYear, slab!);
        if (!hasSummaryNetTax) {
            values.incomeTax = calculated.incomeTax;
            if (!hasSummaryCess) values.cess = calculated.cess;
            values.totalTax = money(Number(values.incomeTax) + Number(values.cess));
        } else if (Math.abs(calculated.incomeTax - Number(values.incomeTax)) > 1) {
            warnings.push('Projected salary tax differs from Net Tax after Rebate in the stored FY summary; exported tax amounts use the summary.');
        }
        values.surcharge = 0;
        if (declaration.isMigrationAdjusted) warnings.push('Migration-adjusted declaration: this PDF calculation does not replace the existing migration tax liability or deduction schedule.');
        const stored = declaration.initialTaxBreakdown?.taxWithCess;
        if (numeric(stored) && Math.abs(stored - Number(values.totalTax)) > 1) warnings.push('PDF calculation differs from the stored tax calculation; existing tax and payroll values are unchanged.');
    } catch (error) { warnings.push((error as Error).message); }
    return row;
}

export function visibleReportColumns(_rows: ReportRow[]): ReportColumn[] {
    return [...REPORT_COLUMNS];
}
