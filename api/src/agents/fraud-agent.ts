import { prisma } from '../index';
import { logger } from '../utils/logger';
import { redactor } from '../utils/redactor';

export interface FraudAnalysis {
  score: number; // 0-100
  reasons: string[];
  action?: 'freeze_card' | 'open_dispute' | 'monitor';
  velocity: {
    txnsLast24h: number;
    amountLast24h: number;
    avgDaily: number;
  };
  deviceAnalysis: {
    newDevice: boolean;
    deviceChanges: number;
  };
  merchantAnalysis: {
    newMerchant: boolean;
    riskScore: number;
  };
  patterns: {
    unusualTime: boolean;
    unusualLocation: boolean;
    velocitySpike: boolean;
  };
}

export class FraudAgent {
  async analyzeRisk(customerId: string, suspectTxnId: string): Promise<FraudAnalysis> {
    try {
      logger.info('Starting fraud analysis', {
        customerId_masked: redactor.maskCustomerId(customerId),
        suspectTxnId,
        event: 'fraud_analysis_started'
      });

      // Get suspect transaction
      const suspectTxn = await prisma.transaction.findUnique({
        where: { id: suspectTxnId },
        include: { card: true }
      });

      if (!suspectTxn) {
        throw new Error('Suspect transaction not found');
      }

      // Get customer's transaction history (last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const transactions = await prisma.transaction.findMany({
        where: {
          customerId,
          ts: { gte: ninetyDaysAgo }
        },
        orderBy: { ts: 'desc' },
        take: 1000
      });

      // Analyze various risk factors
      const velocityAnalysis = this.analyzeVelocity(transactions, suspectTxn);
      const deviceAnalysis = this.analyzeDevice(transactions, suspectTxn);
      const merchantAnalysis = this.analyzeMerchant(transactions, suspectTxn);
      const patternAnalysis = this.analyzePatterns(transactions, suspectTxn);

      // Calculate overall risk score
      const score = this.calculateRiskScore(
        velocityAnalysis,
        deviceAnalysis,
        merchantAnalysis,
        patternAnalysis,
        suspectTxn
      );

      // Generate reasons
      const reasons = this.generateReasons(
        score,
        velocityAnalysis,
        deviceAnalysis,
        merchantAnalysis,
        patternAnalysis
      );

      // Propose action
      const action = this.proposeAction(score, reasons);

      const result: FraudAnalysis = {
        score,
        reasons,
        action,
        velocity: velocityAnalysis,
        deviceAnalysis,
        merchantAnalysis,
        patterns: patternAnalysis
      };

      logger.info('Fraud analysis completed', {
        customerId_masked: redactor.maskCustomerId(customerId),
        suspectTxnId,
        riskScore: score,
        proposedAction: action,
        event: 'fraud_analysis_completed'
      });

      return result;
    } catch (error) {
      logger.error('Fraud analysis failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customerId_masked: redactor.maskCustomerId(customerId),
        suspectTxnId,
        event: 'fraud_analysis_failed'
      });
      throw error;
    }
  }

  private analyzeVelocity(transactions: any[], suspectTxn: any) {
    const now = new Date(suspectTxn.ts);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Count transactions and amounts in last 24h
    const recent = transactions.filter(txn => new Date(txn.ts) >= last24h);
    const txnsLast24h = recent.length;
    const amountLast24h = recent.reduce((sum, txn) => sum + txn.amountCents, 0);
    
    // Calculate historical daily average (excluding last 24h)
    const historical = transactions.filter(txn => new Date(txn.ts) < last24h);
    const avgDaily = historical.length / Math.max(89, 1); // 90 - 1 day
    
    return {
      txnsLast24h,
      amountLast24h,
      avgDaily: Math.round(avgDaily * 100) / 100
    };
  }

  private analyzeDevice(transactions: any[], suspectTxn: any) {
    const devices = new Set(transactions.map(txn => txn.deviceId).filter(Boolean));
    const isNewDevice = suspectTxn.deviceId && !devices.has(suspectTxn.deviceId);
    
    return {
      newDevice: isNewDevice,
      deviceChanges: devices.size
    };
  }

  private analyzeMerchant(transactions: any[], suspectTxn: any) {
    const merchants = new Set(transactions.map(txn => txn.merchant));
    const isNewMerchant = !merchants.has(suspectTxn.merchant);
    
    // Simple merchant risk scoring based on MCC and name patterns
    let riskScore = 0;
    
    // High-risk MCCs
    const highRiskMCCs = ['5960', '6051', '7995', '4829'];
    if (highRiskMCCs.includes(suspectTxn.mcc)) {
      riskScore += 30;
    }
    
    // Suspicious merchant name patterns
    const suspiciousPatterns = /temp|test|unknown|cash|atm/i;
    if (suspiciousPatterns.test(suspectTxn.merchant)) {
      riskScore += 20;
    }
    
    if (isNewMerchant) {
      riskScore += 15;
    }
    
    return {
      newMerchant: isNewMerchant,
      riskScore: Math.min(riskScore, 100)
    };
  }

  private analyzePatterns(transactions: any[], suspectTxn: any) {
    const txnTime = new Date(suspectTxn.ts);
    const hour = txnTime.getHours();
    
    // Analyze historical transaction times
    const historicalHours = transactions.map(txn => new Date(txn.ts).getHours());
    const commonHours = this.getCommonHours(historicalHours);
    const unusualTime = !commonHours.includes(hour) && (hour < 6 || hour > 23);
    
    // Analyze locations
    const locations = new Set(transactions.map(txn => `${txn.country}-${txn.city}`).filter(Boolean));
    const currentLocation = `${suspectTxn.country}-${suspectTxn.city}`;
    const unusualLocation = suspectTxn.country && !locations.has(currentLocation);
    
    // Check for velocity spike
    const recentTxns = transactions.slice(0, 10); // Last 10 transactions
    const avgAmount = recentTxns.reduce((sum, txn) => sum + txn.amountCents, 0) / recentTxns.length;
    const velocitySpike = suspectTxn.amountCents > avgAmount * 3;
    
    return {
      unusualTime,
      unusualLocation,
      velocitySpike
    };
  }

  private getCommonHours(hours: number[]): number[] {
    const hourCounts = new Map<number, number>();
    hours.forEach(hour => {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });
    
    const totalTxns = hours.length;
    const threshold = totalTxns * 0.05; // Hours with >5% of transactions
    
    return Array.from(hourCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([hour, _]) => hour);
  }

  private calculateRiskScore(
    velocity: any,
    device: any,
    merchant: any,
    patterns: any,
    suspectTxn: any
  ): number {
    let score = 0;
    
    // Velocity scoring
    if (velocity.txnsLast24h > velocity.avgDaily * 3) score += 25;
    else if (velocity.txnsLast24h > velocity.avgDaily * 2) score += 15;
    
    // Amount velocity
    if (velocity.amountLast24h > 100000) score += 20; // >$1000 in 24h
    
    // Device scoring
    if (device.newDevice) score += 20;
    if (device.deviceChanges > 5) score += 10;
    
    // Merchant scoring
    score += merchant.riskScore * 0.5;
    
    // Pattern scoring
    if (patterns.unusualTime) score += 15;
    if (patterns.unusualLocation) score += 20;
    if (patterns.velocitySpike) score += 25;
    
    // Transaction amount scoring
    if (suspectTxn.amountCents > 50000) score += 15; // >$500
    if (suspectTxn.amountCents > 100000) score += 10; // >$1000
    
    return Math.min(Math.round(score), 100);
  }

  private generateReasons(
    score: number,
    velocity: any,
    device: any,
    merchant: any,
    patterns: any
  ): string[] {
    const reasons: string[] = [];
    
    if (velocity.txnsLast24h > velocity.avgDaily * 2) {
      reasons.push(`High transaction velocity: ${velocity.txnsLast24h} transactions in 24h vs ${velocity.avgDaily} daily average`);
    }
    
    if (device.newDevice) {
      reasons.push('Transaction from new device');
    }
    
    if (merchant.newMerchant) {
      reasons.push('Transaction at new merchant');
    }
    
    if (merchant.riskScore > 30) {
      reasons.push('High-risk merchant category or name pattern');
    }
    
    if (patterns.unusualTime) {
      reasons.push('Transaction at unusual time');
    }
    
    if (patterns.unusualLocation) {
      reasons.push('Transaction from unusual location');
    }
    
    if (patterns.velocitySpike) {
      reasons.push('Transaction amount significantly higher than recent average');
    }
    
    if (reasons.length === 0) {
      reasons.push('Transaction appears normal based on analysis');
    }
    
    return reasons;
  }

  private proposeAction(score: number, reasons: string[]): FraudAnalysis['action'] {
    if (score >= 80) return 'freeze_card';
    if (score >= 50) return 'open_dispute';
    return 'monitor';
  }
}