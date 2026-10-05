import { calculatePfWageBase, validatePfCeilingPeriods, PfCeilingPeriod } from '../src/utils/pf-wage-base';
import { SalaryStructure } from '../src/models/salary-structure.model';
import { SalaryStructureService } from '../src/services/salary-structure.service';

const periods: PfCeilingPeriod[] = [
    { ceiling: 17000, effectiveFrom: '2028-02-01', effectiveTo: '2028-02-10' },
    { ceiling: 29000, effectiveFrom: '2028-02-11' },
];
const fixture = () => ({ name: 'Configurable PF', country: 'IN',
    fixedEarnings: { basicPercentage: 50, hraPercentage: 20, daPercentage: 0, otherAllowancePercentage: 30 },
    statutoryDeductions: {
        epf: { employeeContribution: 12, employerContribution: 13, maxLimit: 15000, ceilingPeriods: periods },
        esi: { employeeContribution: 0.75, employerContribution: 3.25, applicabilityLimit: 21000 },
        professionalTax: { state: 'TN', term: 'monthly', slabs: [] },
    },
});

describe('configurable PF schedules', () => {
    afterEach(() => jest.restoreAllMocks());
    it('uses arbitrary amounts and counts leap-year days automatically', () => {
        expect(calculatePfWageBase(40000, 2, 2028, 15000, periods)).toBeCloseTo((17000 * 10 + 29000 * 19) / 29, 8);
        expect(calculatePfWageBase(40000, 3, 2028, 15000, periods)).toBe(29000);
    });
    it('preserves the existing base without a schedule or before the first effective date', () => {
        expect(calculatePfWageBase(40000, 10, 2026, 15000)).toBe(15000);
        expect(calculatePfWageBase(40000, 1, 2028, 14000, periods)).toBe(14000);
    });
    it('applies an August start across August, the September split and October', () => {
        const schedule = [
            { ceiling: 15000, effectiveFrom: '2026-08-01', effectiveTo: '2026-09-16' },
            { ceiling: 25000, effectiveFrom: '2026-09-17' },
        ];
        expect(calculatePfWageBase(40000, 7, 2026, 14000, schedule)).toBe(14000);
        expect(calculatePfWageBase(40000, 8, 2026, 14000, schedule)).toBe(15000);
        expect(calculatePfWageBase(40000, 9, 2026, 14000, schedule)).toBeCloseTo(19666.666666666668, 8);
        expect(calculatePfWageBase(40000, 10, 2026, 14000, schedule)).toBe(25000);
    });
    it('uses 31 days when the revision is configured within August', () => {
        const schedule = [
            { ceiling: 15000, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-16' },
            { ceiling: 25000, effectiveFrom: '2026-08-17' },
        ];
        expect(calculatePfWageBase(40000, 8, 2026, 15000, schedule))
            .toBeCloseTo((15000 * 16 + 25000 * 15) / 31, 8);
        expect(calculatePfWageBase(40000, 9, 2026, 15000, schedule)).toBe(25000);
    });
    it('supports a mid-month first revision using the legacy base for preceding days', () => {
        expect(calculatePfWageBase(40000, 1, 2030, 15000, [{ ceiling: 31000, effectiveFrom: '2030-01-16' }]))
            .toBeCloseTo((15000 * 15 + 31000 * 16) / 31, 8);
    });
    it('supports multiple revisions and zero ceiling, irrespective of input order', () => {
        const schedule = [
            { ceiling: 10000, effectiveFrom: '2027-02-01', effectiveTo: '2027-02-07' },
            { ceiling: 20000, effectiveFrom: '2027-02-08', effectiveTo: '2027-02-21' },
            { ceiling: 0, effectiveFrom: '2027-02-22' },
        ];
        expect(calculatePfWageBase(40000, 2, 2027, 15000, schedule.reverse())).toBe(12500);
    });
    it('treats expiry as inclusive and fails when a subsequent period is missing', () => {
        const schedule = [{ ceiling: 18000, effectiveFrom: '2029-04-01', effectiveTo: '2029-04-30' }];
        expect(calculatePfWageBase(40000, 4, 2029, 15000, schedule)).toBe(18000);
        expect(() => calculatePfWageBase(40000, 5, 2029, 15000, schedule)).toThrow('No PF ceiling configured');
    });
    it.each([
        [{ ceiling: -1, effectiveFrom: '2026-01-01' }],
        [{ ceiling: NaN, effectiveFrom: '2026-01-01' }],
        [{ ceiling: 1, effectiveFrom: '2026-02-30' }],
        [{ ceiling: 1, effectiveFrom: '' }],
        [{ ceiling: 1, effectiveFrom: '2026-02-01', effectiveTo: '2026-01-31' }],
        [{ ceiling: 1, effectiveFrom: '2026-01-01' }, { ceiling: 2, effectiveFrom: '2026-02-01' }],
        [{ ceiling: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-15' }, { ceiling: 2, effectiveFrom: '2026-01-15' }],
        [{ ceiling: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-15' }, { ceiling: 2, effectiveFrom: '2026-01-17' }],
    ])('rejects malformed, overlapping or gapped configuration %#', (...schedule) => {
        expect(() => validatePfCeilingPeriods(schedule)).toThrow();
    });
    it('retains dates and ceilings through the Mongoose schema', async () => {
        const doc = new SalaryStructure(fixture());
        await doc.validate();
        expect(doc.toObject().statutoryDeductions.epf.ceilingPeriods).toEqual([
            periods[0], { ...periods[1], effectiveTo: null },
        ]);
    });
    it('rejects invalid configuration before saving', async () => {
        const service = new SalaryStructureService({} as any);
        const input = fixture();
        input.statutoryDeductions.epf.ceilingPeriods = [{ ceiling: 15000, effectiveFrom: 'invalid' }];
        const save = jest.spyOn(SalaryStructure.prototype, 'save');
        await expect(service.create(input as any)).rejects.toThrow('PF dates');
        expect(save).not.toHaveBeenCalled();
    });
    it('preserves schedules and rates on a partial EPF update', async () => {
        const doc = new SalaryStructure(fixture());
        jest.spyOn(SalaryStructure, 'findById').mockResolvedValue(doc);
        jest.spyOn(doc, 'save').mockResolvedValue(doc);
        const service = new SalaryStructureService({} as any);
        const result = await service.update({ _id: doc._id, statutoryDeductions: { epf: { employeeContribution: 10 } } });
        expect(result.statutoryDeductions.epf).toMatchObject({ employeeContribution: 10, employerContribution: 13, ceilingPeriods: periods });
    });
    it('changes only the schedule when periods are updated', async () => {
        const doc = new SalaryStructure(fixture());
        const before = doc.toObject();
        jest.spyOn(SalaryStructure, 'findById').mockResolvedValue(doc);
        jest.spyOn(doc, 'save').mockResolvedValue(doc);
        const replacement = [{ ceiling: 33000, effectiveFrom: '2030-01-01' }];
        const result = await new SalaryStructureService({} as any).update({ _id: doc._id,
            statutoryDeductions: { epf: { ceilingPeriods: replacement } } });
        expect(result.statutoryDeductions.epf).toMatchObject({ employeeContribution: 12, employerContribution: 13, maxLimit: 15000, ceilingPeriods: replacement });
        expect(result.toObject().fixedEarnings).toEqual(before.fixedEarnings);
        expect(result.toObject().statutoryDeductions.esi).toEqual(before.statutoryDeductions.esi);
        expect(result.toObject().statutoryDeductions.professionalTax).toEqual(before.statutoryDeductions.professionalTax);
        expect(result.toObject().statutoryDeductions.employerSplit).toEqual(before.statutoryDeductions.employerSplit);
    });
    it('rejects an invalid update without saving or replacing the current schedule', async () => {
        const doc = new SalaryStructure(fixture());
        jest.spyOn(SalaryStructure, 'findById').mockResolvedValue(doc);
        const save = jest.spyOn(doc, 'save').mockResolvedValue(doc);
        await expect(new SalaryStructureService({} as any).update({ _id: doc._id,
            statutoryDeductions: { epf: { ceilingPeriods: [{ ceiling: 1, effectiveFrom: 'bad-date' }] } } }))
            .rejects.toThrow('PF dates');
        expect(save).not.toHaveBeenCalled();
        expect(doc.statutoryDeductions.epf.ceilingPeriods?.[0].ceiling).toBe(17000);
    });
});
