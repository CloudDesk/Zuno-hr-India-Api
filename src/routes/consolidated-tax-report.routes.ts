import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { ConsolidatedTaxQuery, loadConsolidatedTaxReport } from '../services/consolidated-tax-report.service';
import { approvalSummary, ConsolidatedReportError, downloadYearlyTaxReport, generateYearlyTaxReport, getYearlyReportStatus } from '../services/consolidated-tax-generation.service';

const yearSchema = { type: 'object', required: ['financialYear'], additionalProperties: false, properties: { financialYear: { type: 'string', pattern: '^\\d{4}-\\d{4}$' } } };

const querystring = {
    type: 'object', required: ['financialYear'], additionalProperties: false,
    properties: {
        financialYear: { type: 'string', pattern: '^\\d{4}-\\d{4}$' },
        regime: { type: 'string', enum: ['old', 'new'] },
        departmentId: { type: 'string', minLength: 1, maxLength: 100 },
        activeStatus: { type: 'string', enum: ['true', 'false'] },
        search: { type: 'string', maxLength: 100 },
        page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
};

export async function consolidatedTaxReportRoutes(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', authenticate);
    app.addHook('preHandler', async (request, reply) => {
        if (String(request.user?.role || '').toLowerCase() !== 'admin') {
            return reply.code(403).send({ success: false, error: { message: 'Only administrators can access consolidated tax reports.' } });
        }
    });
    app.addHook('onSend', async (_request, reply, payload) => {
        reply.header('Cache-Control', 'no-store');
        return payload;
    });
    app.get<{ Querystring: ConsolidatedTaxQuery }>('/', { schema: { querystring } }, async (request, reply) => {
        try {
            const report = await loadConsolidatedTaxReport(request.query);
            const page = request.query.page || 1, limit = request.query.limit || 25;
            const total = report.rows.length;
            const reviewCount = report.rows.filter(row => row.warnings.length > 0).length;
            return reply.send({ success: true, data: { ...report, rows: report.rows.slice((page - 1) * limit, page * limit), reviewCount,
                meta: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
        } catch (error) {
            return reply.code(400).send({ success: false, message: (error as Error).message, error: { message: (error as Error).message } });
        }
    });
    app.get<{ Querystring: { financialYear: string } }>('/status', { schema: { querystring: yearSchema } }, async (request, reply) => {
        try { return { success: true, data: await getYearlyReportStatus(request.query.financialYear) }; }
        catch (error) { return reply.code(400).send({ success: false, message: (error as Error).message }); }
    });
    app.get<{ Querystring: { financialYear: string } }>('/preflight', { schema: { querystring: yearSchema } }, async (request, reply) => {
        try { return { success: true, data: approvalSummary(await loadConsolidatedTaxReport({ financialYear: request.query.financialYear })) }; }
        catch (error) { return reply.code(400).send({ success: false, message: (error as Error).message }); }
    });
    app.post<{ Body: { financialYear: string } }>('/generate', { schema: { body: yearSchema } }, async (request, reply) => {
        try {
            return { success: true, data: await generateYearlyTaxReport(request.body.financialYear, { id: String(request.user._id), name: request.user.name }) };
        } catch (error) {
            return reply.code(error instanceof ConsolidatedReportError ? error.statusCode : 400).send({ success: false, message: (error as Error).message });
        }
    });
    app.get<{ Querystring: { financialYear: string } }>('/export', { schema: { querystring: yearSchema } }, async (request, reply) => {
        try {
            const { buffer, fileName } = await downloadYearlyTaxReport(request.query.financialYear);
            return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                .header('Content-Disposition', `attachment; filename="${fileName}"`).send(buffer);
        } catch (error) {
            return reply.code(error instanceof ConsolidatedReportError ? error.statusCode : 400).send({ success: false, message: (error as Error).message, error: { message: (error as Error).message } });
        }
    });
}
