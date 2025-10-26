import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

const router = Router()
const prisma = new PrismaClient()

// GET /api/alerts - Get all alerts with customer and transaction details
router.get('/', async (req, res) => {
  try {
    // Return all alerts (filtering handled in frontend)
    const alerts = await prisma.alert.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            emailMasked: true
          }
        },
        suspectTxn: {
          select: {
            id: true,
            merchant: true,
            amountCents: true,
            currency: true,
            ts: true,
            mcc: true,
            country: true,
            city: true,
            cardId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: 0
    })

    // Transform the data to match the frontend interface
    const transformedAlerts = alerts.map(alert => ({
      id: alert.id,
      customer: {
        id: alert.customer.id,
        name: alert.customer.name,
        email: alert.customer.emailMasked
      },
      type: getAlertType(alert.suspectTxn.mcc, alert.suspectTxn.merchant),
      severity: alert.risk as 'high' | 'medium' | 'low',
      status: alert.status.toLowerCase() as 'open' | 'investigating' | 'resolved',
      timestamp: alert.createdAt.toISOString(),
      description: generateAlertDescription(alert.suspectTxn, alert.risk),
      amount: alert.suspectTxn.amountCents / 100,
      transaction: {
        id: alert.suspectTxn.id,
        merchant: alert.suspectTxn.merchant,
        mcc: alert.suspectTxn.mcc,
        country: alert.suspectTxn.country,
        city: alert.suspectTxn.city,
        timestamp: alert.suspectTxn.ts.toISOString(),
        card_id: alert.suspectTxn.cardId
      }
    }))

    logger.info(`Retrieved ${alerts.length} alerts`)
    res.json(transformedAlerts)
  } catch (error) {
    logger.error('Error fetching alerts:', error)
    res.status(500).json({ error: 'Failed to fetch alerts' })
  }
})

// GET /api/alerts/:id - Get specific alert with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            emailMasked: true,
            kycLevel: true,
            createdAt: true
          }
        },
        suspectTxn: {
          include: {
            card: {
              select: {
                last4: true,
                network: true,
                status: true
              }
            }
          }
        },
        triageRuns: {
          orderBy: {
            startedAt: 'desc'
          },
          take: 1,
          include: {
            traces: {
              orderBy: {
                seq: 'asc'
              }
            }
          }
        }
      }
    })

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' })
    }

    const transformedAlert = {
      id: alert.id,
      customer: {
        id: alert.customer.id,
        name: alert.customer.name,
        email: alert.customer.emailMasked,
        kycLevel: alert.customer.kycLevel,
        memberSince: alert.customer.createdAt.toISOString()
      },
      type: getAlertType(alert.suspectTxn.mcc, alert.suspectTxn.merchant),
      severity: alert.risk as 'high' | 'medium' | 'low',
      status: alert.status.toLowerCase() as 'open' | 'investigating' | 'resolved',
      timestamp: alert.createdAt.toISOString(),
      description: generateAlertDescription(alert.suspectTxn, alert.risk),
      amount: alert.suspectTxn.amountCents / 100,
      transaction: {
        id: alert.suspectTxn.id,
        merchant: alert.suspectTxn.merchant,
        mcc: alert.suspectTxn.mcc,
        country: alert.suspectTxn.country,
        city: alert.suspectTxn.city,
        timestamp: alert.suspectTxn.ts.toISOString(),
        card: alert.suspectTxn.card ? {
          last4: alert.suspectTxn.card.last4,
          network: alert.suspectTxn.card.network,
          status: alert.suspectTxn.card.status
        } : null
      },
      triageRun: alert.triageRuns[0] ? {
        id: alert.triageRuns[0].id,
        startedAt: alert.triageRuns[0].startedAt.toISOString(),
        endedAt: alert.triageRuns[0].endedAt?.toISOString(),
        risk: alert.triageRuns[0].risk,
        reasons: alert.triageRuns[0].reasons,
        fallbackUsed: alert.triageRuns[0].fallbackUsed,
        latencyMs: alert.triageRuns[0].latencyMs,
        traces: alert.triageRuns[0].traces
      } : null
    }

    logger.info(`Retrieved alert details for ${id}`)
    res.json(transformedAlert)
  } catch (error) {
    logger.error('Error fetching alert details:', error)
    res.status(500).json({ error: 'Failed to fetch alert details' })
  }
})

// PUT /api/alerts/:id/status - Update alert status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!status || !['OPEN', 'INVESTIGATING', 'RESOLVED'].includes(status.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid status. Must be OPEN, INVESTIGATING, or RESOLVED' })
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: { status: status.toUpperCase() },
      include: {
        customer: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    logger.info(`Updated alert ${id} status to ${status}`)
    res.json({
      id: updatedAlert.id,
      status: updatedAlert.status.toLowerCase(),
      customer: updatedAlert.customer
    })
  } catch (error) {
    logger.error('Error updating alert status:', error)
    res.status(500).json({ error: 'Failed to update alert status' })
  }
})

// GET /api/alerts/stats - Get alert statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const [total, byStatus, byRisk] = await Promise.all([
      prisma.alert.count(),
      prisma.alert.groupBy({
        by: ['status'],
        _count: true
      }),
      prisma.alert.groupBy({
        by: ['risk'],
        _count: true
      })
    ])

    const stats = {
      total,
      byStatus: byStatus.reduce((acc, curr) => ({
        ...acc,
        [curr.status.toLowerCase()]: curr._count
      }), {}),
      byRisk: byRisk.reduce((acc, curr) => ({
        ...acc,
        [curr.risk]: curr._count
      }), {})
    }

    res.json(stats)
  } catch (error) {
    logger.error('Error fetching alert stats:', error)
    res.status(500).json({ error: 'Failed to fetch alert statistics' })
  }
})

// Helper function to determine alert type based on MCC and merchant
function getAlertType(mcc: string, merchant: string): string {
  // Map common MCCs to alert types
  const mccTypes: { [key: string]: string } = {
    '5411': 'Grocery',
    '5541': 'Gas Station',
    '5812': 'Restaurant',
    '5999': 'Retail',
    '6011': 'ATM',
    '7011': 'Hotel',
    '4111': 'Transportation',
    '5311': 'Department Store',
    '5200': 'Home Improvement',
    '5733': 'Music Store'
  }

  // Check for high-risk patterns
  if (merchant.toLowerCase().includes('crypto') || merchant.toLowerCase().includes('bitcoin')) {
    return 'Cryptocurrency'
  }
  
  if (merchant.toLowerCase().includes('gaming') || merchant.toLowerCase().includes('casino')) {
    return 'Gaming/Gambling'
  }

  return mccTypes[mcc] || 'Suspicious Transaction'
}

// Helper function to generate alert description
function generateAlertDescription(transaction: any, risk: string): string {
  const amount = (transaction.amountCents / 100).toLocaleString()
  const merchant = transaction.merchant
  const location = transaction.country && transaction.city ? 
    `in ${transaction.city}, ${transaction.country}` : 
    transaction.country ? `in ${transaction.country}` : ''

  if (risk === 'high') {
    return `High-risk transaction of $${amount} at ${merchant} ${location}. Multiple fraud indicators detected.`
  } else if (risk === 'medium') {
    return `Suspicious transaction of $${amount} at ${merchant} ${location}. Unusual spending pattern detected.`
  } else {
    return `Low-risk alert for transaction of $${amount} at ${merchant} ${location}. Automated monitoring flagged for review.`
  }
}

export default router