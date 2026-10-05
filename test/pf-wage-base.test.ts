import { calculatePfWageBase as calculateConfiguredPfBase } from '../src/utils/pf-wage-base';

const periods = [{ ceiling: 15000, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-16' }, { ceiling: 25000, effectiveFrom: '2026-09-17' }];
const calculatePfWageBase = (wage: number, month: number, year: number, historicalBase: number) => calculateConfiguredPfBase(wage, month, year, historicalBase, periods);

describe('PF wage ceiling by payroll period', () => {
    it.each([-1, NaN, Infinity, -Infinity])('rejects invalid revised wage %s instead of producing an invalid deduction', wage => {
        expect(() => calculatePfWageBase(wage, 9, 2026, 15000)).toThrow('PF wage');
        expect(() => calculatePfWageBase(wage, 10, 2026, 15000)).toThrow('PF wage');
    });

    it.each([0, 13, -1, 9.5, NaN, Infinity])('rejects invalid payroll month %s', month => {
        expect(() => calculatePfWageBase(20000, month, 2026, 15000)).toThrow('payroll period');
    });

    it.each([0, -1, 2026.5, NaN, Infinity])('rejects invalid payroll year %s', year => {
        expect(() => calculatePfWageBase(20000, 9, year, 15000)).toThrow('payroll period');
    });

    it.each([
        [14999.99, 14999.99, 14999.99],
        [15000.01, 15000.004666666666, 15000.01],
        [24999.99, 19666.662, 24999.99],
        [25000.01, 19666.666666666668, 25000],
        [1000000, 19666.666666666668, 25000],
    ])('handles ceiling boundaries without prematurely rounding wage %s', (wage, september, october) => {
        expect(calculatePfWageBase(wage, 9, 2026, 15000)).toBeCloseTo(september, 8);
        expect(calculatePfWageBase(wage, 10, 2026, 15000)).toBe(october);
    });
    it.each([
        [12000, 12000, 1440, 1560],
        [15000, 15000, 1800, 1950],
        [20000, 17333.333333333332, 2080, 2253.33],
        [25000, 19666.666666666664, 2360, 2556.67],
        [30000, 19666.666666666664, 2360, 2556.67],
        [0, 0, 0, 0],
    ])('September: wage %s gives the split base and existing 12%% / 13%% contributions', (wage, base, employee, employer) => {
        const actual = calculatePfWageBase(wage, 9, 2026, 15000);
        expect(actual).toBeCloseTo(base, 8);
        expect(Number((actual * 0.12).toFixed(2))).toBe(employee);
        expect(Number((actual * 0.13).toFixed(2))).toBe(employer);
    });

    it.each([12000, 15000, 20000, 25000, 30000])('caps wage %s at 25000 in October and future years', wage => {
        for (const [month, year] of [[10, 2026], [12, 2026], [1, 2027], [9, 2027], [1, 2030]]) {
            expect(calculatePfWageBase(wage, month, year, 15000)).toBe(Math.min(wage, 25000));
        }
    });

    it.each([[8, 2026], [9, 2025], [12, 2025], [1, 2026]])('preserves each historical caller base for %s/%s', (month, year) => {
        expect(calculatePfWageBase(20000, month, year, 15000)).toBe(15000);
        // Preserve the historical payroll Basic-only ceiling check, even where DA exceeded it.
        expect(calculatePfWageBase(20000, month, year, 20000)).toBe(20000);
    });

    it('does not prorate attendance-adjusted wages a second time', () => {
        const earnedWage = 20000 * 15 / 30;
        expect(calculatePfWageBase(earnedWage, 9, 2026, earnedWage)).toBe(10000);
        expect(calculatePfWageBase(earnedWage, 10, 2026, earnedWage)).toBe(10000);
    });
});
