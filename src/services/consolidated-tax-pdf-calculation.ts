import { financialYearRange, money, projectFinancialYearPT, SalarySource } from './consolidated-tax-calculation';

export interface PdfMonth { label: string; gross: number; basic: number; hra: number; allowance: number; pf: number; pt: number; it: number; deductionsTotal: number; }
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
const date = (value: unknown): string => {
    const parsed = new Date(String(value || ''));
    if (!Number.isFinite(parsed.getTime())) return '-';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(parsed);
    const part = (type: string): string => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
};
function approved(item: any): number {
    if (item.status !== 'verified') return 0;
    const amount = positive(item.verifiedAmount);
    return Number.isFinite(item.maxLimit) && item.maxLimit > 0 ? Math.min(amount, item.maxLimit) : amount;
}

/** PDF-only projection. Reads source values without changing declarations, payroll or Excel. */
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
    if (validSalaries.length !== salaries.length) warnings.push('Invalid salary assignments are excluded from the PDF projection.');
    const history = validSalaries.map(s => ({ start: day(s.effectiveFrom), end: day(s.effectiveTo), gross: s.monthlyGross })).sort((a, b) => a.start - b.start);
    if (!history.length) warnings.push('Salary history is unavailable; earnings are displayed as zero.');
    let projectedGap = false;
    const months: PdfMonth[] = Array.from({ length: 12 }, (_, offset) => {
        const first = new Date(Date.UTC(year, 3 + offset, 1)), last = new Date(Date.UTC(year, 4 + offset, 0));
        const from = Math.max(day(first), joined), to = Math.min(day(last), left);
        let gross = 0;
        for (let current = from; validEmployment && current <= to; current++) {
            const active = history.filter(s => s.start <= current && s.end >= current);
            if (active.length > 1) { warnings.push(`Overlapping salary history for ${first.toISOString().slice(0, 7)}; monthly earnings displayed as zero.`); gross = 0; break; }
            const rate = active[0] || [...history].reverse().find(s => s.start <= current) || history[0];
            if (!active.length && rate) projectedGap = true;
            if (rate) gross += rate.gross / last.getUTCDate();
        }
        gross = money(gross);
        const payroll = payrolls.filter(p => p && !['Cancelled', 'Failed'].includes(p.status) && Number(p.year) === first.getUTCFullYear() && Number(p.month) === first.getUTCMonth() + 1)
            .sort((a, b) => (new Date(b.processedAt || 0).getTime() || 0) - (new Date(a.processedAt || 0).getTime() || 0));
        // Regular payroll duplicates are not summed; final settlement can coexist with a regular payroll.
        const regular = payroll.filter(p => !p.isFinalSettlement && p.type !== 'FinalSettlement');
        if (regular.length > 1) warnings.push(`Multiple regular payrolls for ${first.toISOString().slice(0, 7)}; latest payroll deductions used.`);
        const selected = [...regular.slice(0, 1), ...payroll.filter(p => p.isFinalSettlement || p.type === 'FinalSettlement')];
        const sum = (key: string): number => money(selected.reduce((total, p) => total + positive(p[key]), 0));
        const basic = money(gross * .4), hra = money(gross * .2);
        return { label: first.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), gross, basic, hra,
            allowance: money(gross - basic - hra), pf: sum('epfEmployee'), pt: sum('professionalTax'), it: sum('incomeTax'), deductionsTotal: money(sum('epfEmployee') + sum('professionalTax') + sum('incomeTax')) };
    });
    if (projectedGap) warnings.push('Uncovered salary dates use the nearest recorded salary rate for the FY projection.');
    const sum = (key: keyof PdfMonth): number => money(months.reduce((total, m) => total + Number(m[key]), 0));
    const items: any[] = Array.isArray(declaration?.declarations) ? declaration.declarations.filter((item: any) => item && typeof item === 'object') : [];
    const hraItems = items.filter(d => hraSection(d.section));
    const rent = money(hraItems.flatMap(d => d.rentDetails || []).reduce((total: number, r: any) => total + positive(r.amount), 0));
    const hraExemption = old ? money(hraItems.reduce((total, d) => total + approved(d), 0)) : 0;
    const previous = forms.length === 1 && ['verified', 'Verified'].includes(String(forms[0]?.status)) ? forms[0] : undefined;
    if (forms.length && !previous) warnings.push('Previous employer amounts are unverified or ambiguous; displayed as zero.');
    const previousIncome = positive(previous?.salaryEarned);
    const previousIT = previous ? money(positive(previous.tdsDeducted) / 1.04) : 0;
    const previousPT = old ? positive(previous?.professionalTax) : 0;
    const previousPF = positive(previous?.previousPF);
    const deductions = old ? items.filter(d => normalize(d.section).startsWith('80')).map(d => ({
        name: String(d.subSection || d.description || d.section), section: String(d.section), gross: positive(d.declaredAmount), approved: approved(d),
    })) : [];
    const gross = sum('gross'), basic = sum('basic'), hraReceived = sum('hra');
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
