import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';

// Import agents
import { InsightsAgent } from './insights-agent';
import { FraudAgent } from './fraud-agent';
import { KBAgent } from './kb-agent';
import { ComplianceAgent } from './compliance-agent';
import { SummarizerAgent } from './summarizer-agent';

export interface TriageRequest {
  alertId: string;
  customerId: string;
  suspectTxnId: string;
  userRole: 'agent' | 'lead';
}

export interface TriageResult {
  runId: string;
  risk: 'low' | 'medium' | 'high';
  reasons: string[];
  proposedAction: 'freeze_card' | 'open_dispute' | 'contact_customer' | 'false_positive';
  confidence: number;
  citations: string[];
  fallbackUsed: boolean;
  traces: AgentTrace[];
}

export interface AgentTrace {
  seq: number;
  step: string;
  ok: boolean;
  durationMs: number;
  detail: any;
  fallbackTriggered?: boolean;
}

export interface TriageEvent {
  type: 'plan_built' | 'tool_update' | 'fallback_triggered' | 'decision_finalized' | 'error';
  data: any;
}

export class TriageOrchestrator extends EventEmitter {
  private runId: string;
  private request: TriageRequest;
  private traces: AgentTrace[] = [];
  private fallbackUsed = false;
  private startTime: number;
  
  // Circuit breaker state
  private static circuitBreakers = new Map<string, { failures: number; lastFailure: number; isOpen: boolean }>();
  
  constructor(request: TriageRequest) {
    super();
    this.runId = uuidv4();
    this.request = request;
    this.startTime = Date.now();
  }

  async execute(): Promise<TriageResult> {
    try {
      logger.info('Triage execution started', {
        runId: this.runId,
        alertId: this.request.alertId,
        customerId_masked: redactor.maskCustomerId(this.request.customerId),
        event: 'triage_started'
      });

      // Create triage run record
      await prisma.triageRun.create({
        data: {
          id: this.runId,
          alertId: this.request.alertId,
          startedAt: new Date()
        }
      });

      // Build and emit plan
      const plan = this.buildPlan();
      this.emit('plan_built', { plan });

      // Execute plan steps
      const context: any = {};
      
      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        const success = await this.executeStep(step, context, i);
        
        if (!success && this.isStepCritical(step)) {
          // If critical step fails, trigger fallback
          await this.triggerFallback(step, context);
          break;
        }
      }

      // Generate final decision
      const result = await this.generateDecision(context);
      
      // Update database with results
      await this.saveResults(result);
      
      this.emit('decision_finalized', result);
      
      const totalDuration = Date.now() - this.startTime;
      metrics.agentLatency.observe(
        { agent: 'orchestrator', step: 'total' },
        totalDuration
      );

      logger.info('Triage execution completed', {
        runId: this.runId,
        risk: result.risk,
        proposedAction: result.proposedAction,
        fallbackUsed: this.fallbackUsed,
        duration: totalDuration,
        event: 'triage_completed'
      });

      return result;
    } catch (error) {
      logger.error('Triage execution failed:', {
        runId: this.runId,
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'triage_failed'
      });
      
      this.emit('error', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  private buildPlan(): string[] {
    // Default triage plan as specified in requirements
    return [
      'getProfile',
      'recentTx', 
      'riskSignals',
      'kbLookup',
      'decide',
      'proposeAction'
    ];
  }

  private async executeStep(step: string, context: any, seq: number): Promise<boolean> {
    const stepStartTime = Date.now();
    
    try {
      // Check circuit breaker
      if (this.isCircuitOpen(step)) {
        logger.warn(`Circuit breaker open for step: ${step}`, {
          runId: this.runId,
          step,
          event: 'circuit_breaker_open'
        });
        return false;
      }

      let result: any;
      let agent: any;
      
      switch (step) {
        case 'getProfile':
          result = await this.getCustomerProfile();
          break;
        case 'recentTx':
          result = await this.getRecentTransactions();
          break;
        case 'riskSignals':
          agent = new FraudAgent();
          result = await this.executeWithTimeout(
            () => agent.analyzeRisk(this.request.customerId, this.request.suspectTxnId),
            step
          );
          break;
        case 'kbLookup':
          agent = new KBAgent();
          result = await this.executeWithTimeout(
            () => agent.searchRelevantDocs(context.riskSignals?.reasons || []),
            step
          );
          break;
        case 'decide':
          agent = new InsightsAgent();
          result = await this.executeWithTimeout(
            () => agent.generateInsights(context),
            step
          );
          break;
        case 'proposeAction':
          agent = new ComplianceAgent();
          result = await this.executeWithTimeout(
            () => agent.validateAndProposeAction(context, this.request.userRole),
            step
          );
          break;
        default:
          throw new Error(`Unknown step: ${step}`);
      }

      const duration = Date.now() - stepStartTime;
      
      // Record successful execution
      const trace: AgentTrace = {
        seq,
        step,
        ok: true,
        durationMs: duration,
        detail: redactor.redactObject(result).cleanObj
      };
      
      this.traces.push(trace);
      context[step] = result;
      
      // Reset circuit breaker on success
      this.resetCircuitBreaker(step);
      
      metrics.toolCallTotal.inc({ tool: step, ok: 'true' });
      metrics.agentLatency.observe({ agent: step, step: 'execution' }, duration);
      
      this.emit('tool_update', { step, success: true, duration, result: trace.detail });
      
      logger.debug('Step executed successfully', {
        runId: this.runId,
        step,
        duration,
        event: 'step_completed'
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - stepStartTime;
      
      // Record failure
      const trace: AgentTrace = {
        seq,
        step,
        ok: false,
        durationMs: duration,
        detail: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
      
      this.traces.push(trace);
      
      // Update circuit breaker
      this.recordFailure(step);
      
      metrics.toolCallTotal.inc({ tool: step, ok: 'false' });
      
      this.emit('tool_update', { step, success: false, duration, error: trace.detail.error });
      
      logger.error('Step execution failed:', {
        runId: this.runId,
        step,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        event: 'step_failed'
      });
      
      return false;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>, step: string): Promise<T> {
    const timeout = parseInt(process.env.AGENT_TIMEOUT || '1000');
    
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Step ${step} timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }

  private async triggerFallback(failedStep: string, context: any): Promise<void> {
    this.fallbackUsed = true;
    
    logger.info('Triggering fallback', {
      runId: this.runId,
      failedStep,
      event: 'fallback_triggered'
    });
    
    metrics.agentFallbackTotal.inc({ tool: failedStep });
    this.emit('fallback_triggered', { failedStep });
    
    // Provide deterministic fallbacks
    switch (failedStep) {
      case 'riskSignals':
        context.riskSignals = {
          score: 50, // Medium risk as fallback
          reasons: ['risk_analysis_unavailable'],
          action: null
        };
        break;
      case 'kbLookup':
        context.kbLookup = {
          results: [],
          citations: ['Fallback: Manual review recommended']
        };
        break;
      default:
        context[failedStep] = { fallback: true, reason: 'Service unavailable' };
    }
  }

  private async generateDecision(context: any): Promise<TriageResult> {
    // Combine insights from all agents to make final decision
    const riskSignals = context.riskSignals || { score: 30, reasons: [] };
    const kbResults = context.kbLookup || { results: [], citations: [] };
    const complianceCheck = context.proposeAction || { action: 'contact_customer', approved: true };
    
    // Determine risk level
    let risk: 'low' | 'medium' | 'high';
    if (riskSignals.score >= 80) risk = 'high';
    else if (riskSignals.score >= 50) risk = 'medium';
    else risk = 'low';
    
    // Adjust risk if fallback was used
    if (this.fallbackUsed && risk === 'high') {
      risk = 'medium';
    }
    
    // Determine proposed action based on risk and compliance
    let proposedAction: TriageResult['proposedAction'];
    if (complianceCheck.action) {
      proposedAction = complianceCheck.action;
    } else if (risk === 'high') {
      proposedAction = 'freeze_card';
    } else if (risk === 'medium') {
      proposedAction = 'open_dispute';
    } else {
      proposedAction = 'false_positive';
    }
    
    const confidence = this.fallbackUsed ? 
      Math.min(riskSignals.score * 0.7, 70) : 
      riskSignals.score;
    
    return {
      runId: this.runId,
      risk,
      reasons: riskSignals.reasons || [],
      proposedAction,
      confidence,
      citations: kbResults.citations || [],
      fallbackUsed: this.fallbackUsed,
      traces: this.traces
    };
  }

  private async saveResults(result: TriageResult): Promise<void> {
    const endTime = new Date();
    const totalDuration = Date.now() - this.startTime;
    
    // Update triage run
    await prisma.triageRun.update({
      where: { id: this.runId },
      data: {
        endedAt: endTime,
        risk: result.risk,
        reasons: result.reasons,
        fallbackUsed: this.fallbackUsed,
        latencyMs: totalDuration
      }
    });
    
    // Save traces
    for (const trace of this.traces) {
      await prisma.agentTrace.create({
        data: {
          runId: this.runId,
          seq: trace.seq,
          step: trace.step,
          ok: trace.ok,
          durationMs: trace.durationMs,
          detailJson: trace.detail
        }
      });
    }
  }

  private async getCustomerProfile(): Promise<any> {
    return prisma.customer.findUnique({
      where: { id: this.request.customerId },
      include: {
        cards: true,
        accounts: true
      }
    });
  }

  private async getRecentTransactions(): Promise<any> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    return prisma.transaction.findMany({
      where: {
        customerId: this.request.customerId,
        ts: { gte: thirtyDaysAgo }
      },
      orderBy: { ts: 'desc' },
      take: 100
    });
  }

  private isStepCritical(step: string): boolean {
    return ['getProfile', 'recentTx'].includes(step);
  }

  private isCircuitOpen(step: string): boolean {
    const breaker = TriageOrchestrator.circuitBreakers.get(step);
    if (!breaker) return false;
    
    if (breaker.isOpen) {
      // Check if circuit should be reset (30 seconds)
      if (Date.now() - breaker.lastFailure > 30000) {
        breaker.isOpen = false;
        breaker.failures = 0;
        return false;
      }
      return true;
    }
    
    return false;
  }

  private recordFailure(step: string): void {
    const breaker = TriageOrchestrator.circuitBreakers.get(step) || 
      { failures: 0, lastFailure: 0, isOpen: false };
    
    breaker.failures += 1;
    breaker.lastFailure = Date.now();
    
    // Open circuit after 3 consecutive failures
    if (breaker.failures >= 3) {
      breaker.isOpen = true;
      logger.warn(`Circuit breaker opened for step: ${step}`, {
        failures: breaker.failures,
        event: 'circuit_breaker_opened'
      });
    }
    
    TriageOrchestrator.circuitBreakers.set(step, breaker);
  }

  private resetCircuitBreaker(step: string): void {
    const breaker = TriageOrchestrator.circuitBreakers.get(step);
    if (breaker) {
      breaker.failures = 0;
      breaker.isOpen = false;
    }
  }
}

export default TriageOrchestrator;