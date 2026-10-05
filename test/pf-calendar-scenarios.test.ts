import { calculatePfWageBase, PfCeilingPeriod } from '../src/utils/pf-wage-base';

const schedule: PfCeilingPeriod[] = [
    { ceiling: 15000, effectiveFrom: '2026-08-01', effectiveTo: '2026-09-16' },
    { ceiling: 25000, effectiveFrom: '2026-09-17', effectiveTo: '2027-01-15' },
    { ceiling: 30000, effectiveFrom: '2027-01-16' },
];

const scenarios = [
    { label: 'August full month', month: 8, year: 2026, portions: [[15000, 31]], days: 31 },
    { label: 'September transition', month: 9, year: 2026, portions: [[15000, 16], [25000, 14]], days: 30 },
    { label: 'October full month', month: 10, year: 2026, portions: [[25000, 31]], days: 31 },
    { label: 'Future January transition', month: 1, year: 2027, portions: [[25000, 15], [30000, 16]], days: 31 },
    { label: 'Future February full month', month: 2, year: 2027, portions: [[30000, 28]], days: 28 },
    { label: 'Future September uses saved revision', month: 9, year: 2030, portions: [[30000, 30]], days: 30 },
];

describe.each(scenarios)('$label', ({ month, year, portions, days }) => {
    it.each([0, 12000, 15000, 20000, 25000, 30000, 40000])('calculates base and 12%%/13%% contributions for earned wage %s', wage => {
        const expected = portions.reduce((sum, [ceiling, count]) => sum + Math.min(wage, ceiling) * count, 0) / days;
        const base = calculatePfWageBase(wage, month, year, Math.min(wage, 15000), schedule);
        expect(base).toBeCloseTo(expected, 8);
        expect(Number((base * 0.12).toFixed(2))).toBe(Number((expected * 0.12).toFixed(2)));
        expect(Number((base * 0.13).toFixed(2))).toBe(Number((expected * 0.13).toFixed(2)));
    });
    it.each([-0.01, NaN, Infinity, -Infinity])('rejects invalid wage %s', wage => {
        expect(() => calculatePfWageBase(wage, month, year, 15000, schedule)).toThrow('Invalid PF wage');
    });
    it('fails when configuration expires before the end of this month', () => {
        const from = `${year}-${String(month).padStart(2, '0')}-01`;
        const until = `${year}-${String(month).padStart(2, '0')}-15`;
        expect(() => calculatePfWageBase(40000, month, year, 15000, [
            { ceiling: 25000, effectiveFrom: from, effectiveTo: until },
        ])).toThrow('No PF ceiling configured');
    });
});

it('does not mutate the saved order, dates or ceilings during calculation', () => {
    const saved = Object.freeze(schedule.map(p => Object.freeze({ ...p })).reverse());
    expect(() => calculatePfWageBase(40000, 9, 2026, 15000, saved as unknown as PfCeilingPeriod[])).not.toThrow();
    expect(saved[0].effectiveFrom).toBe('2027-01-16');
});

it('a schedule starting in September preserves the exact supplied August legacy base', () => {
    expect(calculatePfWageBase(20000, 8, 2026, 20000, [
        { ceiling: 15000, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-16' },
        { ceiling: 25000, effectiveFrom: '2026-09-17' },
    ])).toBe(20000);
});
