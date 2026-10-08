import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { generateConsolidatedPdf, getConsolidatedPdfStatus, getConsolidatedPdfUrl } from '../services/consolidated-tax-pdf.service';
const yearSchema = { type: 'object', required: ['financialYear'], additionalProperties: false,
    properties: { financialYear: { type: 'string', pattern: '^\\d{4}-\\d{4}$' }, testDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } };
type ReportDate = { financialYear: string; testDate?: string };
export async function consolidatedTaxPdfRoutes(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', authenticate);
    app.addHook('preHandler', async (request, reply) => {
        if (String(request.user?.role || '').toLowerCase() !== 'admin') return reply.code(403).send({ success: false, message: 'Only administrators can access consolidated tax PDFs.' });
    });
    app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
    app.addHook('preHandler', async (request, reply) => {
        const { financialYear: year, testDate } = (request.method === 'POST' ? request.body : request.query) as ReportDate;
        if (!/^\d{4}-\d{4}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) {
            return reply.code(400).send({ success: false, message: 'Invalid financial year.' });
        }
        // The testing date controls availability only; services still receive just the selected FY.
        const currentTime = testDate ? Date.parse(`${testDate}T00:00:00+05:30`) : Date.now();
        if (testDate && (!Number.isFinite(currentTime) || new Date(currentTime + 330 * 60 * 1000).toISOString().slice(0, 10) !== testDate)) {
            return reply.code(400).send({ success: false, message: 'Invalid testing date.' });
        }
        if (currentTime < Date.parse(`${year.slice(5)}-04-01T00:00:00+05:30`)) {
            return reply.code(400).send({ success: false, message: `FY ${year} consolidated PDF becomes available on 1 April ${year.slice(5)}, after the financial year ends.` });
        }
    });
    app.get<{ Querystring: ReportDate }>('/status', { schema: { querystring: yearSchema } }, async (request, reply) => {
        try { return { success: true, data: await getConsolidatedPdfStatus(request.query.financialYear) }; }
        catch (error) { return reply.code(400).send({ success: false, message: (error as Error).message }); }
    });
    app.post<{ Body: ReportDate }>('/generate', { schema: { body: yearSchema } }, async (request, reply) => {
        try { return { success: true, data: await generateConsolidatedPdf(request.body.financialYear, request.user.name) }; }
        catch (error) { return reply.code(400).send({ success: false, message: (error as Error).message }); }
    });
    for (const action of ['preview', 'download']) {
        app.get<{ Querystring: ReportDate }>(`/${action}`, { schema: { querystring: yearSchema } }, async (request, reply) => {
            try { return { success: true, data: { url: await getConsolidatedPdfUrl(request.query.financialYear, action === 'download') } }; }
            catch (error) { return reply.code(400).send({ success: false, message: (error as Error).message }); }
        });
    }
}
