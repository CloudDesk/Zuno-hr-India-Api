import { FastifyInstance, FastifyReply } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from '../middleware/auth';
import {
  IDomainCreate,
  IDomainQuery,
  IDomainUpdate,
  IEmployeeSkillCreate,
  IEmployeeSkillsByEmployeeQuery,
  IEmployeeSkillQuery,
  IEmployeeSkillUpdate,
  ISkillCreate,
  ISkillQuery,
  ISkillUpdate,
  IVerticalCreate,
  IVerticalQuery,
  IVerticalUpdate,
} from '../services/skills.service';
import { SkillsModuleError, toSkillsModuleError } from '../validators/skills.validator';

interface MetaPayload {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function sendSuccess<T>(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  data: T,
  meta?: MetaPayload,
) {
  const payload: {
    success: boolean;
    message: string;
    data: T;
    meta?: MetaPayload;
  } = {
    success: true,
    message,
    data,
  };

  if (meta) {
    payload.meta = meta;
  }

  return reply.status(statusCode).send(payload);
}

function sendError(reply: FastifyReply, error: unknown) {
  const parsedError =
    error instanceof SkillsModuleError ? error : toSkillsModuleError(error);

  const payload: {
    success: boolean;
    message: string;
    error?: unknown;
  } = {
    success: false,
    message: parsedError.message,
  };

  if (parsedError.details !== undefined) {
    payload.error = parsedError.details;
  }

  return reply.status(parsedError.statusCode).send(payload);
}

const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
  },
};

const employeeIdParamSchema = {
  type: 'object',
  required: ['employeeId'],
  properties: {
    employeeId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
  },
};

const statusBodySchema = {
  type: 'object',
  required: ['isActive'],
  properties: {
    isActive: { type: 'boolean' },
  },
};

const commonListQuerySchema = {
  page: { type: 'number', minimum: 1, default: 1 },
  limit: { type: 'number', minimum: 1, maximum: 100, default: 10 },
  sortBy: { type: 'string' },
  sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
};

export const skillsRoutes: RouteHandler = async (
  fastify: FastifyInstance,
): Promise<void> => {
  // Vertical routes
  fastify.post(
    '/verticals',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Create vertical',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await request.container!.skillsService.createVertical(
          request.body as IVerticalCreate,
        );
        return sendSuccess(reply, 201, 'Vertical created successfully', created);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/verticals',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'List verticals',
        querystring: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            isActive: { type: 'boolean' },
            ...commonListQuerySchema,
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await request.container!.skillsService.findAllVerticals(
          request.query as IVerticalQuery,
        );
        return sendSuccess(
          reply,
          200,
          'Vertical list fetched successfully',
          result.items,
          result.meta,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/verticals/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Get vertical by id',
        params: idParamSchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const vertical = await request.container!.skillsService.findVerticalById(id);
        return sendSuccess(reply, 200, 'Vertical fetched successfully', vertical);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    '/verticals/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update vertical',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await request.container!.skillsService.updateVertical(
          id,
          request.body as IVerticalUpdate,
        );
        return sendSuccess(reply, 200, 'Vertical updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch(
    '/verticals/:id/status',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update vertical status',
        params: idParamSchema,
        body: statusBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { isActive } = request.body as { isActive: boolean };
        const updated = await request.container!.skillsService.updateVerticalStatus(
          id,
          isActive,
        );
        return sendSuccess(reply, 200, 'Vertical status updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // Domain routes
  fastify.post(
    '/domains',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Create domain',
        body: {
          type: 'object',
          required: ['verticalId', 'name'],
          properties: {
            verticalId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await request.container!.skillsService.createDomain(
          request.body as IDomainCreate,
        );
        return sendSuccess(reply, 201, 'Domain created successfully', created);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/domains',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'List domains',
        querystring: {
          type: 'object',
          properties: {
            verticalId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            search: { type: 'string' },
            isActive: { type: 'boolean' },
            ...commonListQuerySchema,
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await request.container!.skillsService.findAllDomains(
          request.query as IDomainQuery,
        );
        return sendSuccess(
          reply,
          200,
          'Domain list fetched successfully',
          result.items,
          result.meta,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/domains/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Get domain by id',
        params: idParamSchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const domain = await request.container!.skillsService.findDomainById(id);
        return sendSuccess(reply, 200, 'Domain fetched successfully', domain);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    '/domains/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update domain',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            verticalId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await request.container!.skillsService.updateDomain(
          id,
          request.body as IDomainUpdate,
        );
        return sendSuccess(reply, 200, 'Domain updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch(
    '/domains/:id/status',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update domain status',
        params: idParamSchema,
        body: statusBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { isActive } = request.body as { isActive: boolean };
        const updated = await request.container!.skillsService.updateDomainStatus(
          id,
          isActive,
        );
        return sendSuccess(reply, 200, 'Domain status updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // Skill routes
  fastify.post(
    '/skills',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Create skill',
        body: {
          type: 'object',
          required: ['domainId', 'name'],
          properties: {
            domainId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            aliases: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 150 },
            },
            normalizedKey: { type: 'string', minLength: 1, maxLength: 200 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await request.container!.skillsService.createSkill(
          request.body as ISkillCreate,
        );
        return sendSuccess(reply, 201, 'Skill created successfully', created);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/skills',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'List skills',
        querystring: {
          type: 'object',
          properties: {
            domainId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            verticalId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            search: { type: 'string' },
            isActive: { type: 'boolean' },
            ...commonListQuerySchema,
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await request.container!.skillsService.findAllSkills(
          request.query as ISkillQuery,
        );
        return sendSuccess(
          reply,
          200,
          'Skill list fetched successfully',
          result.items,
          result.meta,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/skills/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Get skill by id',
        params: idParamSchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const skill = await request.container!.skillsService.findSkillById(id);
        return sendSuccess(reply, 200, 'Skill fetched successfully', skill);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    '/skills/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update skill',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            domainId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            name: { type: 'string', minLength: 1, maxLength: 150 },
            description: { type: 'string', maxLength: 500 },
            aliases: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 150 },
            },
            normalizedKey: { type: 'string', minLength: 1, maxLength: 200 },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await request.container!.skillsService.updateSkill(
          id,
          request.body as ISkillUpdate,
        );
        return sendSuccess(reply, 200, 'Skill updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch(
    '/skills/:id/status',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update skill status',
        params: idParamSchema,
        body: statusBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { isActive } = request.body as { isActive: boolean };
        const updated = await request.container!.skillsService.updateSkillStatus(
          id,
          isActive,
        );
        return sendSuccess(reply, 200, 'Skill status updated successfully', updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // Employee skill routes
  fastify.post(
    '/employee-skills',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Create employee skill mapping',
        body: {
          type: 'object',
          required: ['employeeId', 'skillId', 'proficiencyLevel', 'yearsExperience'],
          properties: {
            employeeId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            skillId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            proficiencyLevel: { type: 'number', minimum: 1, maximum: 5 },
            yearsExperience: { type: 'number', minimum: 0 },
            lastUsedOn: { type: 'string', format: 'date-time' },
            isCertified: { type: 'boolean' },
            certificationName: { type: 'string', maxLength: 200 },
            remarks: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await request.container!.skillsService.createEmployeeSkill(
          request.body as IEmployeeSkillCreate,
        );
        return sendSuccess(
          reply,
          201,
          'Employee skill mapping created successfully',
          created,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/employee-skills',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'List employee skill mappings',
        querystring: {
          type: 'object',
          properties: {
            employeeId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            skillId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            domainId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            verticalId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            proficiencyLevel: { type: 'number', minimum: 1, maximum: 5 },
            isCertified: { type: 'boolean' },
            ...commonListQuerySchema,
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await request.container!.skillsService.findAllEmployeeSkills(
          request.query as IEmployeeSkillQuery,
        );
        return sendSuccess(
          reply,
          200,
          'Employee skill mapping list fetched successfully',
          result.items,
          result.meta,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/employee-skills/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Get employee skill mapping by id',
        params: idParamSchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const employeeSkill = await request.container!.skillsService.findEmployeeSkillById(
          id,
        );
        return sendSuccess(
          reply,
          200,
          'Employee skill mapping fetched successfully',
          employeeSkill,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    '/employee-skills/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Update employee skill mapping',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            employeeId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            skillId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
            proficiencyLevel: { type: 'number', minimum: 1, maximum: 5 },
            yearsExperience: { type: 'number', minimum: 0 },
            lastUsedOn: {
              anyOf: [
                { type: 'string', format: 'date-time' },
                { type: 'null' },
              ],
            },
            isCertified: { type: 'boolean' },
            certificationName: { type: 'string', maxLength: 200 },
            remarks: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await request.container!.skillsService.updateEmployeeSkill(
          id,
          request.body as IEmployeeSkillUpdate,
        );
        return sendSuccess(
          reply,
          200,
          'Employee skill mapping updated successfully',
          updated,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    '/employee-skills/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Delete employee skill mapping',
        params: idParamSchema,
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const result = await request.container!.skillsService.deleteEmployeeSkill(id);
        return sendSuccess(
          reply,
          200,
          'Employee skill mapping deleted successfully',
          result,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    '/employees/:employeeId/skills',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Skills Management'],
        summary: 'Get skills by employee id',
        params: employeeIdParamSchema,
        querystring: {
          type: 'object',
          properties: {
            grouped: { type: 'boolean', default: false },
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 10 },
            sortBy: { type: 'string' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { employeeId } = request.params as { employeeId: string };
        const result = await request.container!.skillsService.findEmployeeSkillsByEmployee(
          employeeId,
          request.query as IEmployeeSkillsByEmployeeQuery,
        );
        return sendSuccess(
          reply,
          200,
          'Employee skills fetched successfully',
          result.items,
          result.meta,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};
