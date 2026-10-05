import { employeeOverlapsFinancialYear, loadConsolidatedTaxReport } from '../src/services/consolidated-tax-report.service';
import { User } from '../src/models/user.model';
import { TaxDeclaration } from '../src/models/tax-declaration';
import { TaxSlab } from '../src/models/tax-slab.model';
import { SalaryAssignment } from '../src/models/salary-assignments.model';
import { Document } from '../src/models/document.model';
import { OrganizationProfile } from '../src/models/organization-profile.model';
jest.mock('../src/models/user.model', () => ({ User: { find: jest.fn() } }));
jest.mock('../src/models/tax-declaration', () => ({ TaxDeclaration: { find: jest.fn() } }));
jest.mock('../src/models/tax-slab.model', () => ({ TaxSlab: { find: jest.fn() } }));
jest.mock('../src/models/salary-assignments.model', () => ({ SalaryAssignment: { find: jest.fn() } }));
jest.mock('../src/models/document.model', () => ({ Document: { find: jest.fn() } }));
jest.mock('../src/models/organization-profile.model', () => ({ OrganizationProfile: { find: jest.fn() } }));
function query(data: unknown[]) {
    const chain: any = { lean: jest.fn().mockResolvedValue(data) };
    for (const method of ['select', 'sort', 'limit', 'populate']) chain[method] = jest.fn().mockReturnValue(chain);
    return chain;
}
const employee = { _id: 'employee-1', name: 'Test Employee', employeeCode: '00001', active: true, joiningDate: '2020-01-01', governmentIds: { pan: { number: 'ABCDE1234F' } } };
const declaration = { employeeId: 'employee-1', regime: 'new', annualGross: 600000, ptDeduction: 0, declarations: [] };
describe('Read-only consolidated report source selection', () => {
    beforeEach(() => {
        (User.find as jest.Mock).mockReturnValue(query([employee]));
        (TaxDeclaration.find as jest.Mock).mockReturnValue(query([declaration]));
        (SalaryAssignment.find as jest.Mock).mockReturnValue(query([{ employeeId: 'employee-1', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31', monthlyGross: 50000, salaryStructureId: { fixedEarnings: { basicPercentage: 40, hraPercentage: 20 } } }]));
        (TaxSlab.find as jest.Mock).mockReturnValue(query([{ regime: 'new', standardDeduction: 75000, cessRate: 4, slabs: [{ fromAmount: 0, toAmount: null, taxRate: 10 }] }]));
        (Document.find as jest.Mock).mockReturnValue(query([]));
        (OrganizationProfile.find as jest.Mock).mockReturnValue(query([{ legalName: 'Example employer', addresses: [{ type: 'payroll', isPrimary: true, line1: 'Example road', city: 'Chennai', country: 'IN' }] }]));
    });
    it('uses department LOV strings, escaped search and FY-specific sources without write-capable mocks', async () => {
        const report = await loadConsolidatedTaxReport({ financialYear: '2025-2026', departmentId: 'Engineering', search: 'A.*', activeStatus: 'false' });
        const filter = (User.find as jest.Mock).mock.calls[0][0];
        expect(filter.departmentId).toBe('Engineering'); expect(filter.active).toBe(false);
        expect(filter.$or[0].name.$regex).toBe('A\\.\\*');
        expect(filter.$and[0].$or[0].joiningDate.$lte.toISOString()).toBe('2026-03-31T23:59:59.999Z');
        expect(filter.$and[1].$or[0].separationDate.$gte.toISOString()).toBe('2025-04-01T00:00:00.000Z');
        expect(TaxDeclaration.find).toHaveBeenCalledWith({ employeeId: { $in: ['employee-1'] }, financialYear: '2025-2026' });
        expect(report.rows).toHaveLength(1); expect(report.employer.name).toBe('Example employer');
        expect(report.rows[0].values.gross).toBe(600000);
    });
    it.each([
        ['joined before the FY and no separation date', '2025-01-01', null, true],
        ['joined on the FY start date', '2025-04-01', null, true],
        ['joined on the FY end date', '2026-03-31', null, true],
        ['separated on the FY start date', '2020-01-01', '2025-04-01', true],
        ['separated on the FY end date', '2020-01-01', '2026-03-31', true],
        ['joined after the FY end date', '2026-04-01', null, false],
        ['separated before the FY start date', '2020-01-01', '2025-03-31', false],
        ['invalid employment date', 'not-a-date', null, false],
    ])('applies the FY eligibility boundary for %s', (_scenario, joiningDate, separationDate, expected) => {
        expect(employeeOverlapsFinancialYear({ joiningDate, separationDate }, '2025-2026')).toBe(expected);
    });
    it('does not choose arbitrarily between duplicate declarations', async () => {
        (TaxDeclaration.find as jest.Mock).mockReturnValue(query([declaration, declaration]));
        const report = await loadConsolidatedTaxReport({ financialYear: '2025-2026' });
        expect(report.rows[0].values.totalTax).toBeNull();
        expect(report.rows[0].warnings.join(' ')).toContain('Multiple FY tax declarations');
    });
    it('does not claim a final tax where required Form 12B is missing', async () => {
        (TaxDeclaration.find as jest.Mock).mockReturnValue(query([{ ...declaration, isForm12BApplicable: true }]));
        const report = await loadConsolidatedTaxReport({ financialYear: '2025-2026' });
        expect(report.rows[0].values.totalTax).toBeNull();
        expect(report.rows[0].warnings.join(' ')).toContain('no record exists');
    });
    it('includes the full year beyond 1,000 employees', async () => {
        (User.find as jest.Mock).mockReturnValue(query(Array.from({ length: 1001 }, () => employee)));
        const report = await loadConsolidatedTaxReport({ financialYear: '2025-2026' });
        expect(report.rows).toHaveLength(1001);
    });
    it('requires an unambiguous organization heading', async () => {
        (OrganizationProfile.find as jest.Mock).mockReturnValue(query([]));
        await expect(loadConsolidatedTaxReport({ financialYear: '2025-2026' })).rejects.toThrow('Organization Profile');
    });
    it('does not select one of multiple previous employers and report a partial combined income', async () => {
        const form = { employeeId: 'employee-1', type: 'Form12B', metadata: { form12B: { status: 'Verified', salaryEarned: 300000, tdsDeducted: 5000 } } };
        (Document.find as jest.Mock).mockReturnValue(query([form, form]));
        const report = await loadConsolidatedTaxReport({ financialYear: '2025-2026' });
        expect(report.rows[0].values).toMatchObject({ previousIncome: null, afterExemption: null, taxable: null, totalTax: null });
        expect(report.rows[0].approvalWarnings?.join(' ')).toContain('Multiple Form 12B');
    });
});
