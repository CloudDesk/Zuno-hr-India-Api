/* eslint-disable @typescript-eslint/no-unused-vars */
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from '../middleware/auth';
import { ILeaveCreate, ILeaveQuery } from '../services/leave.service';
import { leaveSummaryRoutes } from './leave-summary.routes';
import { Leave } from '../models';
import mongoose from 'mongoose';

export const leaveRoutes: RouteHandler = async (
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> => {
  let value = await leaveSummaryRoutes(fastify);
  console.log(value, 'value');
  // Apply for leave
  fastify.post(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Apply for leave',
        description: 'Submit a new leave request',
        body: {
          type: 'object',
          required: ['leaveTypeId', 'startDate', 'endDate'],
          properties: {
            leaveTypeId: {
              type: 'string',
              description: 'Type of leave being requested'
            },
            startDate: {
              type: 'string',
              format: 'date',
              description: 'Leave start date (YYYY-MM-DD)'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'Leave end date (YYYY-MM-DD). For half-day leaves, must be same as startDate'
            },
            remarks: {
              type: 'string',
              description: 'Additional remarks for the leave request'
            },
            noOfDays: {
              type: 'number',
              description: 'Number of days for leave (0.5 for half-day, 1+ for full-day)'
            },
            reason: {
              type: 'string',
              description: 'Reason for leave'
            },
            appliedTo: {
              type: 'object',
              description: 'Leave applied'
            },
            leaveDuration: {
              type: 'string',
              enum: ['full-day', 'half-day'],
              description: 'Leave duration type (India only). Default: full-day'
            },
            halfDayType: {
              type: 'string',
              enum: ['first-half', 'second-half'],
              description: 'Half-day type - required when leaveDuration is half-day (India only)'
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
                  leaveTypeId: { type: 'string' },
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                  status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'] },
                  remarks: { type: 'string' },
                  noOfDays: { type: 'number' },
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
        // Start of Selection
        const body = request.body as {
          leaveTypeId: string;
          startDate: string;
          endDate: string;
          remarks?: string;
          leaveType?: string;
          noOfDays: number;
          reason: string;
          appliedTo: {
            _id: string;
            name: string;
          };
          leaveDuration?: 'full-day' | 'half-day';
          halfDayType?: 'first-half' | 'second-half';
        };

        const leaveData: ILeaveCreate = {
          userId: (request.user as any)._id,
          leaveTypeId: body.leaveTypeId,
          leaveType: body.leaveType,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          remarks: body.remarks,
          noOfDays: body.noOfDays,
          reason: body.reason,
          appliedTo: body.appliedTo,
          leaveDuration: body.leaveDuration || 'full-day',
          halfDayType: body.halfDayType,
        };
        console.log(leaveData, 'leaveData insert');
        const leave = await request.container!.leaveService.create(leaveData);
        return reply.status(201).send({
          success: true,
          data: leave,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  //delete collection all data
  fastify.post(
    '/delete-collection-data',
    {
      schema: {
        tags: ['Admin Operations'],
        summary: 'Delete all documents from a collection',
        description: 'Deletes all documents from the specified MongoDB collection.',
        body: {
          type: 'object',
          required: ['collectionName'],
          properties: {
            collectionName: {
              type: 'string',
              description: 'Name of the collection to clear',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { collectionName } = request.body as { collectionName: string };
        console.log(collectionName, 'collectionName');
        if (!collectionName) {
          return reply.status(400).send({
            success: false,
            error: 'Collection name is required',
          });
        }

        // Check if the collection exists
        const collectionExists = await mongoose.connection.db
          .listCollections({ name: collectionName })
          .hasNext();

        if (!collectionExists) {
          return reply.status(400).send({
            success: false,
            error: `Collection "${collectionName}" does not exist`,
          });
        }

        // Clear the collection
        await mongoose.connection.collection(collectionName).deleteMany({});

        return reply.status(200).send({
          success: true,
          message: `All documents from collection "${collectionName}" have been deleted.`,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message || 'An error occurred while deleting collection data.',
        });
      }
    }
  );

  // Get leave requests (for user or admin)
  fastify.get(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Get leave requests',
        description: 'Get paginated list of leave requests with optional filters',
        querystring: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'Filter by user ID'
            },
            status: {
              type: 'string',
              enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
              description: 'Filter by leave status'
            },
            startDate: {
              type: 'string',
              format: 'date',
              description: 'Filter by start date'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'Filter by end date'
            },
            page: {
              type: 'number',
              minimum: 1,
              default: 1,
              description: 'Page number'
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              default: 10,
              description: 'Records per page'
            },
            search: {
              type: 'string',
              description: 'Search by employee name, leave type, reason, manager name, or status'
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    _id: { type: 'string' },
                    userId: { type: 'string' },
                    leaveTypeId: { type: 'string' },
                    leaveType: { type: 'string' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected'] },
                    remarks: { type: 'string' },
                    reason: { type: 'string' },
                    appliedTo: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                  }
                }
              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' }
                }
              }
            }
          }
        }
      },
    },
    async (request, reply) => {
      try {
        const { userId, status, startDate, endDate, page, limit, search } = request.query as any;
        const query: ILeaveQuery = {
          userId: userId,
          status: status ? status : undefined,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
          search: search,
        };
        console.log(query, "1 query");
        const result = await request.container!.leaveService.findAll(query);
        return reply.send({
          success: true,
          data: result.leaves,
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

  // Approve/Reject leave request
  fastify.put(
    '/:id/status',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Approve/Reject leave request',
        description: 'Approve or reject a leave request',
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['Approved', 'Rejected', 'Cancelled'] },
            remarks: { type: 'string' },
            reason: { type: 'string' },
            appliedTo: { type: 'string' },
            noOfDays: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updateData = {
          ...(request.body as any),
          approvedBy: { _id: (request.user as any)._id, name: (request.user as any).name, email: (request.user as any).email },
        };

        const leave = await request.container!.leaveService.updateStatus(id, updateData);
        console.log(Leave, 'Leave data');
        return reply.send({
          success: true,
          data: leave,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  // Cancel leave request
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Cancel leave request',
        description: 'Cancel a leave request',
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const result = await request.container!.leaveService.cancel(id, (request.user as any)._id);
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
  //get leave based on id
  fastify.get(
    '/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Get leave requests',
        description: 'Get Leave Data Based on ID',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  _id: { type: 'string' },
                  userId: { type: 'string' },
                  leaveTypeId: { type: 'string' },
                  leaveType: { type: 'string' },
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                  status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'] },
                  remarks: { type: 'string' },
                  noOfDays: { type: 'number' },
                  reason: { type: 'string' },
                  appliedTo: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string' },
                      name: { type: 'string' },
                    },
                  },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                  user: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                  approvedBy: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                }

              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' }
                }
              }
            }
          }
        }
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const Leave = await request.container!.leaveService.findById(id);
        console.log(Leave, 'Route leave');
        if (!Leave) {
          return reply.status(404).send({
            success: false,
            error: { message: 'Leave not found' },
          });
        }
        console.log(Leave, 'Route leave 2');

        return reply.send({
          success: true,
          data: Leave,
        });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    },
  );

  fastify.get(
    '/userId/:userId',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Get leave requests By user Id',
        description: 'Get Leave Data Based on userId with optional filters',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            limit: { type: 'number', default: 20 },
            search: { type: 'string' },
            status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'] },
            leaveType: { type: 'string' },
            startDate: { type: 'string', format: 'date' }, // YYYY-MM-DD
            endDate: { type: 'string', format: 'date' },   // YYYY-MM-DD
            sortBy: { type: 'string', default: 'startDate' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
        params: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    _id: { type: 'string' },
                    userId: { type: 'string' },
                    leaveTypeId: { type: 'string' },
                    leaveType: { type: 'string' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'] },
                    remarks: { type: 'string' },
                    noOfDays: { type: 'number' },
                    reason: { type: 'string' },
                    appliedTo: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                    user: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                    approvedBy: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        name: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { userId } = request.params as { userId: string };
        const {
          page = 1,
          limit = 10,
          search,
          status,
          leaveType,
          startDate,
          endDate,
          sortBy = 'startDate',
          sortOrder = 'desc',
        } = request.query as {
          page?: number;
          limit?: number;
          search?: string;
          status?: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
          leaveType?: string;
          startDate?: string;
          endDate?: string;
          sortBy?: string;
          sortOrder?: 'asc' | 'desc';
        };

        // Optional: Validate date range
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
          return reply.status(400).send({
            success: false,
            error: { message: 'endDate must be on or after startDate' },
          });
        }

        const filters = {
          search,
          status,
          leaveType,
          startDate,
          endDate,
        };

        const { leaves, total } = await request.container!.leaveService.findByUserId(userId, filters, {
          page: Number(page),
          limit: Number(limit),
          sortBy,
          sortOrder,
        });

        return reply.send({
          success: true,
          data: leaves,
          meta: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error: any) {
        console.error(error, 'Error fetching leaves');
        return reply.status(400).send({
          success: false,
          error: { message: error.message || 'Failed to fetch leaves' },
        });
      }
    }
  );

  // Get leave balance
  fastify.get(
    '/balance/:leaveTypeId',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Get leave balance',
        description: 'Get the leave balance for a specific leave type',
      },
    },
    async (request, reply) => {
      try {
        const { leaveTypeId } = request.params as { leaveTypeId: string };
        const balance = await request.container!.leaveService.getLeaveBalance((request.user as any)._id, leaveTypeId);
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

  //GET leaves appliedTo
  fastify.get(
    '/applied-to/:appliedTo',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Leave Management'],
        summary: 'Get leave requests by appliedTo',
        description: 'Get Leave Data Based on appliedTo field',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    _id: { type: 'string' },
                    userId: { type: 'string' },
                    leaveTypeId: { type: 'string' },
                    leaveType: { type: 'string' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    status: { type: 'string', enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'] },
                    reason: { type: 'string' },
                    remarks: { type: 'string' },
                    appliedTo: {
                      type: 'object',
                      properties: {
                        _id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                    user: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                    noOfDays: { type: 'number' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' }
                  }
                }
              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' }
                }
              }
            },
            required: ['success', 'data', 'meta']
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { appliedTo } = request.params as { appliedTo: string };
        const { userId, status, startDate, endDate, page, limit } = request.query as any;
        const query: ILeaveQuery = {
          appliedTo,
          userId: userId,
          status: status ? status : undefined,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
        };

        const leaveData = await request.container!.leaveService.getLeavesByAppliedTo(query);
        console.log(leaveData, 'Route leave');

        // if (!leaveData || !leaveData.data || leaveData.data.length === 0) {
        //   return reply.status(404).send({
        //     success: false,
        //     error: { message: 'No leaves found' },
        //   });
        // }

        return reply.send({
          success: true,
          data: leaveData.data,
          meta: leaveData.meta
        });
      } catch (error: any) {
        console.log(error, 'error');
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    }
  );
};
