import { FastifyInstance } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from "../middleware/auth";
import { Types } from "mongoose";


export const attendanceRegularizeRoutes: RouteHandler = async (
    fastify: FastifyInstance,
): Promise<void> => {
    //create regularization Bulk request 
    fastify.post(
        '/bulk',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Attendance Regularization'],
                summary: 'Create bulk attendance regularizations',
                description: 'Create regularization requests for multiple days and users.',
                body: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['userId', 'date', 'fromTime', 'toTime', 'reason', 'shiftType', 'approver'],
                        properties: {
                            userId: { type: 'string', description: 'User ID' },
                            date: { type: 'string', format: 'date', description: 'Date in YYYY-MM-DD format' },
                            fromTime: { type: 'string', description: 'Start time in HH:mm format' },
                            toTime: { type: 'string', description: 'End time in HH:mm format' },
                            reason: { type: 'string', description: 'Reason for regularization' },
                            shiftType: { type: 'string', description: 'Shift type (e.g., GEN)' },
                            attendanceId: { type: 'string', nullable: true, description: 'Attendance record ID (if exists)' },
                            approver: {
                                type: 'object',
                                required: ['id', 'name'],
                                properties: {
                                    id: { type: 'string', description: 'Approver ID' },
                                    name: { type: 'string', description: 'Approver name' },
                                },
                            },
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
                                        success: { type: 'boolean' },
                                        regularization: {
                                            type: 'object',
                                            properties: {
                                                _id: { type: 'string' },
                                                attendanceId: { type: 'string' },
                                                from: { type: 'string', format: 'date-time' },
                                                to: { type: 'string', format: 'date-time' },
                                                reason: { type: 'string' },
                                                status: { type: 'string' },
                                                approver: {
                                                    type: 'object',
                                                    properties: {
                                                        id: { type: 'string' },
                                                        name: { type: 'string' },
                                                    },
                                                },
                                                approvedDate: { type: 'string', format: 'date-time', nullable: true },
                                                comments: { type: 'string', nullable: true },
                                            },
                                        },
                                        attendance: {
                                            type: 'object',
                                            properties: {
                                                _id: { type: 'string' },
                                                shiftDay: { type: 'string', format: 'date-time' },
                                                shiftCode: { type: 'string' },
                                                attendanceStatus: { type: 'array', items: { type: 'string' } },
                                                needsRegularization: { type: 'boolean' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            try {
                const data = request.body as Array<{
                    userId: string;
                    date: string;
                    fromTime: string;
                    toTime: string;
                    reason: string;
                    shiftType: string;
                    attendanceId?: string | null;
                    approver: { id: string; name: string };
                }>;
                // const attendanceRegularizationService = new AttendanceRegularizationService();

                // request.container!.biometricAttendanceService.processSwipe

                const result = await request.container!.attendanceRegularizationService.createBulkRegularization(
                    data
                );
                return reply.send({ success: true, data: result });
            } catch (error: any) {
                return reply.status(400).send({ success: false, error: { message: error.message } });
            }
        }
    );

    // Create regularization request
    fastify.post(
        '/',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Biometric Attendance'],
                summary: 'Request attendance regularization',
                description: 'Request regularization for a specific attendance record',
                body: {
                    type: 'object',
                    required: ['attendanceId', 'status', 'approver', 'from', 'to', 'reason', 'shiftDay'],
                    properties: {

                        attendanceId: {
                            type: 'string',
                            description: 'Attendance record ID'
                        },
                        status: {
                            type: 'string',
                            enum: ['Approved', 'Rejected', 'Pending'],
                            description: 'New status of the regularization request'
                        },
                        approver: {
                            type: 'object',
                            required: ['id', 'name'],
                            properties: {
                                id: {
                                    type: 'string',
                                    description: 'Approver ID'
                                },
                                name: {
                                    type: 'string',
                                    description: 'Approver name'
                                }
                            }
                        },
                        from: {
                            type: 'string',
                            format: 'date-time',
                            description: 'From date'
                        },
                        to: {
                            type: 'string',
                            format: 'date-time',
                            description: 'To date'
                        },
                        shiftDay: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Shift date'
                        },
                        reason: {
                            type: 'string',
                            description: 'Reason for regularization'
                        }
                    }
                },
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: {
                                type: 'object',
                                properties: {
                                    _id: { type: 'string' },
                                    attendanceId: { type: 'string' },
                                    from: { type: 'string', format: 'date-time' },
                                    to: { type: 'string', format: 'date-time' },
                                    reason: { type: 'string' },
                                    status: { type: 'string' },
                                    approver: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            name: { type: 'string' }
                                        }
                                    },
                                    approvedDate: { type: 'string', format: 'date-time' },
                                    comments: { type: 'string' }
                                }
                            }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            try {

                const userId = request.user._id;
                const payload = {
                    ...request.body as any,
                    userId
                }
                console.log(payload, "payload /reguralize")

                const result = await request.container!.attendanceRegularizationService.createRegularization(
                    payload
                );

                return reply.send({
                    success: true,
                    data: result
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    );

    // Update regularization status
    fastify.put(
        '/:id/status',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Biometric Attendance'],
                summary: 'Update regularization status',
                description: 'Update the status of an attendance regularization request',
                params: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                        id: {
                            type: 'string',
                            description: 'Regularization request ID'
                        }
                    }
                },
                body: {
                    type: 'object',
                    required: ['status', 'approver'],
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['Approved', 'Rejected'],
                            description: 'New status of the regularization request'
                        },
                        approver: {
                            type: 'object',
                            required: ['id', 'name'],
                            properties: {
                                id: {
                                    type: 'string',
                                    description: 'Approver ID'
                                },
                                name: {
                                    type: 'string',
                                    description: 'Approver name'
                                }
                            }
                        },
                        comments: {
                            type: 'string',
                            description: 'Optional comments'
                        }
                    }
                },
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: {
                                type: 'object',
                                properties: {
                                    _id: { type: 'string' },
                                    attendanceId: { type: 'string' },
                                    from: { type: 'string', format: 'date-time' },
                                    to: { type: 'string', format: 'date-time' },
                                    reason: { type: 'string' },
                                    status: { type: 'string' },
                                    approver: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            name: { type: 'string' }
                                        }
                                    },
                                    approvedDate: { type: 'string', format: 'date-time' },
                                    comments: { type: 'string' }
                                }
                            }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            console.log("regularizations", request.body)
            try {
                const { id } = request.params as any;
                const { status, approver, comments } = request.body as any;


                const result = await request.container!.attendanceRegularizationService.updateRegularizationStatus(
                    new Types.ObjectId(id),
                    status,
                    approver,
                    comments
                );
                console.log(result, " result status update")
                return reply.send({
                    success: true,
                    data: result
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    );

    // Get My Regularization Records
    fastify.get<{
        Params: { userId: string };
        Querystring: {
            status?: 'Pending' | 'Approved' | 'Rejected' | 'Rejected-Absent' | 'Rejected-Leave' | 'Withdrawn';
            statuses?: string; // Comma-separated statuses
            allStatus?: boolean;
            date?: string;
            startDate?: string;
            endDate?: string;
        };
    }>(
        '/:userId',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Attendance Regularization'],
                summary: 'Get attendance regularization records by userId',
                description: 'Fetch attendance regularization records for a specific user, optionally filtered by status and date range.',
                params: {
                    type: 'object',
                    required: ['userId'],
                    properties: {
                        userId: { type: 'string', description: 'User ID to fetch regularization records for' }
                    }
                },
                querystring: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['Pending', 'Approved', 'Rejected', 'Rejected-Absent', 'Rejected-Leave', 'Withdrawn'],
                            default: 'Pending',
                            description: 'Filter by regularization status (legacy parameter)'
                        },
                        statuses: {
                            type: 'string',
                            description: 'Comma-separated list of statuses to filter by (e.g., "Pending,Approved")'
                        },
                        allStatus: {
                            type: 'boolean',
                            default: false,
                            description: 'If true, returns records for all statuses (overrides status and statuses parameters)'
                        },
                        date: {
                            type: 'string',
                            format: 'date',
                            description: 'Single date in YYYY-MM-DD format (legacy parameter)'
                        },
                        startDate: {
                            type: 'string',
                            format: 'date',
                            description: 'Start date for date range filtering in YYYY-MM-DD format'
                        },
                        endDate: {
                            type: 'string',
                            format: 'date',
                            description: 'End date for date range filtering in YYYY-MM-DD format'
                        }
                    }
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
                                        attendanceId: { type: 'string' },
                                        shiftDay: { type: 'string', format: 'date-time' },
                                        from: { type: 'string', format: 'date-time' },
                                        to: { type: 'string', format: 'date-time' },
                                        reason: { type: 'string' },
                                        status: {
                                            type: 'string',
                                            enum: ['Approved', 'Rejected', 'Pending', 'Rejected-Absent', 'Rejected-Leave', 'Withdrawn']
                                        },
                                        approver: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string' },
                                                name: { type: 'string' }
                                            }
                                        },
                                        approvedDate: { type: 'string', format: 'date-time', nullable: true },
                                        comments: { type: 'string', nullable: true }
                                    }
                                }
                            }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            try {
                const { userId } = request.params;
                const {
                    status = 'Pending',
                    statuses,
                    allStatus = false,
                    date,
                    startDate,
                    endDate
                } = request.query;
                /*
                // Get all statuses
                GET /:userId?allStatus=true
                // Get multiple statuses
                GET /:userId?statuses=Pending,Approved
                // Get date range
                GET /:userId?startDate=2024-01-01&endDate=2024-01-31
                // Legacy usage (still works)
                GET /:userId?status=Pending&date=2024-01-15
                // Combined filtering
                GET /:userId?statuses=Pending,Approved&startDate=2024-01-01&endDate=2024-01-31
                */
                const result = await request.container!.attendanceRegularizationService.getRegularizationRecords(
                    userId,
                    {
                        status,
                        statuses,
                        allStatus,
                        date,
                        startDate,
                        endDate
                    }
                );

                return reply.send({
                    success: true,
                    data: result
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    );

    // Get Assigned Regularization Records
    fastify.get<{
        Params: { approverId: string };
        Querystring: {
            status?: 'Pending' | 'Approved' | 'Rejected' | 'Rejected-Absent' | 'Rejected-Leave' | 'Withdrawn';
            allStatus?: boolean;
            date?: string;
            startDate?: string;
            endDate?: string;
            isAdmin?: boolean;
        };
    }>(
        '/assigned/:approverId',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Attendance Regularization'],
                summary: 'Get assigned attendance regularization records by approverId',
                description: 'Fetch attendance regularization records assigned to a specific approver, optionally filtered by status, date, and admin override.',
                params: {
                    type: 'object',
                    required: ['approverId'],
                    properties: {
                        approverId: { type: 'string', description: 'Approver ID to fetch assigned regularization records for' }
                    }
                },
                querystring: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['Pending', 'Approved', 'Rejected', 'Rejected-Absent', 'Rejected-Leave', 'Withdrawn'],
                            default: 'Pending',
                            description: 'Filter by regularization status'
                        },
                        allStatus: {
                            type: 'boolean',
                            default: false,
                            description: 'If true, returns records for all statuses'
                        },
                        date: {
                            type: 'string',
                            format: 'date',
                            description: 'Optional date in YYYY-MM-DD format'
                        },
                        startDate: {
                            type: 'string',
                            format: 'date',
                            description: 'Start date for date range filtering'
                        },
                        endDate: {
                            type: 'string',
                            format: 'date',
                            description: 'End date for date range filtering'
                        },
                        isAdmin: {
                            type: 'boolean',
                            default: false,
                            description: 'Admin flag to view all regularization records'
                        }
                    }
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
                                        attendanceId: { type: 'string' },
                                        shiftDay: { type: 'string', format: 'date-time' },
                                        from: { type: 'string', format: 'date-time' },
                                        to: { type: 'string', format: 'date-time' },
                                        reason: { type: 'string' },
                                        status: {
                                            type: 'string',
                                            enum: ['Approved', 'Rejected', 'Pending', 'Rejected-Absent', 'Rejected-Leave']
                                        },
                                        approver: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string' },
                                                name: { type: 'string' }
                                            }
                                        },
                                        approvedDate: { type: 'string', format: 'date-time', nullable: true },
                                        comments: { type: 'string', nullable: true },
                                        userId: { type: 'string' },
                                        userName: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: { type: 'object', properties: { message: { type: 'string' } } }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            try {
                const { approverId } = request.params;
                const { status = 'Pending', allStatus = false, date, startDate, endDate, isAdmin = false } = request.query;
                const result = await request.container!.attendanceRegularizationService.getAssignedRegularizationRecords(
                    approverId,
                    allStatus ? undefined : status,
                    isAdmin,
                    date,
                    undefined, // search
                    startDate,
                    endDate
                );
                console.log(result, "result route getAssignedRegularizationRecords")
                return reply.send({
                    success: true,
                    data: result
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    );

    // Withdraw regularization request
    fastify.put(
        '/:id/withdraw',
        {
            onRequest: [authenticate],
            schema: {
                tags: ['Attendance Regularization'],
                summary: 'Withdraw attendance regularization request',
                description: 'Withdraw a pending regularization request by updating its status',
                params: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                        id: {
                            type: 'string',
                            description: 'Regularization request ID'
                        }
                    }
                },
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            message: { type: 'string' }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', default: false },
                            error: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                await request.container!.attendanceRegularizationService.withdrawRegularization(id);

                return reply.send({
                    success: true,
                    message: 'Regularization request withdrawn successfully'
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    );
}