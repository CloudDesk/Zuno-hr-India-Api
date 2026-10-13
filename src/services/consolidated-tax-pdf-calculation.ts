import { reportHraExemption } from './consolidated-hra-exemption';
import { payrollMonthEarnings } from './consolidated-payroll-earnings';
import { financialYearRange, money, projectFinancialYearPT, SalarySource } from './consolidated-tax-calculation';

export interface PdfMonth { label: string; gross: number; basic: number; hra: number; allowance: number; da: number; travelAllowance: number; airTicketAllowance: number; medicalAllowance: number; reimbursementAllowance: number; pf: number; pt: number; it: number; deductionsTotal: number; }
export interface PdfEmployee {
    id: string; name: string; code: string; pan: string; location: string; gender: string; residentialStatus: string; birth: string; age: string;
    joined: string; left: string; regime: string; months: PdfMonth[]; deductions: Array<{ name: string; section: string; gross: number; approved: number }>;
    gross: number; rent: number; basic: number; hraReceived: number; hraComparison: number; rentLessBasic: number; hraExemption: number;
    previousIncome: number; previousIT: number; previousPF: number; previousPT: number; previousCess: number;
    afterExemption: number; standard: number; pt: number; section16: number; salaryIncome: number; otherIncome: number;
    gti: number; chapterVIA: number; taxable: number; incomeTax: number; cess: number; totalTax: number; warnings: string[];
}
export const pdfNumber = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? money(value) : 0;
const positive = (value: unknown): number => Math.max(0, pdfNumber(value));
const normalize = (value: unknown): string => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hraSection = (value: unknown): boolean => ['1013A', '10A13A'].includes(normalize(value));
const propertySection = (value: unknown): boolean => ['INCOMELOSSHOUSEPROPERTY', '24B'].includes(normalize(value));
const indiaDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const date = (value: unknown): string => {
    const parsed = new Date(String(value || ''));
    if (!Number.isFinite(parsed.getTime())) return '-';
    const parts = indiaDateFormatter.formatToParts(parsed);
    const part = (type: string): string => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
};
function approved(item: any): number {
    if (item.status !== 'verified') return 0;
    const amount = positive(item.verifiedAmount);
    return Number.isFinite(item.maxLimit) && item.maxLimit > 0 ? Math.min(amount, item.maxLimit) : amount;
}

/** PDF-only report. Reads source values without changing declarations, payroll or Excel. */
export function buildPdfEmployee(user: any, declaration: any, salaries: SalarySource[], payrolls: any[], forms: any[], pan: string, financialYear: string): PdfEmployee {
    const { year, start, end } = financialYearRange(financialYear);
    const warnings: string[] = [];
    const old = declaration?.regime === 'old';
    const validRegime = old || declaration?.regime === 'new';
    if (!validRegime) warnings.push('FY tax declaration is unavailable; tax amounts are displayed as zero.');
    const day = (value: Date | string): number => Math.floor(Date.parse(date(value)) / 86400000);
    const joined = day(user.joiningDate || start), left = day(user.separationDate || end);
    const validEmployment = Number.isFinite(joined) && Number.isFinite(left) && joined <= left;
    if (!validEmployment) warnings.push('Employment dates are invalid; earnings are displayed as zero.');
    const validSalaries = salaries.filter(s => s && Number.isFinite(day(s.effectiveFrom)) && Number.isFinite(day(s.effectiveTo)) && day(s.effectiveFrom) <= day(s.effectiveTo) && Number.isFinite(s.monthlyGross) && s.monthlyGross >= 0);
    if (validSalaries.length !== salaries.length) warnings.push('Invalid salary assignments are excluded from PDF professional-tax projection.');
    const months: PdfMonth[] = Array.from({ length: 12 }, (_, offset) => {
        const first = new Date(Date.UTC(year, 3 + offset, 1)), last = new Date(Date.UTC(year, 4 + offset, 0));
        const from = Math.max(day(first), joined), to = Math.min(day(last), left);
        return { label: monthFormatter.format(first), ...payrollMonthEarnings(payrolls, first.getUTCFullYear(), first.getUTCMonth() + 1, validEmployment && from <= to, warnings) };
    });
    const sum = (key: keyof PdfMonth): number => money(months.reduce((total, m) => total + Number(m[key]), 0));
    const items: any[] = Array.isArray(declaration?.declarations) ? declaration.declarations.filter((item: any) => item && typeof item === 'object') : [];
    const hraItems = items.filter(d => hraSection(d.section));
    const rent = money(hraItems.flatMap(d => d.rentDetails || []).reduce((total: number, r: any) => total + positive(r.amount), 0));
    const verifiedHra = hraItems.filter(item => item.status === 'verified');
    const previous = forms.length === 1 && ['verified', 'Verified'].includes(String(forms[0]?.status)) ? forms[0] : undefined;
    if (forms.length && !previous) warnings.push('Previous employer amounts are unverified or ambiguous; displayed as zero.');
    const previousIncome = positive(previous?.salaryEarned);
    const previousIT = previous ? money(positive(previous.tdsDeducted) / 1.04) : 0;
    const previousPT = old ? positive(previous?.professionalTax) : 0;
    const previousPF = positive(previous?.previousPF);
    const deductions = old ? items.filter(d => normalize(d.section).startsWith('80')).map(d => ({
        name: String(d.subSection || d.description || d.section), section: String(d.section), gross: positive(d.declaredAmount), approved: approved(d),
    })) : [];
    const gross = sum('gross'), basic = money(sum('basic') + sum('da')), hraReceived = sum('hra');
    const rentEntries = verifiedHra.flatMap(item => item.rentDetails || []);
    const validRent = rentEntries.length > 0 && rentEntries.every(entry => typeof entry?.amount === 'number' && Number.isFinite(entry.amount) && entry.amount >= 0);
    const exemptionRent = validRent ? money(rentEntries.reduce((total, entry) => total + entry.amount, 0)) : null;
    const hraExemption = old && verifiedHra.length ? reportHraExemption(basic, hraReceived, exemptionRent, user.location) : 0;
    if (old && verifiedHra.length && !validRent) warnings.push('Verified annual rent details are unavailable; HRA exemption is displayed as zero.');
    const standard = validRegime ? old ? 50000 : 75000 : 0;
    let pt = 0;
    if (old) {
        try { pt = projectFinancialYearPT({ ...user, joiningDate: user.joiningDate ? date(user.joiningDate) : undefined, separationDate: user.separationDate ? date(user.separationDate) : undefined }, validSalaries.map(s => ({ ...s, effectiveFrom: date(s.effectiveFrom), effectiveTo: date(s.effectiveTo) })), financialYear) ?? (Number.isFinite(declaration?.ptDeduction) && declaration.ptDeduction >= 0 ? declaration.ptDeduction : sum('pt')); }
        catch (error) { pt = positive(declaration?.ptDeduction); warnings.push((error as Error).message); }
    }
    const afterExemption = money(gross - hraExemption + previousIncome), section16 = money(standard + pt);
    const salaryIncome = money(afterExemption - section16);
    let otherIncome = 0;
    if (old) for (const item of items.filter(d => d.status === 'verified' && propertySection(d.section))) {
        if (!['income', 'loss'].includes(item.type)) { warnings.push('House-property entry has no income/loss type; displayed as zero.'); continue; }
        otherIncome += (item.type === 'loss' ? -1 : 1) * positive(Math.abs(pdfNumber(item.verifiedAmount)));
    }
    otherIncome = money(otherIncome);
    const gti = money(salaryIncome + otherIncome), chapterVIA = money(deductions.reduce((total, d) => total + d.approved, 0));
    const taxable = money(Math.max(0, gti - chapterVIA));
    // Section N follows the selected FY's Tax Calculation Summary, as requested.
    const summary = declaration?.initialTaxBreakdown;
    const incomeTax = positive(summary?.totalTaxAmount), cess = positive(summary?.cessAmount);
    const totalTax = declaration?.isMigrationAdjusted && declaration?.migrationAdjustment
        ? positive(declaration.migrationAdjustment.totalMigratedTaxLiability) : positive(summary?.finalTaxWithCess);
    if (summary && !declaration?.isMigrationAdjusted && !Number.isFinite(summary.finalTaxWithCess)) warnings.push('Final Tax Payable is unavailable in the FY summary; displayed as zero.');
    if (summary && Number.isFinite(summary.taxableIncome) && Math.abs(taxable - summary.taxableIncome) > 1) warnings.push('PDF taxable-income projection differs from the stored FY summary; Section N follows the existing Tax Calculation Summary.');
    if (!summary && validRegime) warnings.push(declaration?.isMigrationAdjusted && declaration?.migrationAdjustment
        ? 'Tax Calculation Summary is unavailable; income tax and cess display zero while the migrated final liability is retained.' : 'Tax Calculation Summary is unavailable; Section N displays zero.');
    const birth = date(user.dateOfBirth);
    let age = '-';
    if (birth !== '-') {
        const born = new Date(birth); let years = end.getUTCFullYear() - born.getUTCFullYear();
        if (end.getUTCMonth() < born.getUTCMonth() || (end.getUTCMonth() === born.getUTCMonth() && end.getUTCDate() < born.getUTCDate())) years--;
        age = years >= 0 ? `${years} years` : '-';
    }
    return { id: String(user._id), name: String(user.name || ''), code: String(user.employeeCode || ''), pan: pan || '-',
        location: String(user.location || '-'), gender: String(user.gender || '-'), residentialStatus: String(user.residentialStatus || '-'), birth, age,
        joined: date(user.joiningDate), left: date(user.separationDate), regime: validRegime ? old ? 'OLD' : 'NEW' : '-', months, deductions,
        gross, rent, basic, hraReceived, hraComparison: money(basic * (/chennai|mumbai|delhi|kolkata/i.test(String(user.location || '')) ? .5 : .4)),
        rentLessBasic: money(Math.max(0, rent - basic * .1)), hraExemption,
        previousIncome, previousIT, previousPF, previousPT, previousCess: money(previousIT * .04),
        afterExemption, standard, pt, section16, salaryIncome, otherIncome, gti, chapterVIA, taxable, incomeTax, cess, totalTax,
        warnings: [...new Set(warnings)] };
}
