/** Replace declared EPF with actual employee payroll contributions, once per report. */
export interface ReportDeduction { name: string; section: string; gross: number; approved: number; }
const normalize = (value: unknown) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function isReportEpf(item: { section: string; subSection?: string; description?: string; name?: string }): boolean {
    if (normalize(item.section) !== '80C') return false;
    return [item.subSection, item.description, item.name].some(value => ['EPF', 'PF', 'EMPLOYEEPROVIDENTFUND', 'EMPLOYEEPROVIDENTFUNDEPF', 'EMPLOYEESPROVIDENTFUND', 'EMPLOYEESPROVIDENTFUNDEPF', 'PROVIDENTFUND'].includes(normalize(value)));
}
export function withActualEpf(items: ReportDeduction[], actual: number): ReportDeduction[] {
    const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const pf = typeof actual === 'number' && Number.isFinite(actual) ? Math.max(0, money(actual)) : 0;
    const index = items.findIndex(isReportEpf);
    const others = items.filter(item => !isReportEpf(item));
    if (index < 0 && pf === 0) return others;
    const used = others.filter(item => ['80C', '80CCC', '80CCD1'].includes(normalize(item.section))).reduce((total, item) => total + item.approved, 0);
    const epf = { name: 'EPF', section: '80C', gross: pf, approved: money(Math.min(pf, Math.max(0, 150000 - used))) };
    if (index < 0) return [...others, epf];
    const result: ReportDeduction[] = [];
    let added = false;
    for (const item of items) {
        if (!isReportEpf(item)) result.push(item);
        else if (!added) { result.push(epf); added = true; }
    }
    return result;
}
