import { Request, Response, NextFunction } from 'express';
import { redis } from '../index';
import { logger } from '../utils/logger';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const clientId = req.ip || 'unknown';
  logger.info(`[RateLimit] req.ip: ${req.ip}, x-forwarded-for: ${req.headers['x-forwarded-for']}, clientId: ${clientId}, Redis key: rate_limit:${clientId}, url: ${req.method} ${req.originalUrl}`);
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '300');
  
  const key = `rate_limit:${clientId}`;
  
  try {
    const current = await redis.get(key);
    let rateLimitInfo: RateLimitInfo;
    if (current) {
      rateLimitInfo = JSON.parse(current);
      if (Date.now() > rateLimitInfo.resetTime) {
        // Reset window
        rateLimitInfo = { count: 1, resetTime: Date.now() + windowMs };
      } else {
        rateLimitInfo.count += 1;
      }
    } else {
      rateLimitInfo = { count: 1, resetTime: Date.now() + windowMs };
    }
    await redis.setex(key, Math.ceil(windowMs / 1000), JSON.stringify(rateLimitInfo));
    const remaining = Math.max(0, maxRequests - rateLimitInfo.count);
    const retryAfter = Math.ceil((rateLimitInfo.resetTime - Date.now()) / 1000);
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': rateLimitInfo.resetTime.toString(),
    });
    // Debug log: show current count and remaining
    logger.info(`[RateLimit] clientId: ${clientId}, count: ${rateLimitInfo.count}, remaining: ${remaining}, resetTime: ${rateLimitInfo.resetTime}`);
    if (rateLimitInfo.count > maxRequests) {
      res.set('Retry-After', retryAfter.toString());
      logger.warn(`[RateLimit] Rate limit exceeded for client: ${clientId} (count: ${rateLimitInfo.count}, max: ${maxRequests})`);
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: retryAfter
      });
      return;
    }
    next();
  } catch (error) {
    logger.error('Rate limiting error:', error);
    // Fail open - allow request if rate limiting fails
    next();
  }
};