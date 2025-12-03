import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from '../middleware/auth';
import { IWFHCreate } from '../services/wfh.service';
import { Types } from 'mongoose';
import { User } from '../models';

export const wfhRoutes: RouteHandler = async (
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> => {
  // Apply for WFH
  fastify.post(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Apply for Work From Home',
        description: 'Submit a new WFH request. If allocated days = 0, unlimited WFH allowed. If allocated > 0, balance validation applies (includes pending requests).',
        body: {
          type: 'object',
          required: ['startDate', 'endDate', 'reason'],
          properties: {
            startDate: {
              type: 'string',
              format: 'date',
              description: 'WFH start date (YYYY-MM-DD)'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'WFH end date (YYYY-MM-DD)'
            },
            remarks: {
              type: 'string',
              description: 'Additional remarks'
            },
            reason: {
              type: 'string',
              description: 'Reason for WFH'
            },
            appliedTo: {
              type: 'object',
              description: 'Manager to approve the WFH'
            },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  _id: { type: 'string' },
                  userId: { type: 'string' },
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                  noOfDays: { type: 'number' },
                  status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'] },
                  reason: { type: 'string' },
                }
              }
            }
          }
        }
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as IWFHCreate;
        const userId = (request.user as any)._id;

        // Get user to find manager if appliedTo is not provided
        let appliedTo = body.appliedTo;
        if (!appliedTo) {
          const user = await User.findById(userId).select('managerId managerName');
          if (user && (user as any).managerId) {
            const manager = await User.findById((user as any).managerId).select('name');
            appliedTo = {
              _id: (user as any).managerId.toString(),
              name: manager?.name || (user as any).managerName || 'Manager',
            };
          } else {
            appliedTo = {
              _id: '',
              name: 'Manager',
            };
          }
        }

        const wfhData: IWFHCreate = {
          userId: userId.toString(),
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          reason: body.reason,
          remarks: body.remarks,
          appliedTo,
        };

        const wfh = await request.container!.wfhService.create(wfhData);
        return reply.status(201).send({
          success: true,
          data: wfh,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Get WFH requests
  fastify.get(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Get WFH requests',
        description: 'Get paginated list of WFH requests',
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'] },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            page: { type: 'number', minimum: 1, default: 1 },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 10 },
            search: { type: 'string', description: 'Search by employee name, reason, manager name, or status' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { userId, status, startDate, endDate, page, limit, search } = request.query as any;
        const currentUser = request.user!;
        const userRole = (currentUser as any).role?.toLowerCase() || '';

        // Build query
        const query: any = {
          page: page ? Number(page) : 1,
          limit: limit ? Number(limit) : 10,
        };

        // If userId is provided, filter by that user
        if (userId) {
          query.userId = userId;
        } else {
          // If no userId provided:
          // - For managers: show requests where they are the approver (appliedTo)
          // - For admins: show all requests
          // - For regular users: show only their own requests
          if (userRole === 'admin' || userRole === 'superadmin') {
            // Admin sees all - no userId filter
          } else if (userRole === 'manager') {
            // Manager sees requests assigned to them
            query.appliedTo = (currentUser as any)._id.toString();
          } else {
            // Regular user sees only their own
            query.userId = (currentUser as any)._id;
          }
        }

        if (status) query.status = status;
        if (startDate) query.startDate = startDate;
        if (endDate) query.endDate = endDate;
        if (search) query.search = search;

        const result = await request.container!.wfhService.findAll(query);
        return reply.send({
          success: true,
          data: result.wfhs,
          total: result.total,
          meta: result.meta,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Get WFH by ID
  fastify.get(
    '/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Get WFH by ID',
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const wfh = await request.container!.wfhService.findById(id);
        return reply.send({
          success: true,
          data: wfh,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Approve/Reject WFH request
  fastify.put(
    '/:id/status',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Approve/Reject WFH request',
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['Approved', 'Rejected', 'Cancelled'] },
            remarks: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { status, remarks } = request.body as { status: string; remarks?: string };
        const approver = request.user!;

        const wfh = await request.container!.wfhService.updateStatus(id, {
          status: status as 'Approved' | 'Rejected' | 'Cancelled',
          remarks,
          approvedById: approver._id instanceof Types.ObjectId ? approver._id : new Types.ObjectId(approver._id),
          approvedBy: {
            _id: approver._id instanceof Types.ObjectId ? approver._id : new Types.ObjectId(approver._id),
            name: approver.name,
            email: approver.email || '',
          },
        });

        return reply.send({
          success: true,
          data: wfh,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Cancel WFH request
  fastify.put(
    '/:id/cancel',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Cancel WFH request',
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const userId = request.user!._id instanceof Types.ObjectId 
          ? request.user!._id 
          : new Types.ObjectId(request.user!._id);
        const result = await request.container!.wfhService.cancel(id, userId);
        return reply.send({
          success: true,
          message: result.message,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Get WFH balance for a year
  fastify.get(
    '/balance/:year',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['WFH Management'],
        summary: 'Get WFH balance for a year',
      },
    },
    async (request, reply) => {
      try {
        const { year } = request.params as { year: string };
        const userId = request.user!._id instanceof Types.ObjectId 
          ? request.user!._id 
          : new Types.ObjectId(request.user!._id);
        const balance = await request.container!.wfhService.getWFHBalance(
          userId,
          Number(year)
        );
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
};

