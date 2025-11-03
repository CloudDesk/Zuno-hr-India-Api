import { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import '@fastify/jwt';
import { Types } from 'mongoose';
import { ServiceContainer } from '../types/container';
import { RequestContext } from '../types/context';
import { Container } from '../container';

interface JWTPayload {
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
}

interface RequestWithCookies extends FastifyRequest {
  cookies: {
    access_token?: string;
  };
  container?: ServiceContainer;
}

const isValidObjectId = (id: string): boolean => {
  return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;
};

export const authenticate = async (request: RequestWithCookies, reply: FastifyReply): Promise<void> => {
  try {
    // Get token from cookie
    const token = request.cookies?.access_token;
    console.log(token, 'Token ß')
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      // Verify token manually since we're using cookies
      const decoded = await request.server.jwt.verify<JWTPayload>(token);

      // Validate ObjectIds
      if (!isValidObjectId(decoded._id)) {
        throw new Error('Invalid user ID format');
      }

      const user = {
        _id: new Types.ObjectId(decoded._id),
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        departmentId: decoded.departmentId,
        active: decoded.active,
        // New fields for UAE + external user support
        country: decoded.country,
        currency: decoded.currency,
        licenseType: decoded.licenseType,
        portalAccess: decoded.portalAccess
      };

      // Set user in request for compatibility
      request.user = user;

      // Update container context
      if (request.container) {
        const container = Container.getInstance();
        const updatedContext: RequestContext = {
          requestId: request.id,
          user,
          reqRole: decoded.role.toUpperCase()
        };
        // Clear and recreate the scope with updated context
        container.clearScope(request.id);
        request.container = container.createScope(request.id, updatedContext);
      }

      // Check if user is active
      if (!decoded.active) {
        throw new Error('User account is inactive');
      }

      // Check if user has portal access
      if (!decoded.portalAccess) {
        throw new Error('User does not have portal access');
      }

      console.log('Final in Authß')
    } catch (jwtError: any) {
      console.error('Authentication error:', jwtError.message);
      throw new Error(jwtError.message || 'Invalid token');
    }
  } catch (err: any) {
    reply.status(401).send({
      success: false,
      error: {
        message: err.message || 'Authentication failed',
      },
    });
  }
}; 