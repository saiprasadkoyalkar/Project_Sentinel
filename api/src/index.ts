import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// Load environment variables
dotenv.config();

// Import routes
import healthRoutes from './routes/health';
import ingestRoutes from './routes/ingest';
import customerRoutes from './routes/customer';
import insightsRoutes from './routes/insights';
import triageRoutes from './routes/triage';
import actionRoutes from './routes/action';
import kbRoutes from './routes/kb';
import metricsRoutes from './routes/metrics';
import alertsRoutes from './routes/alerts';
import evalsRoutes from './routes/evals';
import uploadExcelRoutes from './routes/uploadExcel';

// Import middleware
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { auditMiddleware } from './middleware/audit';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { metrics } from './utils/metrics';

const app = express();
const port = process.env.PORT || 3001;

// Initialize database and Redis
export const prisma = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') 
    : true,
  credentials: true
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(rateLimitMiddleware);

// Audit logging
app.use(auditMiddleware);

// Routes
app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);
app.use('/api/upload-excel', uploadExcelRoutes); // No auth for upload for now
app.use('/api/ingest', authMiddleware, ingestRoutes);
app.use('/api/customer', authMiddleware, customerRoutes);
app.use('/api/insights', authMiddleware, insightsRoutes);
app.use('/api/triage', authMiddleware, triageRoutes);
app.use('/api/action', authMiddleware, actionRoutes);
app.use('/api/kb', authMiddleware, kbRoutes);
app.use('/api/alerts', authMiddleware, alertsRoutes);
app.use('/api/evals', authMiddleware, evalsRoutes);

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

app.listen(port, () => {
  logger.info(`Sentinel API server running on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

export default app;