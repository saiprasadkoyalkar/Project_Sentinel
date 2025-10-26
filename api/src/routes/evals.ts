import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Helper function to calculate evaluation metrics from real fraud detection data
async function calculateFraudDetectionEval() {
  // Get recent triage runs with their results
  const triageRuns = await prisma.triageRun.findMany({
    take: 200,
    orderBy: { startedAt: 'desc' },
    include: {
      alert: {
        include: {
          suspectTxn: true
        }
      },
      traces: true
    }
  });

  let truePositive = 0, falsePositive = 0, trueNegative = 0, falseNegative = 0;
  const failures: { [key: string]: number } = {};

  triageRuns.forEach(run => {
    const actualRisk = run.alert.risk; // 'high', 'medium', 'low'
    const predictedRisk = run.risk || 'unknown';
    
    // Simplified classification: high risk = positive, others = negative
    const actualPositive = actualRisk === 'high';
    const predictedPositive = predictedRisk === 'high';

    if (actualPositive && predictedPositive) truePositive++;
    else if (!actualPositive && predictedPositive) {
      falsePositive++;
      failures['Legitimate transaction flagged as high risk'] = (failures['Legitimate transaction flagged as high risk'] || 0) + 1;
    }
    else if (!actualPositive && !predictedPositive) trueNegative++;
    else if (actualPositive && !predictedPositive) {
      falseNegative++;
      failures['High risk transaction missed'] = (failures['High risk transaction missed'] || 0) + 1;
    }
  });

  const total = truePositive + falsePositive + trueNegative + falseNegative;
  const passed = truePositive + trueNegative;
  const accuracy = total > 0 ? (passed / total) * 100 : 0;

  return {
    id: 'fraud_detection',
    name: 'Fraud Detection Accuracy',
    description: 'Tests AI ability to correctly identify fraudulent transactions using real triage data',
    testCases: total,
    passed,
    failed: total - passed,
    accuracy: Math.round(accuracy * 10) / 10,
    confusionMatrix: { truePositive, falsePositive, trueNegative, falseNegative },
    topFailures: Object.entries(failures)
      .map(([case_name, frequency]) => ({ case: case_name, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5),
    lastRun: triageRuns[0]?.startedAt || null,
    status: 'completed'
  };
}

async function calculateAgentPerformanceEval() {
  // Analyze agent traces for performance metrics
  const traces = await prisma.agentTrace.findMany({
    take: 500,
    orderBy: { runId: 'desc' },
    include: {
      run: {
        include: {
          alert: true
        }
      }
    }
  });

  let successful = 0;
  let failed = 0;
  const stepFailures: { [key: string]: number } = {};
  const avgLatency: { [key: string]: number[] } = {};

  traces.forEach(trace => {
    if (trace.ok) {
      successful++;
    } else {
      failed++;
      stepFailures[trace.step] = (stepFailures[trace.step] || 0) + 1;
    }

    if (!avgLatency[trace.step]) avgLatency[trace.step] = [];
    avgLatency[trace.step].push(trace.durationMs);
  });

  const total = successful + failed;
  const accuracy = total > 0 ? (successful / total) * 100 : 0;

  return {
    id: 'agent_performance',
    name: 'Agent Step Performance',
    description: 'Evaluates success rate of individual agent execution steps',
    testCases: total,
    passed: successful,
    failed,
    accuracy: Math.round(accuracy * 10) / 10,
    confusionMatrix: {
      truePositive: successful,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: failed
    },
    topFailures: Object.entries(stepFailures)
      .map(([case_name, frequency]) => ({ case: `${case_name} step failure`, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5),
    lastRun: traces[0]?.run?.startedAt || null,
    status: 'completed',
    additionalMetrics: {
      avgStepLatency: Object.entries(avgLatency).map(([step, latencies]) => ({
        step,
        avgMs: Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length)
      }))
    }
  };
}

async function calculateKnowledgeBaseEval() {
  // Evaluate KB coverage and usage
  const kbDocs = await prisma.kbDoc.findMany();
  const traces = await prisma.agentTrace.findMany({
    where: {
      step: 'kb-search'
    },
    take: 200,
    orderBy: { runId: 'desc' },
    include: {
      run: true
    }
  });

  let relevantQueries = 0;
  let successfulRetrievals = 0;
  const queryFailures: { [key: string]: number } = {};

  traces.forEach(trace => {
    relevantQueries++;
    if (trace.ok) {
      successfulRetrievals++;
    } else {
      queryFailures['Knowledge retrieval failed'] = (queryFailures['Knowledge retrieval failed'] || 0) + 1;
    }
  });

  const accuracy = relevantQueries > 0 ? (successfulRetrievals / relevantQueries) * 100 : 0;

  return {
    id: 'knowledge_base',
    name: 'Knowledge Base Retrieval',
    description: 'Tests effectiveness of knowledge base search and retrieval',
    testCases: relevantQueries,
    passed: successfulRetrievals,
    failed: relevantQueries - successfulRetrievals,
    accuracy: Math.round(accuracy * 10) / 10,
    confusionMatrix: {
      truePositive: successfulRetrievals,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: relevantQueries - successfulRetrievals
    },
    topFailures: Object.entries(queryFailures)
      .map(([case_name, frequency]) => ({ case: case_name, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5),
    lastRun: traces[0]?.run?.startedAt || null,
    status: 'completed',
    additionalMetrics: {
      totalKbDocs: kbDocs.length,
      avgDocLength: kbDocs.length > 0 ? Math.round(kbDocs.reduce((sum, doc) => sum + doc.contentText.length, 0) / kbDocs.length) : 0
    }
  };
}

async function calculateCaseHandlingEval() {
  // Evaluate case handling efficiency
  const cases = await prisma.case.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    include: {
      events: true,
      customer: true,
      txn: true
    }
  });

  let resolvedCases = 0;
  let avgResolutionTime = 0;
  const statusDistribution: { [key: string]: number } = {};
  const failures: { [key: string]: number } = {};

  cases.forEach(caseItem => {
    statusDistribution[caseItem.status] = (statusDistribution[caseItem.status] || 0) + 1;
    
    if (caseItem.status === 'resolved' || caseItem.status === 'closed') {
      resolvedCases++;
      
      // Calculate resolution time from first to last event
      if (caseItem.events.length > 1) {
        const firstEvent = caseItem.events.sort((a, b) => a.ts.getTime() - b.ts.getTime())[0];
        const lastEvent = caseItem.events[caseItem.events.length - 1];
        const resolutionTimeHours = (lastEvent.ts.getTime() - firstEvent.ts.getTime()) / (1000 * 60 * 60);
        avgResolutionTime += resolutionTimeHours;
      }
    } else if (caseItem.status === 'escalated') {
      failures['Case required escalation'] = (failures['Case required escalation'] || 0) + 1;
    } else if (caseItem.status === 'pending') {
      failures['Case pending resolution'] = (failures['Case pending resolution'] || 0) + 1;
    }
  });

  avgResolutionTime = cases.length > 0 ? avgResolutionTime / resolvedCases : 0;
  const accuracy = cases.length > 0 ? (resolvedCases / cases.length) * 100 : 0;

  return {
    id: 'case_handling',
    name: 'Case Handling Efficiency',
    description: 'Evaluates case resolution speed and success rate',
    testCases: cases.length,
    passed: resolvedCases,
    failed: cases.length - resolvedCases,
    accuracy: Math.round(accuracy * 10) / 10,
    confusionMatrix: {
      truePositive: resolvedCases,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: cases.length - resolvedCases
    },
    topFailures: Object.entries(failures)
      .map(([case_name, frequency]) => ({ case: case_name, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5),
    lastRun: cases[0]?.createdAt || null,
    status: 'completed',
    additionalMetrics: {
      avgResolutionTimeHours: Math.round(avgResolutionTime * 10) / 10,
      statusDistribution
    }
  };
}

// GET /api/evals - Get all evaluation results
router.get('/', async (req, res) => {
  try {
    const evaluations = await Promise.all([
      calculateFraudDetectionEval(),
      calculateAgentPerformanceEval(),
      calculateKnowledgeBaseEval(),
      calculateCaseHandlingEval()
    ]);
    console.log("CLI Evaluations : ",evaluations);
    res.json(evaluations);
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ error: 'Failed to fetch evaluations' });
  }
});

// POST /api/evals/:id/run - Run a specific evaluation
router.post('/:id/run', async (req, res) => {
  try {
    const { id } = req.params;
    
    let evaluation;
    switch (id) {
      case 'fraud_detection':
        evaluation = await calculateFraudDetectionEval();
        break;
      case 'agent_performance':
        evaluation = await calculateAgentPerformanceEval();
        break;
      case 'knowledge_base':
        evaluation = await calculateKnowledgeBaseEval();
        break;
      case 'case_handling':
        evaluation = await calculateCaseHandlingEval();
        break;
      default:
        return res.status(404).json({ error: 'Evaluation not found' });
    }

    res.json(evaluation);
  } catch (error) {
    console.error('Error running evaluation:', error);
    res.status(500).json({ error: 'Failed to run evaluation' });
  }
});

// GET /api/evals/:id - Get specific evaluation result
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    let evaluation;
    switch (id) {
      case 'fraud_detection':
        evaluation = await calculateFraudDetectionEval();
        break;
      case 'agent_performance':
        evaluation = await calculateAgentPerformanceEval();
        break;
      case 'knowledge_base':
        evaluation = await calculateKnowledgeBaseEval();
        break;
      case 'case_handling':
        evaluation = await calculateCaseHandlingEval();
        break;
      default:
        return res.status(404).json({ error: 'Evaluation not found' });
    }

    res.json(evaluation);
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    res.status(500).json({ error: 'Failed to fetch evaluation' });
  }
});

export default router;