import { Types } from 'mongoose';
import { PayrollService } from '../src/services/payroll.service';
import { SalaryStatementService } from '../src/services/salary-statement.service';

// No database or external storage is needed to exercise the deduction engines.
jest.mock('../src/utilis/gcpStorage', () => ({ deleteFileFromGCP: jest.fn() }));
jest.mock('../src/services/final-settlement.service', () => ({ synchronizeFinalSettlementPayrollForPayslip: jest.fn() }));

const structure = {
    fixedEarnings: { hraPercentage: 20 },
    statutoryDeductions: {
        epf: { employeeContribution: 12, employerContribution: 13, maxLimit: 15000, ceilingPeriods: [{ ceiling: 15000, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-16' }, { ceiling: 25000, effectiveFrom: '2026-09-17' }] },
        employerSplit: { epsPercentage: 8.33, epsWageCap: 15000 },
        esi: { employeeContribution: 0.75, employerContribution: 3.25, applicabilityLimit: 21000 },
        professionalTax: { state: 'TN', term: 'monthly', slabs: [] },
    },
};

describe('PF revision in payroll deductions', () => {
    let payroll: any;
    let statement: any;
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        payroll = new PayrollService({} as any);
        payroll.calculateIncomeTax = jest.fn().mockResolvedValue(500);
        statement = Object.create(SalaryStatementService.prototype);
        statement.calculateITLocally = jest.fn().mockResolvedValue(500);
    });
    afterEach(() => jest.restoreAllMocks());

    const id = new Types.ObjectId();
    function deductions(month: number, options: any = {}) {
        return payroll.calculateDeductions(
            options.basic ?? 14000, options.da ?? 6000, 40000,
            options.structure ?? structure, { absentDays: 0 }, 0,
            month === 9 ? 'September' : month === 8 ? 'August' : 'October',
            month, options.year ?? 2026, id, options.payableDays ?? 30, 30, 40000,
            options.country ?? 'IN', options.consultancy ?? false, options.intern ?? false,
            options.voluntaryPf,
        );
    }

    it.each([[9, 2080, 2253.33], [10, 2400, 2600]])('uses the new base in month %s and preserves TDS and EPS', async (month, employee, employer) => {
        const result = await deductions(month);
        expect(result).toMatchObject({ epfEmployee: employee, epfEmployer: employer, epfEmployerEps: 1249.5, incomeTax: 500 });
        expect(result.epfEmployerEpf).toBe(Number((employer - 1249.5).toFixed(2)));
        expect(result.totalDeductions).toBe(employee + 500);
        expect(payroll.calculateIncomeTax).toHaveBeenCalledWith(id, month === 9 ? 'September' : 'October', month, 2026);
    });

    it('preserves the historical Basic-only check before September', async () => {
        expect(await deductions(8)).toMatchObject({ epfEmployee: 2400, epfEmployer: 2600 });
        expect(await deductions(8, { basic: 20000, da: 0 })).toMatchObject({ epfEmployee: 1800, epfEmployer: 1950 });
    });

    it('retains legacy payroll in future months when no schedule has been saved', async () => {
        const legacy = { ...structure, statutoryDeductions: { ...structure.statutoryDeductions,
            epf: { employeeContribution: 12, employerContribution: 13, maxLimit: 15000 } } };
        for (const month of [9, 10, 12]) {
            expect(await deductions(month, { basic: 20000, da: 0, year: 2030, structure: legacy }))
                .toMatchObject({ epfEmployee: 1800, epfEmployer: 1950 });
        }
    });

    it('keeps contribution percentages configurable', async () => {
        const custom = { ...structure, statutoryDeductions: { ...structure.statutoryDeductions, epf: { employeeContribution: 10, employerContribution: 12, maxLimit: 15000 } } };
        expect(await deductions(10, { structure: custom })).toMatchObject({ epfEmployee: 2000, epfEmployer: 2400 });
    });

    it('retains explicitly configured zero contribution rates', async () => {
        const custom = { ...structure, statutoryDeductions: { ...structure.statutoryDeductions,
            epf: { employeeContribution: 0, employerContribution: 0, maxLimit: 15000 },
            employerSplit: { epsPercentage: 0, epsWageCap: 15000 } } };
        expect(await deductions(10, { structure: custom })).toMatchObject({ epfEmployee: 0, epfEmployer: 0, epfEmployerEps: 0 });
    });

    it.each([-1, NaN, Infinity])('rejects invalid earned Basic + DA (%s) in payroll', basic => {
        return expect(deductions(9, { basic, da: 0 })).rejects.toThrow('Invalid PF wage');
    });

    it('rejects an incomplete salary structure using the existing validation', async () => {
        await expect(deductions(9, { structure: { statutoryDeductions: {} } })).rejects.toThrow('Missing required field');
    });

    it('preserves the existing failure when tax lookup fails', async () => {
        payroll.calculateIncomeTax.mockRejectedValueOnce(new Error('Tax lookup unavailable'));
        await expect(deductions(9)).rejects.toThrow('Tax lookup unavailable');
    });

    it.each([{ enabled: false, employeeContributionValue: 500 }, { enabled: true, employeeContributionValue: -500 }])('does not add disabled or negative voluntary PF: %j', async voluntaryPf => {
        expect(await deductions(9, { voluntaryPf })).toMatchObject({ epfEmployee: 2080, voluntaryPfEmployeeContribution: 0 });
    });

    it('returns zero PF for zero earned wages without double proration', async () => {
        expect(await deductions(9, { basic: 0, da: 0, payableDays: 0 }))
            .toMatchObject({ epfEmployee: 0, epfEmployer: 0, epfEmployerEps: 0, leaveDeductions: 40000 });
    });

    it('adds voluntary PF only to the employee contribution', async () => {
        expect(await deductions(9, { voluntaryPf: { enabled: true, employeeContributionValue: 500 } }))
            .toMatchObject({ epfEmployee: 2580, epfEmployer: 2253.33, voluntaryPfEmployeeContribution: 500 });
    });

    it.each([{ country: 'AE' }, { consultancy: true }, { intern: true }])('preserves PF exclusion %j', async options => {
        expect(await deductions(10, options)).toMatchObject({ epfEmployee: 0, epfEmployer: 0 });
    });

    it('uses earned wages once and retains the existing unpaid-leave deduction', async () => {
        expect(await deductions(9, { basic: 7000, da: 3000, payableDays: 15 }))
            .toMatchObject({ epfEmployee: 1200, epfEmployer: 1300, leaveDeductions: 20000, incomeTax: 500 });
    });

    it.each([9, 10])('keeps salary-statement preview aligned in month %s', async month => {
        const result = await statement.calculateDeductionsLocally(14000, 6000, structure, month === 9 ? 'September' : 'October', month, 2026, id, 30, 30, 40000, 'IN', false, false);
        const actual = await deductions(month);
        expect(result.epfEmployee).toBe(actual.epfEmployee);
        expect(result.epfEmployer).toBe(actual.epfEmployer);
        expect(result.incomeTax).toBe(actual.incomeTax);
    });

    function fullRecord(month: number, year: number, options: any = {}) {
        const fullStructure = {
            ...structure,
            fixedEarnings: {
                basicPercentage: 50, daPercentage: 0, hraPercentage: 20,
                travelAllowancePercentage: 5, reimbursementPercentage: 2,
                deductionPercentage: 1,
            },
            statutoryDeductions: {
                ...structure.statutoryDeductions,
                professionalTax: {
                    state: 'TN', term: 'monthly',
                    slabs: [{ fromAmount: 0, toAmount: null, taxAmount: 200 }],
                },
            },
        };
        return payroll.calculatePayrollRecord(
            { _id: id, name: 'PF regression fixture', country: 'IN', ...options.employee },
            { _id: id, monthlyGross: options.gross ?? 40000, salaryStructureId: fullStructure,
                voluntaryPf: options.voluntaryPf, annualInsurance: 1000,
                travelAllowance: 1000, airTicketAllowance: 2000, medicalAllowance: 3000 },
            { presentDays: options.days ?? 20, weekendDays: 8, holidayDays: 1 },
            1, 4, 30, 22,
            month === 9 ? 'September' : 'October', month, year,
        );
    }

    function withoutPeriod(record: any) {
        const { month: _month, year: _year, monthYear: _monthYear, processedAt: _processedAt, ...rest } = record;
        return rest;
    }

    it.each([[9, 2080, 2253.33], [10, 2400, 2600]])('changes only PF and dependent totals in the complete month %s payroll', async (month, pf, employer) => {
        const historical = await fullRecord(month, 2025);
        const revised = await fullRecord(month, 2026);
        expect(historical).toMatchObject({ epfEmployee: 1800, epfEmployer: 1950 });
        expect(revised).toMatchObject({ epfEmployee: pf, epfEmployer: employer, incomeTax: 500, professionalTax: 200 });
        const changed = ['epfEmployee', 'epfEmployer', 'epfEmployerEpf', 'totalDeductions', 'netSalary', 'ctc'];
        const oldRest = withoutPeriod(historical);
        const newRest = withoutPeriod(revised);
        for (const field of changed) {
            delete oldRest[field];
            delete newRest[field];
        }
        expect(newRest).toEqual(oldRest);
        expect(revised.totalDeductions - historical.totalDeductions).toBeCloseTo(pf - 1800, 2);
        expect(historical.netSalary - revised.netSalary).toBeCloseTo(pf - 1800, 2);
        expect(revised.ctc - historical.ctc).toBeCloseTo(employer - 1950, 2);
        expect(revised.epfEmployerEps + revised.epfEmployerEpf).toBeCloseTo(revised.epfEmployer, 2);
    });

    it.each([
        { gross: 24000 },
        { days: 5 },
        { employee: { country: 'AE' } },
        { employee: { isConsultancy: true } },
        { employee: { isIntern: true } },
    ])('preserves the complete payroll for unaffected wages or exclusions: %j', async options => {
        const historical = await fullRecord(9, 2025, options);
        for (const month of [9, 10]) {
            expect(withoutPeriod(await fullRecord(month, 2026, options))).toEqual(withoutPeriod(historical));
        }
    });

    it('keeps future September on the full 25000 ceiling and ignores the processing date', async () => {
        const historical = await fullRecord(9, 2025);
        const future = await fullRecord(9, 2027);
        expect(historical.epfEmployee).toBe(1800);
        expect(future.epfEmployee).toBe(2400);
        expect(future.epfEmployer).toBe(2600);
    });
});
