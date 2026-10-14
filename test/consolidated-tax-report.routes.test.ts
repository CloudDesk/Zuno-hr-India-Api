import Fastify from 'fastify';
import { consolidatedTaxReportRoutes } from '../src/routes/consolidated-tax-report.routes';
import { loadConsolidatedTaxReport } from '../src/services/consolidated-tax-report.service';

import { approvalSummary, downloadYearlyTaxReport, generateYearlyTaxReport } from '../src/services/consolidated-tax-generation.service';
jest.mock('../src/services/consolidated-tax-generation.service', () => ({ approvalSummary: jest.fn(), getYearlyReportStatus: jest.fn(), downloadYearlyTaxReport: jest.fn(), generateYearlyTaxReport: jest.fn() }));
jest.mock('../src/middleware/auth', () => ({ authenticate: async (request: any, reply: any) => {
    if (!request.headers['x-test-role']) return reply.code(401).send({ success: false });
    request.user = { role: request.headers['x-test-role'], _id: '507f1f77bcf86cd799439011', name: 'Admin' };
} }));
jest.mock('../src/services/consolidated-tax-report.service', () => ({ loadConsolidatedTaxReport: jest.fn(), exportConsolidatedTaxWorkbook: jest.fn() }));

describe('Consolidated tax report routes', () => {
    const build = async () => {
        const app = Fastify(); await app.register(consolidatedTaxReportRoutes, { prefix: '/consolidated-tax-report' });
        return app;
    };
    beforeEach(() => {
        jest.mocked(loadConsolidatedTaxReport).mockResolvedValue({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z', employer: { name: 'Example', address: 'Example address' },
            columns: [], notes: [], rows: Array.from({ length: 30 }, (_, index) => ({ employeeId: String(index), values: {}, warnings: index === 29 ? ['Missing source'] : [] })) });
        jest.mocked(downloadYearlyTaxReport).mockResolvedValue({ buffer: Buffer.from('workbook'), fileName: 'Consolidated_Tax_Report_2025-2026.xlsx' });
    });
    it.each([undefined, 'staff', 'manager'])('denies role %s before loading employee financial data', async role => {
        const app = await build();
        try {
            for (const endpoint of ['', 'status', 'preflight', 'export', 'generate']) {
                const response = await app.inject({ method: endpoint === 'generate' ? 'POST' : 'GET',
                    url: `/consolidated-tax-report/${endpoint}?financialYear=2025-2026`,
                    ...(endpoint === 'generate' ? { payload: { financialYear: '2025-2026' } } : {}),
                    headers: role ? { 'x-test-role': role } : {} });
                expect(response.statusCode).toBe(role ? 403 : 401);
            }
            expect(loadConsolidatedTaxReport).not.toHaveBeenCalled();
            expect(generateYearlyTaxReport).not.toHaveBeenCalled();
            expect(downloadYearlyTaxReport).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
    it('paginates preview but counts review rows across the complete result', async () => {
        const app = await build();
        try {
            const response = await app.inject({ url: '/consolidated-tax-report/?financialYear=2025-2026', headers: { 'x-test-role': 'admin' } });
            expect(response.statusCode).toBe(200);
            expect(response.json().data.rows).toHaveLength(25);
            expect(response.json().data.reviewCount).toBe(1);
            expect(response.headers['cache-control']).toBe('no-store');
        } finally { await app.close(); }
    });
    it('checks approvals across the entire year before generation', async () => {
        const app = await build();
        try {
            const response = await app.inject({ url: '/consolidated-tax-report/preflight?financialYear=2025-2026&page=2&departmentId=Engineering', headers: { 'x-test-role': 'admin' } });
            expect(response.statusCode).toBe(200);
            expect(loadConsolidatedTaxReport).toHaveBeenCalledWith({ financialYear: '2025-2026' });
            expect(jest.mocked(approvalSummary).mock.calls[0][0].rows).toHaveLength(30);
            expect(generateYearlyTaxReport).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
    it('downloads the saved yearly file without recalculating', async () => {
        const app = await build();
        try {
            const response = await app.inject({ url: '/consolidated-tax-report/export?financialYear=2025-2026&page=2', headers: { 'x-test-role': 'admin' } });
            expect(response.statusCode).toBe(200);
            expect(response.headers['content-disposition']).toContain('Consolidated_Tax_Report_2025-2026.xlsx');
            expect(downloadYearlyTaxReport).toHaveBeenCalledWith('2025-2026');
            expect(loadConsolidatedTaxReport).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
    it('generates with authenticated admin identity and year only', async () => {
        const app = await build();
        try {
            const response = await app.inject({ method: 'POST', url: '/consolidated-tax-report/generate', headers: { 'x-test-role': 'admin' }, payload: { financialYear: '2025-2026', departmentId: 'Engineering' } });
            expect(response.statusCode).toBe(200);
            expect(generateYearlyTaxReport).toHaveBeenCalledWith('2025-2026', { id: '507f1f77bcf86cd799439011', name: 'Admin' });
        } finally { await app.close(); }
    });
    it('rejects invalid filter input without fetching data', async () => {
        const app = await build();
        try {
            const response = await app.inject({ url: '/consolidated-tax-report/?financialYear=invalid&limit=999', headers: { 'x-test-role': 'admin' } });
            expect(response.statusCode).toBe(400); expect(loadConsolidatedTaxReport).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
});
