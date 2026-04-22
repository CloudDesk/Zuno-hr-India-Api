import { Types } from 'mongoose';
import { CookieSerializeOptions } from '@fastify/cookie';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      _id: Types.ObjectId | string;
      email: string;
      name: string;
      role: string;
      departmentId: string;
      active: boolean;
      // New fields for UAE + external user support
      country: string;
      currency: string;
      licenseType: string;
      portalAccess: boolean;
    };
  }

  interface FastifyReply {
    /**
     * Fastify v5 narrows `status()`/`code()` to the declared `schema.response` codes.
     * Many existing routes in this codebase return additional error codes (400/401/403/404/409/500)
     * without listing them in every route schema. Add a permissive overload so builds don't fail.
     */
    status(statusCode: number): FastifyReply;
    code(statusCode: number): FastifyReply;

    setCookie(
      name: string,
      value: string,
      options?: CookieSerializeOptions
    ): FastifyReply;
    cookie(
      name: string,
      value: string,
      options?: CookieSerializeOptions
    ): FastifyReply;
  }

  interface FastifyInstance {
    cookies: any;
    [Symbol.for('fastify.plugins.registered')]: any;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      _id: string;
      email: string;
      name: string;
      role: string;
      departmentId: string;
      active: boolean;
      // New fields for UAE + external user support
      country: string;
      currency: string;
      licenseType: string;
      portalAccess: boolean;
    };
    user: {
      _id: Types.ObjectId | string;
      email: string;
      name: string;
      role: string;
      departmentId: string;
      active: boolean;
      // New fields for UAE + external user support
      country: string;
      currency: string;
      licenseType: string;
      portalAccess: boolean;
    };
  }
} 
