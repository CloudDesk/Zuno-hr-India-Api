export interface PfCeilingPeriod {
    ceiling: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
}

const DAY = 86400000;
function dateValue(value: string): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('PF dates must use YYYY-MM-DD');
    const parsed = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('Invalid PF date');
    return parsed;
}

/** Expiry dates are inclusive. Only the final period may be open-ended. */
export function validatePfCeilingPeriods(periods: PfCeilingPeriod[] = []): void {
    if (!Array.isArray(periods)) throw new Error('PF ceiling periods must be a list');
    const sorted = periods.map(period => {
        if (!period || !Number.isFinite(period.ceiling) || period.ceiling < 0) throw new Error('PF ceiling must be a finite non-negative amount');
        const from = dateValue(period.effectiveFrom);
        const to = period.effectiveTo ? dateValue(period.effectiveTo) : Infinity;
        if (to < from) throw new Error('PF expiry date cannot precede its effective date');
        return { from, to };
    }).sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from <= sorted[i - 1].to) throw new Error('PF ceiling periods cannot overlap');
        if (sorted[i].from !== sorted[i - 1].to + DAY) throw new Error('PF ceiling periods must be continuous without gaps');
    }
}

/** Uses earned Basic + DA once. Rates, EPS and rounding remain with callers.
 * No schedule (or dates before its start) preserves the caller's legacy base.
 */
export function calculatePfWageBase(
    wage: number, month: number, year: number, historicalBase: number,
    periods: PfCeilingPeriod[] = [],
): number {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 100 || year > 9999) {
        throw new Error('Invalid PF payroll period');
    }
    validatePfCeilingPeriods(periods);
    if (!periods.length) return historicalBase;
    const sorted = [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const start = Date.UTC(year, month - 1, 1);
    const end = Date.UTC(year, month, 1);
    if (end <= dateValue(sorted[0].effectiveFrom)) return historicalBase;
    if (!Number.isFinite(wage) || wage < 0) throw new Error('Invalid PF wage: Basic + DA must be a finite, non-negative amount');
    const days = (end - start) / DAY;
    const daysByBase = new Map<number, number>();
    for (let day = start; day < end; day += DAY) {
        const period = sorted.find(p => dateValue(p.effectiveFrom) <= day && (!p.effectiveTo || dateValue(p.effectiveTo) >= day));
        let base: number;
        if (period) base = Math.min(wage, period.ceiling);
        else if (day < dateValue(sorted[0].effectiveFrom)) base = historicalBase;
        else throw new Error('No PF ceiling configured for ' + new Date(day).toISOString().slice(0, 10));
        daysByBase.set(base, (daysByBase.get(base) ?? 0) + 1);
    }
    return [...daysByBase].reduce((sum, [base, count]) => sum + base * (count / days), 0);
}
