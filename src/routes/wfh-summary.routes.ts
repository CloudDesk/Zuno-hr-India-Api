import { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { authenticate } from '../middleware/auth';

export async function wfhSummaryRoutes(fastify: FastifyInstance): Promise<void> {
  // Get WFH summary for a user
  fastify.get(
    '/summary/:userId',
    {
      schema: {
        tags: ['WFH Summary'],
        summary: 'Get WFH summary for a user',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            year: {
              type: 'number',
              description: 'Year for WFH summary',
              default: new Date().getFullYear(),
            },
          },
        },
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { year = new Date().getFullYear() } = request.query as { year?: number };
        const userId = new Types.ObjectId((request.params as any).userId as string);

        const summary = await request.container!.wfhSummaryService.getWFHSummary(userId, year);

        return reply.send({
          success: true,
          data: summary,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Get WFH balance for a user
  fastify.get(
    '/balance/:userId',
    {
      schema: {
        tags: ['WFH Summary'],
        summary: 'Get WFH balance for a user',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            year: {
              type: 'number',
              description: 'Year for WFH balance',
              default: new Date().getFullYear(),
            },
          },
        },
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { year = new Date().getFullYear() } = request.query as { year?: number };
        const userId = new Types.ObjectId((request.params as any).userId as string);

        const balance = await request.container!.wfhSummaryService.getWFHBalance(userId, year);

        return reply.send({
          success: true,
          data: balance,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Update WFH allotment (Admin only)
  fastify.post(
    '/allotments',
    {
      schema: {
        tags: ['WFH Summary'],
        summary: 'Update WFH allotment for a user (Admin)',
        description: 'Set yearly WFH days allotment. Users can still apply even if balance is 0.',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['userId', 'year', 'alloted'],
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to update WFH allotment for',
            },
            year: {
              type: 'number',
              description: 'Year for WFH allotment',
              default: new Date().getFullYear(),
            },
            alloted: {
              type: 'number',
              minimum: 0,
              description: 'Days allotted per year',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  year: { type: 'number' },
                  wfh: {
                    type: 'object',
                    properties: {
                      alloted: { type: 'number' },
                      availed: { type: 'number' },
                      remaining: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { userId, year = new Date().getFullYear(), alloted } = request.body as {
          userId: string;
          year?: number;
          alloted: number;
        };

        const updatedSummary = await request.container!.wfhSummaryService.updateWFHAllotments(
          new Types.ObjectId(userId),
          year,
          alloted
        );

        return reply.send({
          success: true,
          data: updatedSummary,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Get multiple users WFH summaries
  fastify.get(
    '/summaries',
    {
      schema: {
        tags: ['WFH Summary'],
        summary: 'Get WFH summaries for multiple users',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            userIds: {
              type: 'string',
              description: 'Comma-separated list of user IDs',
            },
            year: {
              type: 'number',
              description: 'Year for WFH summary',
              default: new Date().getFullYear(),
            },
          },
          required: ['userIds'],
        },
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { userIds, year = new Date().getFullYear() } = request.query as {
          userIds: string;
          year?: number;
        };

        const userIdList = userIds.split(',').map((id) => new Types.ObjectId(id.trim()));

        const summaries = await Promise.all(
          userIdList.map((userId) =>
            request.container!.wfhSummaryService.getWFHSummary(userId, year)
          )
        );

        return reply.send({
          success: true,
          data: summaries,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Bulk update WFH allotments (Admin only)
  fastify.post(
    '/allotments/bulk',
    {
      schema: {
        tags: ['WFH Summary'],
        summary: 'Bulk update WFH allotments for multiple users (Admin)',
        description: 'Set yearly WFH days allotment for multiple users at once',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['allotments', 'year'],
          properties: {
            allotments: {
              type: 'array',
              description: 'Array of user allotments',
              items: {
                type: 'object',
                required: ['userId', 'alloted'],
                properties: {
                  userId: {
                    type: 'string',
                    description: 'User ID',
                  },
                  alloted: {
                    type: 'number',
                    minimum: 0,
                    description: 'Days allotted per year',
                  },
                },
              },
              minItems: 1,
            },
            year: {
              type: 'number',
              description: 'Year for WFH allotment',
              default: new Date().getFullYear(),
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  successCount: { type: 'number' },
                  failedCount: { type: 'number' },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        userId: { type: 'string' },
                        error: { type: 'string' },
                      },
                    },
                  },
                  updated: {
                    type: 'array',
                    items: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { allotments, year = new Date().getFullYear() } = request.body as {
          allotments: Array<{ userId: string; alloted: number }>;
          year?: number;
        };

        // Validate allotments array
        if (!Array.isArray(allotments) || allotments.length === 0) {
          return reply.status(400).send({
            success: false,
            error: { message: 'allotments must be a non-empty array' },
          });
        }

        // Convert to ObjectId format
        const allotmentsWithObjectId = allotments.map((a) => ({
          userId: new Types.ObjectId(a.userId),
          alloted: a.alloted,
        }));

        const result = await request.container!.wfhSummaryService.bulkUpdateWFHAllotments(
          allotmentsWithObjectId,
          year
        );

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );
}

