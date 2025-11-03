import { FastifyInstance } from 'fastify';
import { RouteHandler } from '../types/routes';
import { authenticate } from '../middleware/auth';

export const biometricAttendanceRoutes: RouteHandler = async (
  fastify: FastifyInstance,
): Promise<void> => {
  // Process swipe
  fastify.post(
    '/swipe',
    {
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Process a biometric swipe',
        description: 'Process a biometric swipe and record attendance based on shift window in UTC',
        body: {
          type: 'object',
          required: ['biometricId'],
          properties: {
            biometricId: {
              type: 'string',
              description: 'Biometric ID of the user (can be biometric string like "EMP001" or user ObjectId like "68db63c892ad558a067939db")'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Optional timestamp of the swipe in UTC (ISO format). Defaults to current UTC time if not provided.'
            },
            location: {
              type: 'object',
              description: 'Optional GPS location data',
              properties: {
                latitude: { type: 'number', description: 'GPS latitude coordinate' },
                longitude: { type: 'number', description: 'GPS longitude coordinate' },
                accuracy: { type: 'number', description: 'GPS accuracy in meters' },
                altitude: { type: 'number', description: 'GPS altitude in meters' },
                address: { type: 'string', description: 'Human-readable address' }
              }
            },
            hasLocation: {
              type: 'boolean',
              description: 'Whether location data is available'
            },
            locationValid: {
              type: 'boolean',
              description: 'Whether the location data is valid'
            },
            locationAddress: {
              type: 'string',
              description: 'Human-readable address string'
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
                  swipeTime: {
                    type: 'string',
                    format: 'date-time',
                    description: 'UTC timestamp'
                  },
                  isWithinWindow: { type: 'boolean' },
                  isLateEntry: { type: 'boolean' },
                  isEarlyExit: { type: 'boolean' },
                  message: { type: 'string' }
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
    // biometricId BIO123456
    async (request, reply) => {
      try {
        console.log('🚀 SWIPE ROUTE HANDLER CALLED');
        console.log('📦 Raw request body:', JSON.stringify(request.body, null, 2));

        // Extract all the data from request body
        const {
          biometricId,
          timestamp = new Date().toISOString(),
          location,
          hasLocation,
          locationValid,
          locationAddress
        } = request.body as any;

        console.log('📍 Extracted values in route handler:');
        console.log('  - biometricId:', biometricId);
        console.log('  - timestamp:', timestamp);
        console.log('  - location:', location);
        console.log('  - hasLocation:', hasLocation);
        console.log('  - locationValid:', locationValid);
        console.log('  - locationAddress:', locationAddress);

        const swipeData = {
          biometricId,
          timestamp: new Date(timestamp),
          location,
          hasLocation,
          locationValid,
          locationAddress
        };

        console.log('🎯 Calling processSwipe with:', JSON.stringify(swipeData, null, 2));

        const result = await request.container!.biometricAttendanceService.processSwipe(swipeData);

        console.log('✅ ProcessSwipe result:', JSON.stringify(result, null, 2));
        return reply.send(result);
      } catch (error: any) {
        console.log('❌ Error in swipe route handler:', error);
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );

  // Get attendance status
  fastify.get(
    '/status/:userId',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Get attendance status for a user',
        description: 'Get attendance status for a specific user on a given date',
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to get attendance status for'
            }
          }
        },
        querystring: {
          type: 'object',
          required: ['date'],
          properties: {
            date: {
              type: 'string',
              format: 'date',
              description: 'Date in UTC (YYYY-MM-DD)'
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
                    shiftCode: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['incomplete', 'complete', 'duplicate_swipes', 'missing_checkout']
                    },
                    overtime: { type: 'string' },
                    shortTime: { type: 'string' },
                    firstSwipe: {
                      type: 'string',
                      format: 'date-time',
                      nullable: true
                    },
                    lastSwipe: {
                      type: 'string',
                      format: 'date-time',
                      nullable: true
                    }
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
        const result = await request.container!.biometricAttendanceService.getAttendanceStatus(
          (request.params as any).userId,
          new Date((request.query as any).date)
        );
        console.log(result, "result get status")
        const modifiedResult = {
          success: true,
          data: result.data.map(item => ({
            ...item,
            firstSwipe: item.firstSwipe || null,
            lastSwipe: item.lastSwipe || null
          }))
        };

        console.log(modifiedResult, "modifiedResult")
        return reply.send(modifiedResult);
        // return reply.send({
        //   success: true,
        //   data: result
        // });
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );

  // Get attendance records
  fastify.post(
    '/records',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Get attendance records',
        description: 'Get attendance records for specified date range and users. ',
        body: {
          type: 'object',
          required: ['startDate', 'endDate'],
          properties: {
            startDate: {
              type: 'string',
              format: 'date-time',
              description: 'Start date in UTC (YYYY-MM-DDTHH:mm:ssZ)'
            },
            endDate: {
              type: 'string',
              format: 'date-time',
              description: 'End date in UTC (YYYY-MM-DDTHH:mm:ssZ)'
            },
            userIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional array of user IDs to filter records'
            },
            page: {
              type: 'number',
              minimum: 1,
              default: 1,
              description: 'Page number for pagination'
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              default: 10,
              description: 'Number of records per page'
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
                    userId: { type: 'string' },
                    userName: { type: 'string' },
                    records: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          _id: {
                            type: 'string'
                          },
                          shiftId: {
                            type: 'string'
                          },
                          shiftDay: {
                            type: 'string',
                            format: 'date-time',
                            description: 'UTC date'
                          },
                          shiftCode: { type: 'string' },
                          shiftStart: { type: 'string', format: 'date-time', description: 'UTC date' },
                          shiftEnd: { type: 'string', format: 'date-time', description: 'UTC date' },

                          status: {
                            type: 'string',
                            enum: ['incomplete', 'complete', 'duplicate_swipes', 'missing_checkout']
                          },
                          swipes: {
                            type: 'array',
                          },
                          firstIn: { type: 'string', format: 'date-time', description: 'UTC date' },
                          lastOut: { type: 'string', format: 'date-time', description: 'UTC date' },
                          attendanceStatus: {
                            type: 'array',
                            items: {
                              type: 'string',
                              enum: ['Late', 'On-Time', 'Early-Exit', 'Absent', 'On-Leave', 'Out-Of-Window']
                            }
                          },
                          isWithinWindow: { type: 'boolean' },
                          isLateEntry: { type: 'boolean' },
                          isEarlyExit: { type: 'boolean' },
                          needsRegularization: { type: 'boolean' },
                          exceessHours: { type: 'string' },
                          shortfallHours: { type: 'string' },
                          totalWorkHours: { type: 'string' },
                          breakHours: { type: 'string' },
                          actualWorkHours: { type: 'string' },
                          shiftHours: { type: 'string' },
                          outOfWindowSwipes: {
                            type: 'array'
                          }

                        }
                      }
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        totalDays: { type: 'number' },
                        lateDays: { type: 'number' },
                        presentDays: { type: 'number' },
                        regularisedDays: { type: 'number' },
                        leaveDays: { type: 'number' }
                      }
                    }
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
      console.log('Test Records')
      console.log("0,request", request.body)
      try {
        const result = await request.container!.biometricAttendanceService.getAttendanceRecords({
          ...(request.body as any)
        });
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );

  fastify.post(
    '/records/all',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Get attendance records',
        description: 'Get attendance records for specified date range and users. ',
        body: {
          type: 'object',
          required: ['startDate', 'endDate'],
          properties: {
            startDate: {
              type: 'string',
              format: 'date-time',
              description: 'Start date in UTC (YYYY-MM-DDTHH:mm:ssZ)'
            },
            endDate: {
              type: 'string',
              format: 'date-time',
              description: 'End date in UTC (YYYY-MM-DDTHH:mm:ssZ)'
            },
            page: {
              type: 'number',
              minimum: 1,
              default: 1,
              description: 'Page number for pagination'
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              default: 10,
              description: 'Number of records per page'
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
                    userId: { type: 'string' },
                    userName: { type: 'string' },
                    records: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          shiftDay: {
                            type: 'string',
                            format: 'date-time',
                            description: 'UTC date'
                          },
                          shiftCode: { type: 'string' },
                          status: {
                            type: 'string',
                            enum: ['incomplete', 'complete', 'duplicate_swipes', 'missing_checkout']
                          },
                          overtime: {
                            type: 'string',
                            description: 'Overtime duration in HH:mm:ss format'
                          },
                          shortTime: {
                            type: 'string',
                            description: 'Short time duration in HH:mm:ss format'
                          },
                          firstSwipe: {
                            type: 'string',
                            format: 'date-time',
                            description: 'UTC timestamp',
                            nullable: true
                          },
                          lastSwipe: {
                            type: 'string',
                            format: 'date-time',
                            description: 'UTC timestamp',
                            nullable: true
                          },
                          attendanceStatus: {
                            type: 'array',
                            items: {
                              type: 'string',
                              enum: ['Late', 'On-Time', 'Early-Exit', 'Absent']
                            }
                          }
                        }
                      }
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        totalDays: { type: 'number' },
                        lateDays: { type: 'number' },
                        presentDays: { type: 'number' },
                        regularisedDays: { type: 'number' },
                        leaveDays: { type: 'number' }
                      }
                    }
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
        const userResult = await request.container!.userService.findAll({
          active: true
        });
        const userIds = userResult.users.map((user: any) => user._id);
        const result = await request.container!.biometricAttendanceService.getAttendanceRecords({
          ...(request.body as any),
          userIds
        });
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  );


  //get Attendance and shift records for user and selected dates
  fastify.post(
    '/shift-records',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Get attendance and shift records for a user',
        description: 'Fetch attendance and shift assignment records for a user for specific dates.',
        body: {
          type: 'object',
          required: ['userId', 'dates'],
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to fetch records for',
            },
            dates: {
              type: 'array',
              items: { type: 'string', format: 'date' },
              description: 'Array of dates in YYYY-MM-DD format',
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
                  attendanceRecords: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        _id: { type: 'string' },
                        userId: { type: 'string' },
                        shiftDay: { type: 'string', format: 'date-time' },
                        shiftCode: { type: 'string' },
                        swipes: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              timestamp: { type: 'string', format: 'date-time' },
                              direction: { type: 'string', enum: ['IN', 'OUT'] },
                            },
                          },
                        },
                        attendanceStatus: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                  shiftAssignments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        userId: { type: 'string' },
                        shiftId: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string' },
                            code: { type: 'string' },
                            startTime: { type: 'string' },
                            endTime: { type: 'string' },
                            shiftWindowStart: { type: 'string' },
                            shiftWindowEnd: { type: 'string' },
                          },
                        },
                        shiftCode: { type: 'string' },
                        startDate: { type: 'string', format: 'date-time' },
                        endDate: { type: 'string', format: 'date-time', nullable: true },
                        weekendDays: { type: 'array', items: { type: 'number' } },
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
        const { userId, dates } = request.body as { userId: string; dates: string[] };
        const result = await request.container!.biometricAttendanceService.getAttendanceAndShiftRecords(userId, dates);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message },
        });
      }
    }
  );

  // insert sample attandance records 
  fastify.post('/bulk-insert',
    async (request, reply) => {
      console.log("bulk-insert")
      /*{
  "userId": ["679235bfa892ecaccad0ccd5"],
  "month": 2,
  "year":2025
} */
      try {
        const { userId, month, year } = request.body as { userId: string[]; month: number; year: number };
        if (!userId || !month || !year) {
          return reply.status(400).send({ error: 'userId, month, and year are required' });
        }
        const result = await request.container!.biometricAttendanceService.insertBulkAttendanceRecords(userId, month, year);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  )

  //get attendance records by userId and date range 
  fastify.post(
    '/user-records',
    {
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Get attendance records for a user',
        description: 'Get attendance records for a specific user within a date range.',
        body: {
          type: 'object',
          required: ['userId', 'startDate', 'endDate'],
          properties: {
            userId: { type: 'string', description: 'User ID to fetch records for' },
            startDate: { type: 'string', format: 'date', description: 'Start date in UTC (YYYY-MM-DD)' },
            endDate: { type: 'string', format: 'date', description: 'End date in UTC (YYYY-MM-DD)' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId, startDate, endDate } = request.body as { userId: string; startDate: string; endDate: string };
        const result = await request.container!.biometricAttendanceService.getUserAttendanceByDateRanges(userId, startDate, endDate);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    })
  //delete
  fastify.delete(
    '/bulk-delete',
    {
      schema: {
        tags: ['Biometric Attendance'],
        summary: 'Delete attendance records in bulk',
        description: 'Delete attendance records for a specific user within a date range.',
        body: {
          type: 'object',
          required: ['userId', 'startDate', 'endDate'],
          properties: {
            userId: { type: 'string', description: 'User ID to delete records for' },
            startDate: { type: 'string', format: 'date', description: 'Start date in UTC (YYYY-MM-DD)' },
            endDate: { type: 'string', format: 'date', description: 'End date in UTC (YYYY-MM-DD)' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId, startDate, endDate } = request.body as { userId: string; startDate: string; endDate: string };
        const result = await request.container!.biometricAttendanceService.deleteUserAttendanceByDateRanges(userId, startDate, endDate);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: { message: error.message }
        });
      }
    }
  )
}; 