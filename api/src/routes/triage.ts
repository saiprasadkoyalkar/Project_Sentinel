import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../index';
import { redis } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';
import { AuthenticatedRequest } from '../middleware/auth';
import TriageOrchestrator, { TriageRequest } from '../agents/orchestrator';

const router = Router();

// In-memory store for active triage runs (in production, use Redis)
const activeRuns = new Map<string, TriageOrchestrator>();

// Validation rules
const triageValidation = [
  body('alertId').isString().notEmpty().withMessage('Alert ID is required'),
  body('customerId').isString().notEmpty().withMessage('Customer ID is required'),
  body('suspectTxnId').isString().notEmpty().withMessage('Suspect transaction ID is required')
];

const runIdValidation = [
  param('runId').isUUID().withMessage('Run ID must be a valid UUID')
];

// Start a triage run
router.post('/', triageValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { alertId, customerId, suspectTxnId } = req.body;
    const userRole = req.user?.role || 'agent';

    // Check if alert exists and is not already being processed
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        triageRuns: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1
        }
      }
    });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (alert.triageRuns.length > 0) {
      const activeRun = alert.triageRuns[0];
      return res.status(409).json({ 
        error: 'Alert is already being processed',
        existingRunId: activeRun.id
      });
    }

    // Create triage request
    const triageRequest: TriageRequest = {
      alertId,
      customerId,
      suspectTxnId,
      userRole
    };

    // Start orchestrator
    const orchestrator = new TriageOrchestrator(triageRequest);
    activeRuns.set(orchestrator['runId'], orchestrator);

    // Start execution in background
    orchestrator.execute().catch(error => {
      logger.error('Triage execution error:', {
        runId: orchestrator['runId'],
        error: error.message,
        event: 'triage_execution_error'
      });
    }).finally(() => {
      // Clean up after completion
      activeRuns.delete(orchestrator['runId']);
    });

    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/triage', status_code: '200' },
      duration
    );

    logger.info('Triage started', {
      requestId: req.requestId,
      runId: orchestrator['runId'],
      alertId,
      customerId_masked: redactor.maskCustomerId(customerId),
      userRole,
      event: 'triage_started'
    });

    res.json({
      runId: orchestrator['runId'],
      alertId,
      status: 'started',
      streamUrl: `/api/triage/${orchestrator['runId']}/stream`
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/triage', status_code: '500' },
      duration
    );
    
    logger.error('Failed to start triage:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      event: 'triage_start_failed'
    });
    
    res.status(500).json({ error: 'Failed to start triage' });
  }
});

// Get triage status
router.get('/:runId', runIdValidation, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { runId } = req.params;

    // Check if run is active
    const activeRun = activeRuns.get(runId);
    if (activeRun) {
      return res.json({
        runId,
        status: 'running',
        startedAt: activeRun['startTime']
      });
    }

    // Check database for completed run
    const triageRun = await prisma.triageRun.findUnique({
      where: { id: runId },
      include: {
        traces: {
          orderBy: { seq: 'asc' }
        }
      }
    });

    if (!triageRun) {
      return res.status(404).json({ error: 'Triage run not found' });
    }

    const result = {
      runId,
      status: triageRun.endedAt ? 'completed' : 'running',
      startedAt: triageRun.startedAt,
      endedAt: triageRun.endedAt,
      risk: triageRun.risk,
      reasons: triageRun.reasons,
      fallbackUsed: triageRun.fallbackUsed,
      latencyMs: triageRun.latencyMs,
      traces: triageRun.traces.map(trace => ({
        seq: trace.seq,
        step: trace.step,
        ok: trace.ok,
        durationMs: trace.durationMs,
        detail: redactor.redactObject(trace.detailJson).cleanObj
      }))
    };

    res.json(result);
  } catch (error) {
    logger.error('Failed to get triage status:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      event: 'triage_status_failed'
    });
    
    res.status(500).json({ error: 'Failed to get triage status' });
  }
});

// Server-Sent Events stream for triage updates
router.get('/:runId/stream', runIdValidation, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { runId } = req.params;

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);

    // Get orchestrator
    const orchestrator = activeRuns.get(runId);
    if (!orchestrator) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Triage run not found or completed' })}\n\n`);
      res.end();
      return;
    }

    // Set up event listeners
    const eventHandler = (type: string, data: any) => {
      const eventData = {
        type,
        timestamp: new Date().toISOString(),
        runId,
        data: redactor.redactObject(data).cleanObj
      };
      
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };

    orchestrator.on('plan_built', (data) => eventHandler('plan_built', data));
    orchestrator.on('tool_update', (data) => eventHandler('tool_update', data));
    orchestrator.on('fallback_triggered', (data) => eventHandler('fallback_triggered', data));
    orchestrator.on('decision_finalized', (data) => eventHandler('decision_finalized', data));
    orchestrator.on('error', (data) => eventHandler('error', data));

    // Handle client disconnect
    req.on('close', () => {
      logger.info('SSE client disconnected', {
        runId,
        event: 'sse_client_disconnected'
      });
      res.end();
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);

    // Clean up on completion
    orchestrator.once('decision_finalized', () => {
      clearInterval(heartbeat);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: 'completed' })}\n\n`);
        res.end();
      }, 1000); // Give client time to process final event
    });

    orchestrator.once('error', () => {
      clearInterval(heartbeat);
      res.end();
    });

  } catch (error) {
    logger.error('SSE stream error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      event: 'sse_stream_error'
    });
    
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream error' })}\n\n`);
    res.end();
  }
});

export default router;