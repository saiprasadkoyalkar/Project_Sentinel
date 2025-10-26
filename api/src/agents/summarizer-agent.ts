import { logger } from '../utils/logger';
import { redactor } from '../utils/redactor';

export interface SummaryResult {
  customerMessage: string;
  internalNote: string;
  riskSummary: string;
  actionSummary: string;
  nextSteps: string[];
}

export class SummarizerAgent {
  async generateSummary(context: any): Promise<SummaryResult> {
    try {
      logger.info('Generating case summary', {
        event: 'summary_generation_started'
      });

      const riskSignals = context.riskSignals || { score: 30, reasons: [] };
      const insights = context.decide || { riskAssessment: { level: 'low' }, summary: '' };
      const complianceResult = context.proposeAction || { action: 'contact_customer', approved: true };
      const kbResults = context.kbLookup || { citations: [] };

      // Generate customer-facing message
      const customerMessage = this.generateCustomerMessage(riskSignals, complianceResult);
      
      // Generate internal documentation
      const internalNote = this.generateInternalNote(context, riskSignals, insights, complianceResult);
      
      // Generate risk summary
      const riskSummary = this.generateRiskSummary(riskSignals, insights);
      
      // Generate action summary
      const actionSummary = this.generateActionSummary(complianceResult, riskSignals);
      
      // Generate next steps
      const nextSteps = this.generateNextSteps(complianceResult, riskSignals, insights);

      const result: SummaryResult = {
        customerMessage,
        internalNote,
        riskSummary,
        actionSummary,
        nextSteps
      };

      logger.info('Case summary generated', {
        event: 'summary_generation_completed'
      });

      return result;
    } catch (error) {
      logger.error('Summary generation failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'summary_generation_failed'
      });
      
      // Return fallback template
      return this.getFallbackSummary();
    }
  }

  private generateCustomerMessage(riskSignals: any, complianceResult: any): string {
    const action = complianceResult.action;
    const approved = complianceResult.approved;
    
    if (!approved) {
      return "We're reviewing your recent transaction and will contact you shortly with an update. Thank you for your patience.";
    }

    switch (action) {
      case 'freeze_card':
        return "We've temporarily restricted your card as a security precaution due to unusual activity. Please call our fraud hotline at 1-800-FRAUD-HELP to verify recent transactions and restore access.";
      
      case 'open_dispute':
        return "We've identified a potentially unauthorized transaction on your account and have initiated a dispute on your behalf. You'll receive an email confirmation with details and next steps within 24 hours.";
      
      case 'contact_customer':
        return "We've noticed some unusual activity on your account and would like to verify a recent transaction. Please call us at your earliest convenience at 1-800-SUPPORT or reply to confirm if you authorized the transaction.";
      
      case 'false_positive':
        return "Your recent transaction has been reviewed and verified as legitimate. No further action is required. Thank you for banking with us.";
      
      default:
        return "Your transaction is being reviewed. We'll contact you if any additional information is needed.";
    }
  }

  private generateInternalNote(context: any, riskSignals: any, insights: any, complianceResult: any): string {
    const timestamp = new Date().toISOString();
    const customer = context.getProfile || {};
    const suspectTxn = context.recentTx?.[0] || {};
    
    let note = `=== TRIAGE ANALYSIS REPORT ===\n`;
    note += `Timestamp: ${timestamp}\n`;
    note += `Customer ID: ${customer.id ? redactor.maskCustomerId(customer.id) : 'Unknown'}\n`;
    note += `Alert ID: ${context.alertId || 'N/A'}\n\n`;
    
    // Risk Assessment
    note += `RISK ASSESSMENT:\n`;
    note += `Score: ${riskSignals.score}/100 (${insights.riskAssessment?.level || 'unknown'} risk)\n`;
    note += `Confidence: ${insights.riskAssessment?.confidence || 'N/A'}%\n`;
    if (riskSignals.reasons && riskSignals.reasons.length > 0) {
      note += `Reasons:\n`;
      riskSignals.reasons.forEach((reason: string, index: number) => {
        note += `  ${index + 1}. ${reason}\n`;
      });
    }
    note += `\n`;
    
    // Transaction Details
    if (suspectTxn.merchant) {
      note += `TRANSACTION DETAILS:\n`;
      const { cleanText: cleanMerchant } = redactor.redactText(suspectTxn.merchant);
      note += `Merchant: ${cleanMerchant}\n`;
      note += `Amount: $${(suspectTxn.amountCents / 100).toFixed(2)}\n`;
      note += `MCC: ${suspectTxn.mcc}\n`;
      note += `Timestamp: ${suspectTxn.ts}\n\n`;
    }
    
    // Compliance Decision
    note += `COMPLIANCE DECISION:\n`;
    note += `Proposed Action: ${complianceResult.action}\n`;
    note += `Approved: ${complianceResult.approved ? 'YES' : 'NO'}\n`;
    if (!complianceResult.approved && complianceResult.blockedBy) {
      note += `Blocked By: ${complianceResult.blockedBy}\n`;
    }
    if (complianceResult.requiresOTP) {
      note += `OTP Required: YES\n`;
    }
    note += `\n`;
    
    // Policy Checks
    if (complianceResult.policyChecks && complianceResult.policyChecks.length > 0) {
      note += `POLICY CHECKS:\n`;
      complianceResult.policyChecks.forEach((check: any) => {
        note += `  ${check.check}: ${check.passed ? 'PASS' : 'FAIL'}`;
        if (check.reason) note += ` (${check.reason})`;
        note += `\n`;
      });
      note += `\n`;
    }
    
    // Summary
    if (insights.summary) {
      note += `ANALYSIS SUMMARY:\n${insights.summary}\n\n`;
    }
    
    // Recommendations
    if (insights.recommendations && insights.recommendations.length > 0) {
      note += `RECOMMENDATIONS:\n`;
      insights.recommendations.forEach((rec: string, index: number) => {
        note += `  ${index + 1}. ${rec}\n`;
      });
      note += `\n`;
    }
    
    note += `=== END REPORT ===`;
    
    return note;
  }

  private generateRiskSummary(riskSignals: any, insights: any): string {
    const score = riskSignals.score || 30;
    const level = insights.riskAssessment?.level || 'low';
    const confidence = insights.riskAssessment?.confidence || 70;
    
    let summary = `Risk Level: ${level.toUpperCase()} (${score}/100)\n`;
    summary += `Confidence: ${confidence}%\n`;
    
    if (riskSignals.reasons && riskSignals.reasons.length > 0) {
      summary += `Key Risk Factors:\n`;
      riskSignals.reasons.slice(0, 3).forEach((reason: string, index: number) => {
        summary += `• ${reason}\n`;
      });
    }
    
    return summary;
  }

  private generateActionSummary(complianceResult: any, riskSignals: any): string {
    const action = complianceResult.action;
    const approved = complianceResult.approved;
    
    let summary = `Recommended Action: ${action.replace('_', ' ').toUpperCase()}\n`;
    summary += `Status: ${approved ? 'APPROVED' : 'BLOCKED'}\n`;
    
    if (!approved && complianceResult.blockedBy) {
      summary += `Reason: Blocked by ${complianceResult.blockedBy}\n`;
    }
    
    if (complianceResult.requiresOTP) {
      summary += `OTP Verification: REQUIRED\n`;
    }
    
    return summary;
  }

  private generateNextSteps(complianceResult: any, riskSignals: any, insights: any): string[] {
    const steps: string[] = [];
    const action = complianceResult.action;
    const approved = complianceResult.approved;
    
    if (!approved) {
      steps.push('Escalate to supervisor for policy exception review');
      steps.push('Document reason for policy block in case notes');
      return steps;
    }
    
    switch (action) {
      case 'freeze_card':
        steps.push('Execute card freeze immediately');
        if (complianceResult.requiresOTP) {
          steps.push('Wait for OTP verification before proceeding');
        }
        steps.push('Send SMS/email notification to customer');
        steps.push('Create fraud case in system');
        steps.push('Schedule follow-up call within 2 hours');
        break;
        
      case 'open_dispute':
        steps.push('Create dispute case with transaction details');
        steps.push('Send confirmation email to customer');
        steps.push('Request merchant documentation');
        steps.push('Set 5-day review deadline');
        break;
        
      case 'contact_customer':
        steps.push('Add customer contact task to queue');
        steps.push('Prepare verification questions');
        steps.push('Set callback within 4 hours');
        steps.push('Monitor for additional suspicious activity');
        break;
        
      case 'false_positive':
        steps.push('Close alert as false positive');
        steps.push('Update customer risk profile if needed');
        steps.push('Send confirmation notification');
        break;
        
      default:
        steps.push('Follow standard procedure for transaction review');
    }
    
    // Add general monitoring step
    if (riskSignals.score > 50) {
      steps.push('Enable enhanced monitoring for 30 days');
    }
    
    return steps;
  }

  private getFallbackSummary(): SummaryResult {
    return {
      customerMessage: "We're reviewing your recent transaction and will contact you if any additional information is needed.",
      internalNote: "Automated triage completed with fallback template. Manual review recommended.",
      riskSummary: "Risk assessment unavailable - fallback analysis applied.",
      actionSummary: "Standard review process initiated.",
      nextSteps: [
        "Manual review required",
        "Contact customer if necessary",
        "Document findings in case notes"
      ]
    };
  }
}