import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from './auth';

export const auditMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Add request ID for tracing
  req.requestId = uuidv4();
  
  // Log request start
  const startTime = Date.now();
  logger.info('Request started', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    event: 'request_started'
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
      event: 'request_completed'
    });
    
    return originalJson.call(this, body);
  };

  next();
};

// Extend Request interface
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}