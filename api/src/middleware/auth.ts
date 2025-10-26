import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: 'agent' | 'lead';
    apiKey: string;
  };
}

export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const apiKey: string = req.headers['x-api-key'] || req.query.apiKey as string;
  
  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  if (apiKey !== process.env.API_KEY) {
    logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // In a real app, you'd look up the user by API key
  // For demo purposes, we'll mock this
  req.user = {
    id: 'user-1',
    role: apiKey.includes('lead') ? 'lead' : 'agent',
    apiKey
  };

  next();
};