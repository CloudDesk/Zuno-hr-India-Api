import { FastifyInstance, } from "fastify";
import { authenticate } from "../middleware/auth";
import { ISalaryAssignmentCreate, ISalaryAssignmentUpdate } from '../services/salary-assignment.service'
import { Types } from "mongoose";


export async function salaryAssignmenteRoutes(fastify: FastifyInstance): Promise<void> {

    fastify.get('/',
        { preHandler: [authenticate] },
        async (request, reply) => {
            console.log(request, "request");
            try {
                const structure = await request.container!.salaryAssignmentService.findAll();
                return reply.send({
                    success: true,
                    data: structure,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )

    fastify.post('/', { preHandler: [authenticate] },
        async (request, reply) => {

            try {
                const structure = await request.container!.salaryAssignmentService.create(request.body as ISalaryAssignmentCreate);
                return reply.send({
                    success: true,
                    data: structure,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }

        }
    )

    fastify.put('/:id', { preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const structure = await request.container!.salaryAssignmentService.update(request.body as ISalaryAssignmentUpdate);
                return reply.send({
                    success: true,
                    data: structure,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )

    fastify.get('/user/:userId', { preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const { userId } = request.params as { userId: string };
                if (!Types.ObjectId.isValid(userId)) {
                    return reply.status(400).send({ success: false, error: { message: "Invalid userId" } });
                }
                const assignments = await request.container!.salaryAssignmentService.findByUserId(new Types.ObjectId(userId));
                return reply.send({
                    success: true,
                    data: assignments,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )

    fastify.get('/user/:userId/active', { preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const { userId } = request.params as { userId: string };
                if (!Types.ObjectId.isValid(userId)) {
                    return reply.status(400).send({ success: false, error: { message: "Invalid userId" } });
                }

                const activeAssignment = await request.container!.salaryAssignmentService.findActiveByUserId(new Types.ObjectId(userId));
                return reply.send({
                    success: true,
                    data: activeAssignment,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        })
}