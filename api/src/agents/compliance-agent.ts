import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

export interface ComplianceResult {
  action: 'freeze_card' | 'open_dispute' | 'contact_customer' | 'false_positive';
  approved: boolean;
  requiresOTP: boolean;
  policyChecks: {
    check: string;
    passed: boolean;
    reason?: string;
  }[];
  blockedBy?: string;
}

export class ComplianceAgent {
  async validateAndProposeAction(context: any, userRole: 'agent' | 'lead'): Promise<ComplianceResult> {
    try {
      logger.info('Starting compliance validation', {
        userRole,
        event: 'compliance_validation_started'
      });

      const riskSignals = context.riskSignals || { score: 30, action: null };
      const insights = context.decide || { riskAssessment: { level: 'low' } };
      
      // Determine proposed action based on risk and insights
      const proposedAction = this.determineAction(riskSignals, insights);
      
      // Run policy checks
      const policyChecks = await this.runPolicyChecks(proposedAction, context, userRole);
      
      // Check if action is approved
      const approved = policyChecks.every(check => check.passed);
      const blockedCheck = policyChecks.find(check => !check.passed);
      
      // Determine if OTP is required
      const requiresOTP = this.requiresOTP(proposedAction, riskSignals, userRole);
      
      const result: ComplianceResult = {
        action: proposedAction,
        approved,
        requiresOTP,
        policyChecks,
        blockedBy: blockedCheck?.check
      };

      // Log policy violations
      if (!approved) {
        logger.warn('Action blocked by policy', {
          action: proposedAction,
          blockedBy: blockedCheck?.check,
          userRole,
          event: 'action_blocked_by_policy'
        });
        
        metrics.actionBlockedTotal.inc({ policy: blockedCheck?.check || 'unknown' });
      }

      logger.info('Compliance validation completed', {
        action: proposedAction,
        approved,
        requiresOTP,
        userRole,
        event: 'compliance_validation_completed'
      });

      return result;
    } catch (error) {
      logger.error('Compliance validation failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'compliance_validation_failed'
      });
      throw error;
    }
  }

  private determineAction(riskSignals: any, insights: any): ComplianceResult['action'] {
    const riskLevel = insights.riskAssessment?.level || 'low';
    const riskScore = riskSignals.score || 30;
    
    // Use fraud agent's recommendation if available
    if (riskSignals.action) {
      switch (riskSignals.action) {
        case 'freeze_card':
          return 'freeze_card';
        case 'open_dispute':
          return 'open_dispute';
        case 'monitor':
          return 'contact_customer';
        default:
          break;
      }
    }
    
    // Fallback to risk-based decision
    if (riskLevel === 'high' || riskScore >= 80) {
      return 'freeze_card';
    } else if (riskLevel === 'medium' || riskScore >= 50) {
      return 'open_dispute';
    } else if (riskScore >= 30) {
      return 'contact_customer';
    } else {
      return 'false_positive';
    }
  }

  private async runPolicyChecks(
    action: ComplianceResult['action'], 
    context: any, 
    userRole: 'agent' | 'lead'
  ): Promise<ComplianceResult['policyChecks']> {
    const checks: ComplianceResult['policyChecks'] = [];
    
    // 1. Role-based authorization check
    checks.push(this.checkRoleAuthorization(action, userRole));
    
    // 2. Transaction amount limits
    checks.push(await this.checkAmountLimits(action, context));
    
    // 3. Customer status check
    checks.push(await this.checkCustomerStatus(context));
    
    // 4. Rate limiting check
    checks.push(await this.checkRateLimits(action, context));
    
    // 5. Business hours check (for certain actions)
    checks.push(this.checkBusinessHours(action));
    
    // 6. Escalation requirements
    checks.push(this.checkEscalationRequirements(action, context, userRole));
    
    return checks;
  }

  private checkRoleAuthorization(action: ComplianceResult['action'], userRole: 'agent' | 'lead') {
    // Agents can do most actions except high-value card freezes
    const agentActions = ['contact_customer', 'false_positive', 'open_dispute'];
    const leadOnlyActions = ['freeze_card']; // High-risk actions require lead approval
    
    if (userRole === 'lead') {
      return { check: 'role_authorization', passed: true };
    }
    
    if (agentActions.includes(action)) {
      return { check: 'role_authorization', passed: true };
    }
    
    return { 
      check: 'role_authorization', 
      passed: false, 
      reason: `Action '${action}' requires lead approval` 
    };
  }

  private async checkAmountLimits(action: ComplianceResult['action'], context: any) {
    const suspectTxn = context.getProfile?.transactions?.[0] || context.recentTx?.[0];
    
    if (!suspectTxn) {
      return { check: 'amount_limits', passed: true };
    }
    
    const amountCents = suspectTxn.amountCents || 0;
    const amountDollars = amountCents / 100;
    
    // Different limits for different actions
    const limits = {
      freeze_card: 1000, // $1000+ requires additional verification
      open_dispute: 5000, // $5000+ disputes need special handling
      contact_customer: Number.MAX_SAFE_INTEGER,
      false_positive: Number.MAX_SAFE_INTEGER
    };
    
    const limit = limits[action];
    if (amountDollars > limit) {
      return {
        check: 'amount_limits',
        passed: false,
        reason: `Transaction amount $${amountDollars} exceeds limit $${limit} for action '${action}'`
      };
    }
    
    return { check: 'amount_limits', passed: true };
  }

  private async checkCustomerStatus(context: any) {
    const customer = context.getProfile;
    
    if (!customer) {
      return { 
        check: 'customer_status', 
        passed: false, 
        reason: 'Customer profile not available' 
      };
    }
    
    // Check if customer is in good standing
    if (customer.kycLevel === 'restricted') {
      return {
        check: 'customer_status',
        passed: false,
        reason: 'Customer has restricted KYC status'
      };
    }
    
    return { check: 'customer_status', passed: true };
  }

  private async checkRateLimits(action: ComplianceResult['action'], context: any) {
    // In a real implementation, this would check Redis for rate limits
    // For now, we'll do a simple in-memory check
    
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    // Simulate rate limiting - in production this would use Redis
    // For demo purposes, always pass
    return { check: 'rate_limits', passed: true };
  }

  private checkBusinessHours(action: ComplianceResult['action']) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    // High-risk actions outside business hours require additional approval
    const highRiskActions = ['freeze_card'];
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 9 && hour < 17; // Mon-Fri 9-5
    
    if (highRiskActions.includes(action) && !isBusinessHours) {
      return {
        check: 'business_hours',
        passed: false,
        reason: 'High-risk actions outside business hours require additional approval'
      };
    }
    
    return { check: 'business_hours', passed: true };
  }

  private checkEscalationRequirements(
    action: ComplianceResult['action'], 
    context: any, 
    userRole: 'agent' | 'lead'
  ) {
    const riskSignals = context.riskSignals || { score: 30 };
    const insights = context.decide || { riskAssessment: { confidence: 70 } };
    
    const riskScore = riskSignals.score;
    const confidence = insights.riskAssessment?.confidence || 70;
    
    // High-risk, low-confidence cases require escalation
    if (riskScore >= 80 && confidence < 60 && userRole === 'agent') {
      return {
        check: 'escalation_requirements',
        passed: false,
        reason: 'High-risk, low-confidence case requires lead review'
      };
    }
    
    return { check: 'escalation_requirements', passed: true };
  }

  private requiresOTP(
    action: ComplianceResult['action'], 
    riskSignals: any, 
    userRole: 'agent' | 'lead'
  ): boolean {
    // Card freeze actions always require OTP for verification
    if (action === 'freeze_card') {
      return true;
    }
    
    // High-risk disputes require OTP
    if (action === 'open_dispute' && riskSignals.score >= 70) {
      return true;
    }
    
    return false;
  }
}