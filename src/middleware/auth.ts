import { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import '@fastify/jwt';
import { Types } from 'mongoose';
import { ServiceContainer } from '../types/container';
import { RequestContext } from '../types/context';
import { Container } from '../container';
import { User } from '../models';
import * as crypto from 'crypto';

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

/**
 * WhatsApp Authentication Middleware
 * Authenticates requests from WhatsApp backend using phone number and signature verification
 */
export const authenticateWhatsApp = async (request: RequestWithCookies, reply: FastifyReply): Promise<void> => {
  try {
    // Get phone number and signature from request
    const { phoneNumber } = request.body as { phoneNumber?: string; [key: string]: any };
    const whatsappSecret = request.headers['x-whatsapp-secret'] as string;
    const timestamp = request.headers['x-whatsapp-timestamp'] as string;
    const signature = request.headers['x-whatsapp-signature'] as string;

    // Validate required fields
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Get FACEBOOK_APP_SECRET from environment
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    if (!FACEBOOK_APP_SECRET) {
      throw new Error('FACEBOOK_APP_SECRET not configured');
    }

    // Verify authentication method 1: Direct secret comparison
    // OR method 2: Signature verification with timestamp
    let isVerified = false;

    if (whatsappSecret) {
      // Method 1: Direct secret comparison (simpler)
      if (whatsappSecret === FACEBOOK_APP_SECRET) {
        isVerified = true;
      }
    } else if (signature && timestamp) {
      // Method 2: Signature verification (more secure with timestamp)
      const currentTime = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp);

      // Check if timestamp is within 5 minutes (300 seconds)
      if (currentTime - requestTime > 300) {
        throw new Error('Request timestamp expired');
      }

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', FACEBOOK_APP_SECRET)
        .update(phoneNumber + timestamp)
        .digest('hex');

      if (signature === expectedSignature) {
        isVerified = true;
      }
    }

    if (!isVerified) {
      throw new Error('Invalid WhatsApp authentication credentials');
    }

    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

    // Find user by phone number
    const user = await User.findOne({ 
      phone: normalizedPhone,
      active: true 
    }).select('_id email name role departmentId active country currency licenseType portalAccess');

    if (!user) {
      throw new Error('User not found or inactive');
    }

    // Check if user has portal access (optional - remove if not needed)
    if (!user.portalAccess) {
      throw new Error('User does not have portal access');
    }

    // Create user object compatible with JWT authentication format
    const userContext = {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      departmentId: user.departmentId,
      active: user.active,
      country: user.country,
      currency: user.currency,
      licenseType: user.licenseType,
      portalAccess: user.portalAccess
    };

    // Set user in request for compatibility with existing routes
    request.user = userContext;

    // Update container context
    if (request.container) {
      const container = Container.getInstance();
      const updatedContext: RequestContext = {
        requestId: request.id,
        user: userContext,
        reqRole: user.role.toUpperCase()
      };
      // Clear and recreate the scope with updated context
      container.clearScope(request.id);
      request.container = container.createScope(request.id, updatedContext);
    }

    console.log('WhatsApp authentication successful for:', normalizedPhone);
  } catch (err: any) {
    console.error('WhatsApp authentication error:', err.message);
    reply.status(401).send({
      success: false,
      error: {
        message: err.message || 'WhatsApp authentication failed',
      },
    });
  }
};