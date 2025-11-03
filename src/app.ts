import dotenv from 'dotenv';
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";

// const parentDir = path.resolve(__dirname, '../../api-server');
// const uploadsDir = path.join(parentDir, 'uploads');
// console.log(parentDir, uploadsDir, ' uploadsDir in INdex')

dotenv.config();

// Set timezone to UTC
process.env.TZ = 'UTC';

import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { routes } from './routes';
import { Container } from './container';
import { ServiceContainer } from './types/container';
import { connectDB } from './config/database';
import { config } from './config';
import fastifyMultipart from '@fastify/multipart';
import { fileURLToPath } from 'url';
import path, { join } from "path";

const currentFileUrl = fileURLToPath((require('url').pathToFileURL(__filename)).toString());
const currentDir = path.dirname(currentFileUrl);

const filename = __filename;
const dirname = __dirname;

const parentDir = path.resolve(__dirname, "..");
console.log(currentDir, "currentDir");
console.log(filename, "filename");
console.log(dirname, "dirname");
console.log(dirname, "dirname in app.ts");
/*const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const parentDir = resolve(__dirname, "..");
 
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
 
fastify.register(fastifyStatic, {
  root: join(parentDir, "/uploads"),
});
 
*/

declare module 'fastify' {
  interface FastifyRequest {
    container?: ServiceContainer;
  }
}

export async function createApp(): Promise<FastifyInstance> {
  // Connect to MongoDB
  await connectDB();
  console.log(config.corsOrigins, "corsOrginins")

  const app = fastify({
    logger: true,
  });


  // Register plugins in order: cookie -> jwt -> cors
  await app.register(cookie, {
    secret: config.cookieSecret || config.jwtSecret,
    hook: 'onRequest'
  });

  await app.register(jwt, {
    secret: config.jwtSecret
  });

  await app.register(cors, {
    origin: config.corsOrigins || '*',
    credentials: true,
  });

  // await app.register(multipart, {
  //   limits: {
  //     fileSize: 150 * 1024 * 1024, // 150 MB
  //     files: 10 // Limit number of files
  //   },
  //   attachFieldsToBody: true
  // });





  // Register Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'HRMS API Documentation',
        description: 'API documentation for the HRMS system',
        version: '1.0.0'
      },
      servers: [
        {
          url: config.apiUrl,
          description: 'Development server'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          },
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'access_token'
          }
        }
      },
      security: [
        { bearerAuth: [] },
        { cookieAuth: [] }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    },
    staticCSP: true
  });

  console.log(join(parentDir, "/uploads"), "join(parentDir, /uploads) in app.ts");
  app.register(fastifyStatic, {
    root: join(parentDir, "/uploads"),
  });

  // app.register(fastifyStatic, {
  //   root: uploadsDir,
  //   prefix: '/uploads/',

  // });


  // Add container to request
  app.decorateRequest('container', undefined);
  app.addHook('onRequest', async (request) => {
    const container = Container.getInstance();
    const requestId = request.id;
    request.container = container.createScope(requestId, {
      reqRole: '',
      user: undefined,
      requestId
    });
  });

  // Clean up container scope after request
  app.addHook('onResponse', async (request) => {
    const container = Container.getInstance();
    container.clearScope(request.id);
  });

  app.register(formbody);

  app.register(fastifyMultipart);
  // Register routes
  await app.register(routes);

  return app;
}

// Handler for serverless deployment
export const handler = async (req: any, res: any): Promise<void> => {
  const app = await createApp();
  await app.ready();
  app.server.emit('request', req, res);
}; 