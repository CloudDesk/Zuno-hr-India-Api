import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { OrganizationProfileInput } from '../services/organization-profile.service';

const addressSchema = {
    type: 'object',
    required: ['type', 'line1', 'city', 'state', 'postalCode', 'country', 'isPrimary'],
    properties: {
        type: { type: 'string', enum: ['registered', 'corporate', 'payroll', 'branch'] },
        label: { type: 'string', maxLength: 100 },
        line1: { type: 'string', maxLength: 250 },
        line2: { type: 'string', maxLength: 250 },
        city: { type: 'string', maxLength: 100 },
        state: { type: 'string', maxLength: 100 },
        postalCode: { type: 'string', maxLength: 20 },
        country: { type: 'string', maxLength: 100 },
        isPrimary: { type: 'boolean' },
    },
} as const;

const registrationSchema = {
    type: 'object',
    required: ['type', 'registrationNumber', 'isPrimary', 'isActive'],
    properties: {
        type: { type: 'string', enum: ['PAN', 'TAN', 'CIN', 'GSTIN', 'EPFO', 'ESIC', 'PROFESSIONAL_TAX'] },
        registrationNumber: { type: 'string' },
        label: { type: 'string', maxLength: 100 },
        locationCode: { type: 'string', maxLength: 100 },
        authority: {
            type: 'object',
            properties: {
                name: { type: 'string', maxLength: 250 },
                address: { type: 'string', maxLength: 1000 },
                jurisdictionCode: { type: 'string', maxLength: 100 },
            },
        },
        effectiveFrom: { type: 'string', format: 'date-time' },
        effectiveTo: { type: 'string', format: 'date-time' },
        isPrimary: { type: 'boolean' },
        isActive: { type: 'boolean' },
    },
} as const;

const profileProperties = {
    organizationCode: { type: 'string', maxLength: 50 },
    legalName: { type: 'string', maxLength: 250 },
    displayName: { type: 'string', maxLength: 150 },
    country: { type: 'string', maxLength: 100 },
    corporateEmail: { type: 'string', format: 'email', maxLength: 250 },
    payrollEmail: { type: 'string', format: 'email', maxLength: 250 },
    phone: { type: 'string', maxLength: 30 },
    website: { type: 'string', maxLength: 500 },
    addresses: { type: 'array', items: addressSchema },
    statutoryRegistrations: { type: 'array', items: registrationSchema },
    documentSettings: {
        type: 'object',
        properties: {
            logoPath: { type: 'string', maxLength: 1000 },
            letterheadPath: { type: 'string', maxLength: 1000 },
            authorizedSignatoryName: { type: 'string', maxLength: 200 },
            authorizedSignatoryDesignation: { type: 'string', maxLength: 200 },
            signaturePath: { type: 'string', maxLength: 1000 },
        },
    },
} as const;

const errorReply = (reply: any, error: any) => reply.status(400).send({
    success: false,
    error: { message: String(error?.message || error) },
});

export async function organizationProfileRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const profiles = await request.container!.organizationProfileService.list();
            return reply.send({ success: true, data: profiles });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });

    fastify.get('/active', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const profile = await request.container!.organizationProfileService.getActive();
            return reply.send({ success: true, data: profile });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });

    fastify.post('/', {
        preHandler: [authenticate],
        schema: {
            tags: ['Organization Profile'],
            summary: 'Create an Organization Profile draft',
            body: {
                type: 'object',
                additionalProperties: false,
                required: ['organizationCode', 'legalName'],
                properties: profileProperties,
            },
        },
    }, async (request, reply) => {
        try {
            const profile = await request.container!.organizationProfileService.create(request.body as OrganizationProfileInput);
            return reply.status(201).send({ success: true, data: profile });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });

    fastify.put<{ Params: { id: string } } >('/:id', {
        preHandler: [authenticate],
        schema: {
            tags: ['Organization Profile'],
            summary: 'Update an Organization Profile',
            body: {
                type: 'object',
                additionalProperties: false,
                properties: { ...profileProperties, version: { type: 'number', minimum: 0 } },
            },
        },
    }, async (request, reply) => {
        try {
            const body = request.body as Partial<OrganizationProfileInput> & { version?: number };
            const { version, ...input } = body;
            const profile = await request.container!.organizationProfileService.update(request.params.id, input, version);
            return reply.send({ success: true, data: profile });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });

    fastify.post<{ Params: { id: string } }>('/:id/activate', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const profile = await request.container!.organizationProfileService.activate(request.params.id);
            return reply.send({ success: true, data: profile });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });

    fastify.post<{ Params: { id: string } }>('/:id/deactivate', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const profile = await request.container!.organizationProfileService.deactivate(request.params.id);
            return reply.send({ success: true, data: profile });
        } catch (error: any) {
            return errorReply(reply, error);
        }
    });
}
