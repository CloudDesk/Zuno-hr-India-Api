import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { parseMultipartForm } from '../utilis/parseMultiPartForm';
import { authenticate } from '../middleware/auth';

export const communicationRoutes = async (fastify: FastifyInstance) => {
    // 1. Send Manual Greeting/Event
    fastify.post('/send-greeting', {
        preHandler: [authenticate],
        schema: {
            response: {
                200: Type.Object({
                    success: Type.Boolean(),
                    data: Type.Object({
                        success: Type.Boolean(),
                        socialEventId: Type.String(),
                        total: Type.Number(),
                        results: Type.Array(Type.Any()),
                        assignedRecipients: Type.Array(Type.Object({
                            _id: Type.String(),
                            name: Type.String(),
                            email: Type.Optional(Type.String()),
                            employeeCode: Type.Optional(Type.String())
                        })),
                        assignmentHistory: Type.Array(Type.Any()),
                        attachments: Type.Array(Type.String()),
                        active: Type.Boolean(),
                        type: Type.String()
                    })
                })
            }
        },
        handler: async (request, _reply) => {
            const { communicationService } = request.container!;
            const { body, files } = await parseMultipartForm(request);

            // Handle employeeIds if sent as a JSON string or individual parts
            let employeeIds = body.employeeIds;
            if (typeof employeeIds === 'string') {
                try {
                    employeeIds = JSON.parse(employeeIds);
                } catch {
                    employeeIds = [employeeIds];
                }
            }

            const result = await communicationService.sendPersonalizedGreeting({
                employeeIds,
                type: body.type,
                subject: body.subject,
                message: body.message,
                eventDate: body.eventDate,
                files,
                adminId: (request.user as any)._id,
                socialEventId: body.socialEventId,
                active: body.active === undefined
                    ? undefined
                    : body.active === true || body.active === 'true',
                retainedAttachments: (() => {
                    if (body.retainedAttachments === undefined) return undefined;
                    if (Array.isArray(body.retainedAttachments)) return body.retainedAttachments;
                    try {
                        const parsed = JSON.parse(body.retainedAttachments);
                        if (!Array.isArray(parsed)) {
                            throw new Error('Retained attachments must be an array');
                        }
                        return parsed;
                    } catch {
                        throw new Error('Retained attachments must be a valid JSON array');
                    }
                })()
            });
            return { success: true, data: result };
        }
    });

    // Activate/deactivate a manual communication without removing its history.
    fastify.patch('/:id/status', {
        preHandler: [authenticate],
        schema: {
            params: Type.Object({ id: Type.String() }),
            body: Type.Object({ active: Type.Boolean() }),
            response: {
                200: Type.Object({
                    success: Type.Boolean(),
                    data: Type.Any()
                })
            }
        },
        handler: async (request, reply) => {
            if ((request.user as any).role !== 'admin') {
                return reply.status(403).send({
                    success: false,
                    error: { message: 'Access denied. Admin role required.' }
                });
            }
            const { communicationService } = request.container!;
            const { id } = request.params as { id: string };
            const { active } = request.body as { active: boolean };
            const event = await communicationService.updateCommunicationStatus(id, active);
            return { success: true, data: event };
        }
    });

    // 2. Get Social Wall Events
    fastify.get('/social-wall', {
        preHandler: [authenticate],
        schema: {
            querystring: Type.Object({
                limit: Type.Optional(Type.Number({ default: 10 })),
                offset: Type.Optional(Type.Number({ default: 0 }))
            }),
            response: {
                200: Type.Array(Type.Any())
            }
        },
        handler: async (request, _reply) => {
            const { communicationService } = request.container!;
            const events = await communicationService.getSocialWall(request.query as any);
            return events;
        }
    });

    // 3. Get Communication Logs (Manual historical dispatches)
    fastify.get('/logs', {
        preHandler: [authenticate],
        schema: {
            querystring: Type.Object({
                limit: Type.Optional(Type.Number({ default: 10 })),
                page: Type.Optional(Type.Number({ default: 1 })),
                search: Type.Optional(Type.String()),
                month: Type.Optional(Type.Number()),
                year: Type.Optional(Type.Number())
            }),
            response: {
                200: Type.Object({
                    success: Type.Optional(Type.Boolean()),
                    data: Type.Object({
                        data: Type.Array(Type.Any()),
                        meta: Type.Object({
                            total: Type.Number(),
                            page: Type.Number(),
                            limit: Type.Number(),
                            totalPages: Type.Number()
                        })
                    })
                })
            }
        },
        handler: async (request, _reply) => {
            const { communicationService } = request.container!;
            const events = await communicationService.getCommunicationLogs(request.query as any);
            return { success: true, data: events };
        }
    });

    fastify.get('/my-history', {
        preHandler: [authenticate],
        schema: {
            querystring: Type.Object({
                limit: Type.Optional(Type.Number({ default: 10 })),
                page: Type.Optional(Type.Number({ default: 1 })),
                search: Type.Optional(Type.String()),
                type: Type.Optional(Type.String()),
                month: Type.Optional(Type.Number()),
                year: Type.Optional(Type.Number())
            }),
            response: {
                200: Type.Object({
                    success: Type.Boolean(),
                    data: Type.Object({
                        data: Type.Array(Type.Any()),
                        meta: Type.Object({
                            total: Type.Number(),
                            page: Type.Number(),
                            limit: Type.Number(),
                            totalPages: Type.Number()
                        })
                    })
                })
            }
        },
        handler: async (request, _reply) => {
            const { communicationService } = request.container!;
            const events = await communicationService.getMyCommunicationHistory(request.query as any);
            return { success: true, data: events };
        }
    });

    // 4. Trigger Milestones (Admin only / Manual trigger)
    fastify.post('/trigger-milestones', {
        preHandler: [authenticate],
        schema: {
            response: {
                200: Type.Object({
                    success: Type.Boolean(),
                    data: Type.Object({
                        birthdays: Type.Number(),
                        anniversaries: Type.Number()
                    })
                })
            }
        },
        handler: async (request, _reply) => {
            const { communicationService } = request.container!;
            const stats = await communicationService.processDailyMilestones();
            return { success: true, data: stats };
        }
    });
};
