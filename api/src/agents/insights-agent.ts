import { logger } from '../utils/logger';

export interface InsightsAnalysis {
  summary: string;
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    confidence: number;
    keyFactors: string[];
  };
  recommendations: string[];
  customerProfile: {
    riskTier: 'low' | 'medium' | 'high';
    transactionPattern: string;
    historicalIncidents: number;
  };
}

export class InsightsAgent {
  async generateInsights(context: any): Promise<InsightsAnalysis> {
    try {
      logger.info('Generating insights analysis', {
        event: 'insights_analysis_started'
      });

      const profile = context.getProfile || {};
      const transactions = context.recentTx || [];
      const riskSignals = context.riskSignals || { score: 30, reasons: [] };
      const kbResults = context.kbLookup || { results: [], citations: [] };

      // Analyze customer profile
      const customerProfile = this.analyzeCustomerProfile(profile, transactions);
      
      // Generate risk assessment
      const riskAssessment = this.generateRiskAssessment(riskSignals, customerProfile);
      
      // Generate summary
      const summary = this.generateSummary(riskAssessment, riskSignals, customerProfile);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(riskAssessment, kbResults, customerProfile);

      const result: InsightsAnalysis = {
        summary,
        riskAssessment,
        recommendations,
        customerProfile
      };

      logger.info('Insights analysis completed', {
        riskLevel: riskAssessment.level,
        confidence: riskAssessment.confidence,
        event: 'insights_analysis_completed'
      });

      return result;
    } catch (error) {
      logger.error('Insights analysis failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'insights_analysis_failed'
      });
      throw error;
    }
  }

  private analyzeCustomerProfile(profile: any, transactions: any[]) {
    let riskTier: 'low' | 'medium' | 'high' = 'low';
    let transactionPattern = 'regular';
    const historicalIncidents = 0; // Would be calculated from actual incident history

    if (transactions.length === 0) {
      return { riskTier, transactionPattern, historicalIncidents };
    }

    // Analyze transaction patterns
    const avgAmount = transactions.reduce((sum: number, txn: any) => sum + txn.amountCents, 0) / transactions.length;
    const uniqueMerchants = new Set(transactions.map((txn: any) => txn.merchant)).size;
    const totalAmount = transactions.reduce((sum: number, txn: any) => sum + txn.amountCents, 0);

    // Determine risk tier based on activity patterns
    if (totalAmount > 500000 || avgAmount > 50000) { // >$5000 total or >$500 avg
      riskTier = 'high';
    } else if (totalAmount > 200000 || avgAmount > 20000) { // >$2000 total or >$200 avg
      riskTier = 'medium';
    }

    // Determine transaction pattern
    if (uniqueMerchants < 3 && transactions.length > 10) {
      transactionPattern = 'concentrated';
    } else if (transactions.length > 50) {
      transactionPattern = 'high_frequency';
    } else if (avgAmount > 30000) {
      transactionPattern = 'high_value';
    }

    return {
      riskTier,
      transactionPattern,
      historicalIncidents
    };
  }

  private generateRiskAssessment(riskSignals: any, customerProfile: any) {
    const score = riskSignals.score || 30;
    let level: 'low' | 'medium' | 'high';
    
    if (score >= 80) level = 'high';
    else if (score >= 50) level = 'medium';
    else level = 'low';

    // Adjust based on customer profile
    if (customerProfile.riskTier === 'high' && level === 'medium') {
      level = 'high';
    } else if (customerProfile.riskTier === 'low' && level === 'medium') {
      // Keep as medium but note low-risk profile
    }

    // Calculate confidence based on available data
    let confidence = 70;
    if (riskSignals.reasons && riskSignals.reasons.length > 3) confidence += 15;
    if (customerProfile.historicalIncidents === 0) confidence += 10;
    if (customerProfile.transactionPattern === 'regular') confidence += 5;

    const keyFactors = this.extractKeyFactors(riskSignals, customerProfile);

    return {
      level,
      confidence: Math.min(confidence, 95),
      keyFactors
    };
  }

  private extractKeyFactors(riskSignals: any, customerProfile: any): string[] {
    const factors: string[] = [];

    // Add risk signal factors
    if (riskSignals.reasons) {
      const topReasons = riskSignals.reasons.slice(0, 3);
      factors.push(...topReasons);
    }

    // Add profile factors
    if (customerProfile.riskTier === 'high') {
      factors.push('High-value customer profile');
    }

    if (customerProfile.transactionPattern === 'concentrated') {
      factors.push('Limited merchant diversity');
    } else if (customerProfile.transactionPattern === 'high_frequency') {
      factors.push('High transaction frequency');
    }

    if (customerProfile.historicalIncidents > 0) {
      factors.push(`${customerProfile.historicalIncidents} previous incident(s)`);
    }

    return factors.slice(0, 5); // Limit to top 5 factors
  }

  private generateSummary(riskAssessment: any, riskSignals: any, customerProfile: any): string {
    const { level, confidence } = riskAssessment;
    const score = riskSignals.score || 30;

    let summary = `Risk analysis indicates ${level.toUpperCase()} risk (score: ${score}/100, confidence: ${confidence}%). `;

    if (level === 'high') {
      summary += 'Immediate attention required. ';
    } else if (level === 'medium') {
      summary += 'Requires investigation. ';
    } else {
      summary += 'Transaction appears normal. ';
    }

    summary += `Customer profile: ${customerProfile.riskTier} risk tier with ${customerProfile.transactionPattern} transaction pattern.`;

    if (riskSignals.reasons && riskSignals.reasons.length > 0) {
      const primaryReason = riskSignals.reasons[0];
      summary += ` Primary concern: ${primaryReason}`;
    }

    return summary;
  }

  private generateRecommendations(riskAssessment: any, kbResults: any, customerProfile: any): string[] {
    const recommendations: string[] = [];
    const { level } = riskAssessment;

    // Risk-level based recommendations
    if (level === 'high') {
      recommendations.push('Immediate card freeze recommended');
      recommendations.push('Contact customer for transaction verification');
      recommendations.push('Review all recent transactions for additional suspicious activity');
    } else if (level === 'medium') {
      recommendations.push('Monitor account for additional suspicious activity');
      recommendations.push('Consider customer outreach for verification');
      recommendations.push('Document incident for pattern analysis');
    } else {
      recommendations.push('Continue normal monitoring');
      recommendations.push('Update customer risk profile if needed');
    }

    // Profile-based recommendations
    if (customerProfile.riskTier === 'high') {
      recommendations.push('Apply enhanced monitoring protocols');
    }

    if (customerProfile.transactionPattern === 'concentrated') {
      recommendations.push('Review merchant relationships for legitimacy');
    }

    // KB-based recommendations
    if (kbResults.citations && kbResults.citations.length > 0) {
      recommendations.push('Refer to knowledge base guidelines for specific procedures');
    }

    // Ensure we have actionable recommendations
    if (recommendations.length === 0) {
      recommendations.push('Follow standard transaction review procedures');
    }

    return recommendations.slice(0, 6); // Limit to 6 recommendations
  }
}