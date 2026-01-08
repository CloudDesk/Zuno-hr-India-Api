import { FastifyInstance, } from "fastify";
import { authenticate } from "../middleware/auth";
import { ITaxDeclarationCreate, ITaxDeclarationUpdate } from "../services/tax-declaration.service";
import { Types } from "mongoose";
import { filesUpload } from "../config/multer";

export async function taxDeclarationRoutes(fastify: FastifyInstance): Promise<void> {
    //get all tax declarations
    fastify.get('/', { preHandler: [authenticate] },
        async (request, reply) => {
            console.log(request.query, "request salary structre");
            const { page, limit, search } = request.query as { page?: number; limit?: number; search?: string };
            console.log(page, limit, search, "*****")

            try {
                const result = await request.container!.taxDeclarationService.findAll({ page, limit, search });
                return reply.send({
                    success: true,
                    data: result.taxDeclarations,
                    meta: result.meta
                })
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )
    //create a new tax declaration
    fastify.post('/', { preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const taxDeclaration = await request.container!.taxDeclarationService.create(request.body as ITaxDeclarationCreate);
                return reply.send({
                    success: true,
                    data: taxDeclaration,
                })
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )
    //update a tax declaration
    fastify.put('/:id', { preHandler: [authenticate] },
        async (request, reply) => {
            try {
                const taxDeclaration = await request.container!.taxDeclarationService.update(request.body as ITaxDeclarationUpdate);
                return reply.send({
                    success: true,
                    data: taxDeclaration,
                })
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )
    //get a tax declaration Current FY and userId
    fastify.get('/user/:userId/current-fy', { preHandler: [authenticate] },
        async (request, reply) => {
            console.log("first", request.params)
            try {
                const { userId }: any = request.params;
                console.log(userId, "userId")
                const declaration = await request.container!.taxDeclarationService.getUserCurrentFY(new Types.ObjectId(userId));
                if (!declaration) {
                    return reply.status(404).send({
                        success: false,
                        error: {
                            message: 'Tax declaration not found'
                        }
                    });
                }
                return reply.send({
                    success: true,
                    data: declaration,
                });
            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message },
                });
            }
        }
    )
    //Tax declartion -declarations documents
    fastify.post<{ Params: { id: string } }>('/:id/update-documents',
        {
            preHandler: [authenticate, filesUpload],
        },
        async (request, reply) => {
            console.log(request.files, "req files")
            try {
                const { id } = request.params;
                console.log(id, "id")

                let taxDeclaration = await request.container!.taxDeclarationService.updateDocuments(new Types.ObjectId(id), request)
                console.log(taxDeclaration, "taxDeclaration routes")
                return reply.send({
                    success: true,
                    data: taxDeclaration
                });

            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    )
    //Tax declartion -review declarations documents
    fastify.post<{ Params: { id: string } }>('/:id/review',
        {
            preHandler: [authenticate],
        },
        async (request, reply) => {
            try {
                const { id } = request.params;
                const updateData = {
                    ...(request.body as any),
                    userInfo: { _id: (request.user as any)._id, name: (request.user as any).name, email: (request.user as any).email },
                };

                let taxDeclaration = await request.container!.taxDeclarationService.reviewDeclarations(new Types.ObjectId(id), updateData)
                console.log(taxDeclaration, "taxDeclaration routes")
                return reply.send({
                    success: true,
                    data: taxDeclaration
                });

            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    )

    // Bulk enable Form12B for migration (Admin only - one-time operation)
    fastify.post('/bulk-enable-form12b',
        {
            preHandler: [authenticate]
        },
        async (request, reply) => {
            try {
                const { employeeIds, financialYear } = request.body as {
                    employeeIds: string[];
                    financialYear: string;
                };

                // Validate input
                if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
                    return reply.status(400).send({
                        success: false,
                        error: { message: 'employeeIds must be a non-empty array' }
                    });
                }

                if (!financialYear) {
                    return reply.status(400).send({
                        success: false,
                        error: { message: 'financialYear is required' }
                    });
                }

                const result = await request.container!.taxDeclarationService.bulkEnableForm12B({
                    employeeIds,
                    financialYear
                });

                return reply.send({
                    success: result.success,
                    message: `Form12B enabled for ${result.updated} employee(s)`,
                    data: {
                        updated: result.updated,
                        failed: result.failed.length,
                        failedEmployees: result.failed,
                        details: result.details
                    }
                });

            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    )

    // Bulk create tax declarations for migration (Admin only - one-time operation)
    fastify.post('/bulk-create',
        {
            preHandler: [authenticate]
        },
        async (request, reply) => {
            try {
                const { employeeIds, financialYear, regime } = request.body as {
                    employeeIds: string[];
                    financialYear: string;
                    regime: 'new' | 'old';
                };

                // Validate input
                if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
                    return reply.status(400).send({
                        success: false,
                        error: { message: 'employeeIds must be a non-empty array' }
                    });
                }

                if (!financialYear) {
                    return reply.status(400).send({
                        success: false,
                        error: { message: 'financialYear is required' }
                    });
                }

                if (!regime || (regime !== 'new' && regime !== 'old')) {
                    return reply.status(400).send({
                        success: false,
                        error: { message: 'regime must be either "new" or "old"' }
                    });
                }

                const result = await request.container!.taxDeclarationService.bulkCreateTaxDeclarations({
                    employeeIds,
                    financialYear,
                    regime
                });

                return reply.send({
                    success: result.success,
                    message: `Created: ${result.created}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
                    data: {
                        created: result.created,
                        skipped: result.skipped,
                        skippedEmployees: result.skippedEmployees,
                        failed: result.failed,
                        failedEmployees: result.failedEmployees,
                        details: result.details
                    }
                });

            } catch (error: any) {
                return reply.status(400).send({
                    success: false,
                    error: { message: error.message }
                });
            }
        }
    )
}