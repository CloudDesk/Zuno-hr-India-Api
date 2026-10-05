import Fastify from 'fastify';
import { salaryStructureRoutes } from '../src/routes/salary-structure';
jest.mock('../src/middleware/auth', () => ({ authenticate: jest.fn(async () => undefined) }));

it('returns PF periods through the list response schema without stripping dates or ceilings', async () => {
    const periods = [
        { ceiling: 15000, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-16' },
        { ceiling: 25000, effectiveFrom: '2026-09-17', effectiveTo: null },
    ];
    const app = Fastify();
    app.decorateRequest('container', undefined);
    app.addHook('onRequest', async request => {
        request.container = {
            requestContext: { user: { country: 'IN', role: 'admin' } },
            salaryStructureService: { findAll: async () => ({ salaryStructures: [{
                _id: '507f1f77bcf86cd799439011', name: 'PF fixture', country: 'IN',
                statutoryDeductions: { epf: { employeeContribution: 12, employerContribution: 13, maxLimit: 15000, ceilingPeriods: periods } },
            }], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }) },
        } as any;
    });
    await app.register(salaryStructureRoutes);
    try {
        const result = await app.inject({ method: 'GET', url: '/' });
        expect(result.statusCode).toBe(200);
        expect(result.json().data[0].statutoryDeductions.epf.ceilingPeriods).toEqual(periods);
    } finally { await app.close(); }
});
