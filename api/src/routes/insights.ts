import { Router, Request, Response } from 'express';
import { param, validationResult } from 'express-validator';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Validation rules
const customerParamValidation = [
  param('customerId').isString().notEmpty().withMessage('Customer ID is required')
];

interface InsightsSummary {
  topMerchants: { merchant: string; count: number; totalCents: number }[];
  categories: { name: string; pct: number; totalCents: number }[];
  monthlyTrend: { month: string; sum: number; count: number }[];
  anomalies: { ts: string; z: number; note: string; amountCents: number }[];
  riskMetrics: {
    velocityScore: number;
    merchantConcentration: number;
    unusualMCCs: string[];
    deviceChanges: number;
    totalTransactions: number;
    avgTransactionCents: number;
  };
}

// Get customer insights summary
router.get('/:customerId/summary', customerParamValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { customerId } = req.params;

    // Get last 90 days of transactions
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const transactions = await prisma.transaction.findMany({
      where: {
        customerId,
        ts: { gte: ninetyDaysAgo }
      },
      orderBy: { ts: 'desc' },
      take: 10000 // Limit for performance
    });

    if (transactions.length === 0) {
      return res.json({
        topMerchants: [],
        categories: [],
        monthlyTrend: [],
        anomalies: [],
        riskMetrics: {
          velocityScore: 0,
          merchantConcentration: 0,
          unusualMCCs: [],
          deviceChanges: 0,
          totalTransactions: 0,
          avgTransactionCents: 0
        }
      });
    }

    const insights = await generateInsights(transactions);

    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/insights/:customerId/summary', status_code: '200' },
      duration
    );

    logger.info('Customer insights generated', {
      requestId: req.requestId,
      customerId_masked: redactor.maskCustomerId(customerId),
      transactionCount: transactions.length,
      duration,
      event: 'customer_insights_generated'
    });

    res.json(insights);
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/insights/:customerId/summary', status_code: '500' },
      duration
    );
    
    logger.error('Failed to generate customer insights:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      customerId_masked: redactor.maskCustomerId(req.params.customerId),
      event: 'customer_insights_failed'
    });
    
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

async function generateInsights(transactions: any[]): Promise<InsightsSummary> {
  // Top merchants by transaction count
  const merchantMap = new Map<string, { count: number; totalCents: number }>();
  const mccMap = new Map<string, { count: number; totalCents: number }>();
  const monthlyMap = new Map<string, { sum: number; count: number }>();
  const deviceSet = new Set<string>();
  
  let totalCents = 0;
  const amounts: number[] = [];

  for (const txn of transactions) {
    const { merchant, mcc, amountCents, ts, deviceId } = txn;
    
    // Merchant analysis
    const merchantData = merchantMap.get(merchant) || { count: 0, totalCents: 0 };
    merchantData.count += 1;
    merchantData.totalCents += amountCents;
    merchantMap.set(merchant, merchantData);

    // MCC analysis
    const mccData = mccMap.get(mcc) || { count: 0, totalCents: 0 };
    mccData.count += 1;
    mccData.totalCents += amountCents;
    mccMap.set(mcc, mccData);

    // Monthly trend
    const monthKey = new Date(ts).toISOString().substring(0, 7); // YYYY-MM
    const monthData = monthlyMap.get(monthKey) || { sum: 0, count: 0 };
    monthData.sum += amountCents;
    monthData.count += 1;
    monthlyMap.set(monthKey, monthData);

    // Device tracking
    if (deviceId) {
      deviceSet.add(deviceId);
    }

    totalCents += amountCents;
    amounts.push(amountCents);
  }

  // Calculate statistics
  const avgAmount = totalCents / transactions.length;
  const sortedAmounts = amounts.sort((a, b) => a - b);
  const median = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
  const stdDev = Math.sqrt(amounts.reduce((sum, amt) => sum + Math.pow(amt - avgAmount, 2), 0) / amounts.length);

  // Top merchants
  const topMerchants = Array.from(merchantMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([merchant, data]) => ({
      merchant: redactor.redactText(merchant).cleanText,
      count: data.count,
      totalCents: data.totalCents
    }));

  // Categories (simplified MCC mapping)
  const categories = Array.from(mccMap.entries())
    .map(([mcc, data]) => ({
      name: getMCCCategory(mcc),
      pct: data.totalCents / totalCents,
      totalCents: data.totalCents
    }))
    .reduce((acc, curr) => {
      const existing = acc.find(c => c.name === curr.name);
      if (existing) {
        existing.pct += curr.pct;
        existing.totalCents += curr.totalCents;
      } else {
        acc.push(curr);
      }
      return acc;
    }, [] as { name: string; pct: number; totalCents: number }[])
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);

  // Monthly trend
  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month,
      sum: data.sum,
      count: data.count
    }));

  // Detect anomalies (transactions > 2 standard deviations from mean)
  const anomalies = transactions
    .filter(txn => Math.abs(txn.amountCents - avgAmount) > 2 * stdDev)
    .slice(0, 5)
    .map(txn => ({
      ts: txn.ts.toISOString(),
      z: Math.abs(txn.amountCents - avgAmount) / stdDev,
      note: txn.amountCents > avgAmount ? 'Large transaction' : 'Small transaction',
      amountCents: txn.amountCents
    }));

  // Risk metrics
  const velocityScore = calculateVelocityScore(transactions);
  const merchantConcentration = calculateMerchantConcentration(merchantMap, transactions.length);
  const unusualMCCs = findUnusualMCCs(mccMap);

  return {
    topMerchants,
    categories,
    monthlyTrend,
    anomalies,
    riskMetrics: {
      velocityScore,
      merchantConcentration,
      unusualMCCs,
      deviceChanges: deviceSet.size,
      totalTransactions: transactions.length,
      avgTransactionCents: Math.round(avgAmount)
    }
  };
}

function getMCCCategory(mcc: string): string {
  const mccNum = parseInt(mcc);
  
  if (mccNum >= 5811 && mccNum <= 5813) return 'Restaurants';
  if (mccNum >= 5912 && mccNum <= 5999) return 'Retail';
  if (mccNum >= 4000 && mccNum <= 4799) return 'Transport';
  if (mccNum >= 5541 && mccNum <= 5571) return 'Gas Stations';
  if (mccNum >= 5200 && mccNum <= 5299) return 'Home & Garden';
  if (mccNum >= 5300 && mccNum <= 5399) return 'Wholesale';
  if (mccNum >= 6000 && mccNum <= 6999) return 'Financial';
  if (mccNum >= 7200 && mccNum <= 7299) return 'Personal Services';
  if (mccNum >= 8000 && mccNum <= 8999) return 'Professional Services';
  
  return 'Other';
}

function calculateVelocityScore(transactions: any[]): number {
  if (transactions.length < 2) return 0;
  
  // Calculate transactions per day over last 7 days
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  
  const recentTxns = transactions.filter(txn => new Date(txn.ts) >= lastWeek);
  const dailyVelocity = recentTxns.length / 7;
  
  // Historical average (older than 7 days)
  const historicalTxns = transactions.filter(txn => new Date(txn.ts) < lastWeek);
  const historicalAvg = historicalTxns.length / Math.max(83, 1); // 90 - 7 days
  
  if (historicalAvg === 0) return Math.min(dailyVelocity * 10, 100);
  
  const velocityRatio = dailyVelocity / historicalAvg;
  return Math.min(velocityRatio * 20, 100);
}

function calculateMerchantConcentration(merchantMap: Map<string, any>, totalTxns: number): number {
  const topMerchantTxns = Math.max(...Array.from(merchantMap.values()).map(m => m.count));
  return (topMerchantTxns / totalTxns) * 100;
}

function findUnusualMCCs(mccMap: Map<string, any>): string[] {
  const unusualMCCs = ['6051', '7995', '4829', '5960']; // Example unusual MCCs
  return Array.from(mccMap.keys()).filter(mcc => unusualMCCs.includes(mcc));
}

export default router;