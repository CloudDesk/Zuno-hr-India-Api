/** Read stored payroll earnings; payable-day adjustments must never be applied twice. */
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const positive = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, money(value)) : 0;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
function day(value: unknown): number {
    const parsed = new Date(String(value || ''));
    if (!Number.isFinite(parsed.getTime())) return NaN;
    const parts = dateFormatter.formatToParts(parsed);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return Date.parse(`${part('year')}-${part('month')}-${part('day')}`) / 86400000;
}
export function payrollMonthEarnings(payrolls: any[], year: number, month: number, earningsEligible: boolean, warnings: string[]) {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const payroll = payrolls.filter(p => p && !['Cancelled', 'Failed'].includes(p.status) && Number(p.year) === year && Number(p.month) === month)
        .sort((a, b) => (new Date(b.processedAt || 0).getTime() || 0) - (new Date(a.processedAt || 0).getTime() || 0));
    const regular = payroll.filter(p => !p.isFinalSettlement && p.type !== 'FinalSettlement');
    if (regular.length > 1) warnings.push(`Multiple regular payrolls for ${period}; latest payroll earnings and deductions used.`);
    const selected = [...regular.slice(0, 1), ...payroll.filter(p => p.isFinalSettlement || p.type === 'FinalSettlement')];
    const componentKeys = ['basic', 'hra', 'otherAllowance', 'da', 'travelAllowance', 'airTicketAllowance', 'medicalAllowance', 'reimbursementAllowance'];
    const earnings = earningsEligible ? selected.filter(p => {
        const valid = componentKeys.every(key => {
            const required = ['basic', 'hra', 'otherAllowance'].includes(key);
            return (!required && p[key] == null) || (typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] >= 0);
        });
        if (!valid) warnings.push(`Invalid payroll earnings for ${period}; affected record earnings displayed as zero.`);
        return valid;
    }) : [];
    if (!selected.length && earningsEligible) warnings.push(`No payroll for ${period}; monthly earnings displayed as zero.`);
    const earned = (key: string) => money(earnings.reduce((total, p) => total + positive(p[key]), 0));
    const sum = (key: string) => money(selected.reduce((total, p) => total + positive(p[key]), 0));
    const basic = earned('basic'), hra = earned('hra'), allowance = earned('otherAllowance'), da = earned('da');
    const travelAllowance = earned('travelAllowance'), airTicketAllowance = earned('airTicketAllowance'), medicalAllowance = earned('medicalAllowance'), reimbursementAllowance = earned('reimbursementAllowance');
    return { basic, hra, allowance, da, travelAllowance, airTicketAllowance, medicalAllowance, reimbursementAllowance,
        gross: money(basic + hra + allowance + da + travelAllowance + airTicketAllowance + medicalAllowance + reimbursementAllowance),
        pf: sum('epfEmployee'), pt: sum('professionalTax'), it: sum('incomeTax'), deductionsTotal: money(sum('epfEmployee') + sum('professionalTax') + sum('incomeTax')) };
}
export function actualFinancialYearEarnings(employee: { joiningDate?: Date | string; separationDate?: Date | string }, payrolls: any[], year: number) {
    const warnings: string[] = [];
    const joined = day(employee.joiningDate || new Date(Date.UTC(year, 3, 1))), left = day(employee.separationDate || new Date(Date.UTC(year + 1, 2, 31)));
    const valid = Number.isFinite(joined) && Number.isFinite(left) && joined <= left;
    if (!valid) warnings.push('Employment dates are invalid; earnings are displayed as zero.');
    const months = Array.from({length:12}, (_, offset) => {
        const first = new Date(Date.UTC(year, 3 + offset, 1)), last = new Date(Date.UTC(year, 4 + offset, 0));
        return payrollMonthEarnings(payrolls, first.getUTCFullYear(), first.getUTCMonth() + 1, valid && Math.max(day(first), joined) <= Math.min(day(last), left), warnings);
    });
    return { gross: money(months.reduce((total, month) => total + month.gross, 0)),
        basic: money(months.reduce((total, month) => total + month.basic + month.da, 0)),
        hraReceived: money(months.reduce((total, month) => total + month.hra, 0)), warnings };
}
