import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { LeaveReleaseConfigurationService } from '../services/leave-release-configuration.service';

const configurationBodySchema = {
  type: 'object',
  required: [
    'name',
    'leaveType',
    'frequency',
    'daysPerRelease',
    'effectiveStartDate',
    'employeeIds',
    'status'
  ],
  properties: {
    name: { type: 'string', minLength: 1 },
    leaveType: { type: 'string', minLength: 1 },
    frequency: { type: 'string', enum: ['daily', 'monthly', 'quarterly', 'yearly'] },
    daysPerRelease: { type: 'number', exclusiveMinimum: 0 },
    effectiveStartDate: { type: 'string' },
    effectiveEndDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    employeeIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string' }
    },
    status: { type: 'string', enum: ['active', 'paused', 'inactive'] }
  }
} as const;

const requireAdmin = (request: any, reply: any): boolean => {
  const role = request.user?.role?.toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    reply.status(403).send({
      success: false,
      error: { message: 'Access denied. Admin role required.' }
    });
    return false;
  }
  return true;
};

export const leaveReleaseConfigurationRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const service = new LeaveReleaseConfigurationService(request.container!.requestContext);
      return reply.send({ success: true, data: await service.list() });
    } catch (error: any) {
      return reply.status(400).send({ success: false, error: { message: error.message } });
    }
  });

  fastify.post(
    '/',
    { preHandler: [authenticate], schema: { body: configurationBodySchema } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      try {
        const service = new LeaveReleaseConfigurationService(request.container!.requestContext);
        const configuration = await service.create(request.body as any);
        return reply.status(201).send({ success: true, data: configuration });
      } catch (error: any) {
        return reply.status(400).send({ success: false, error: { message: error.message } });
      }
    }
  );

  fastify.put(
    '/:id',
    { preHandler: [authenticate], schema: { body: configurationBodySchema } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      try {
        const { id } = request.params as { id: string };
        const service = new LeaveReleaseConfigurationService(request.container!.requestContext);
        return reply.send({ success: true, data: await service.update(id, request.body as any) });
      } catch (error: any) {
        return reply.status(400).send({ success: false, error: { message: error.message } });
      }
    }
  );

  fastify.patch(
    '/:id/status',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['active', 'paused', 'inactive'] }
          }
        }
      }
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      try {
        const { id } = request.params as { id: string };
        const { status } = request.body as { status: 'active' | 'paused' | 'inactive' };
        const service = new LeaveReleaseConfigurationService(request.container!.requestContext);
        return reply.send({ success: true, data: await service.setStatus(id, status) });
      } catch (error: any) {
        return reply.status(400).send({ success: false, error: { message: error.message } });
      }
    }
  );
};
