import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../index';
import { redis } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const freezeCardValidation = [
  body('cardId').isString().notEmpty().withMessage('Card ID is required'),
  body('otp').optional().isString().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
];

// Contact customer about alert
router.post('/contact-customer', async (req: AuthenticatedRequest, res: Response) => {
  const { alertId, customerId, suspectTxnId } = req.body;
  const userId = req.user?.id || 'unknown';
  const requestId = uuidv4();
  try {
    if (!alertId || !customerId) {
      return res.status(400).json({ error: 'alertId and customerId are required' });
    }

    // Create a case for contacting the customer
    const caseRecord = await prisma.case.create({
      data: {
        customerId,
        txnId: suspectTxnId || null,
        type: 'CONTACT_CUSTOMER',
        status: 'CLOSED',
        reasonCode: 'CUSTOMER_CONTACTED'
      }
    });

    // Log the contact event
    await prisma.caseEvent.create({
      data: {
        caseId: caseRecord.id,
        actor: userId,
        action: 'CUSTOMER_CONTACTED',
        payloadJson: {
          alertId,
          customerId,
          suspectTxnId,
          timestamp: new Date().toISOString()
        }
      }
    });

    // Optionally, mark alert as updated (e.g., CONTACTED)
    await prisma.alert.update({
      where: { id: alertId },
      data: { status: 'CONTACTED' }
    }).catch(() => {}); // ignore if alert not found

    logger.info('Contacted customer and logged case/event', {
      requestId,
      alertId,
      customerId,
      suspectTxnId,
      userId,
      caseId: caseRecord.id,
      event: 'contact_customer_logged',
    });

    return res.json({ success: true, message: 'Customer contact initiated and logged', requestId, caseId: caseRecord.id });
  } catch (error: any) {
    logger.error('Failed to contact customer', { error: error.message, requestId });
    return res.status(500).json({ error: 'Failed to contact customer' });
  }
});


router.post('/freeze-card', freezeCardValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  const idempotencyKey = req.headers['idempotency-key'] as string;
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cardId, otp, alertId, customerId, suspectTxnId } = req.body;
    const userId = req.user?.id || 'unknown';
    const userRole = req.user?.role || 'agent';
    const requestId = uuidv4();

    // Check idempotency
    if (idempotencyKey) {
      const existingResult = await redis.get(`idempotency:freeze:${idempotencyKey}`);
      if (existingResult) {
        const result = JSON.parse(existingResult);
        logger.info('Returning idempotent freeze card result', {
          requestId: req.requestId,
          idempotencyKey,
          cardId,
          event: 'idempotent_freeze_card_result'
        });
        return res.json(result);
      }
    }

    // Verify card exists and get customer info
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { customer: true }
    });
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Check if card is already frozen
    if (card.status === 'FROZEN') {
      const result = {
        status: 'FROZEN',
        requestId,
        message: 'Card is already frozen',
        timestamp: new Date().toISOString()
      };
      if (idempotencyKey) {
        await redis.setex(`idempotency:freeze:${idempotencyKey}`, 3600, JSON.stringify(result));
      }
      return res.json(result);
    }

    // For high-value cards or sensitive operations, require OTP
    // const requiresOTP = await shouldRequireOTP(card, userRole);
    if (!otp) {
      metrics.actionBlockedTotal?.inc?.({ policy: 'otp_required' });
      const result = {
        status: 'PENDING_OTP',
        requestId,
        message: 'OTP verification required',
        otpSent: true,
        timestamp: new Date().toISOString()
      };
      logger.info('OTP required for card freeze', {
        requestId: req.requestId,
        cardId,
        customerId_masked: redactor.maskCustomerId(card.customerId),
        userRole,
        event: 'freeze_card_otp_required'
      });
      return res.json(result);
    }

    if (otp) {
      // Verify OTP
      const isValidOTP = await verifyOTP(cardId, otp);
      if (!isValidOTP) {
        logger.warn('Invalid OTP for card freeze', {
          requestId: req.requestId,
          cardId,
          customerId_masked: redactor.maskCustomerId(card.customerId),
          event: 'freeze_card_invalid_otp'
        });
        return res.status(400).json({ error: 'Invalid OTP' });
      }
    }

    // Execute card freeze and log case/event
    await prisma.$transaction(async (tx) => {
      // Update card status
      await tx.card.update({
        where: { id: cardId },
        data: { status: 'FROZEN' }
      });

      // Create case record
      const caseRecord = await tx.case.create({
        data: {
          customerId: card.customerId,
          txnId: suspectTxnId,
          type: 'CARD_FREEZE',
          status: 'CLOSED',
          reasonCode: 'FRAUD_PREVENTION'
        }
      });

      // Log audit event
      await tx.caseEvent.create({
        data: {
          caseId: caseRecord.id,
          actor: userId,
          action: 'CARD_FROZEN',
          payloadJson: {
            cardId,
            alertId,
            suspectTxnId,
            method: 'otp_verified',
            userRole,
            timestamp: new Date().toISOString()
          }
        }
      });

      // Mark alert as resolved
      if (alertId) {
        await tx.alert.update({ where: { id: alertId }, data: { status: 'Resolved' } });
      }
    }, { timeout: 20000 }); // Increased timeout to 20 seconds

    const result = {
      status: 'FROZEN',
      requestId,
      cardId,
      message: 'Card has been successfully frozen',
      timestamp: new Date().toISOString()
    };
    if (idempotencyKey) {
      await redis.setex(`idempotency:freeze:${idempotencyKey}`, 3600, JSON.stringify(result));
    }
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency?.observe?.(
      { method: req.method, route: '/action/freeze-card', status_code: '200' },
      duration
    );
    logger.info('Card frozen successfully', {
      requestId: req.requestId,
      cardId,
      customerId_masked: redactor.maskCustomerId(card.customerId),
      userRole,
      duration,
      event: 'card_frozen_successfully'
    });
    res.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency?.observe?.(
      { method: req.method, route: '/action/freeze-card', status_code: '500' },
      duration
    );
    logger.error('Failed to freeze card:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      cardId: req.body.cardId,
      event: 'freeze_card_failed'
    });
    res.status(500).json({ error: 'Failed to freeze card' });
  }
});

// Validation for open-dispute endpoint
const openDisputeValidation = [
  body('txnId').isString().notEmpty().withMessage('Transaction ID is required'),
  body('reasonCode').isString().notEmpty().withMessage('Reason code is required')
];



// Mark False Positive endpoint
router.post('/mark-false-positive', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { alertId, customerId, suspectTxnId } = req.body;
    const userId = req.user?.id || 'unknown';
    if (!alertId || !customerId) {
      return res.status(400).json({ error: 'alertId and customerId are required' });
    }

    // Find the alert and transaction
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Create a closed false positive case
    const caseRecord = await prisma.case.create({
      data: {
        customerId,
        txnId: suspectTxnId || alert.suspectTxnId,
        type: 'FALSE_POSITIVE',
        status: 'CLOSED_FALSE_POSITIVE',
        reasonCode: 'AI_FALSE_POSITIVE',
      }
    });

    // Log the false positive event
    await prisma.caseEvent.create({
      data: {
        caseId: caseRecord.id,
        actor: userId,
        action: 'CLOSED_FALSE_POSITIVE',
        payloadJson: { alertId, customerId, suspectTxnId, timestamp: new Date().toISOString() }
      }
    });

    // Mark alert as resolved
    await prisma.alert.update({ where: { id: alertId }, data: { status: 'CLOSED_FALSE_POSITIVE' } });

    res.json({ status: 'CLOSED_FALSE_POSITIVE', caseId: caseRecord.id, message: 'Alert closed as false positive.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark false positive' });
  }
});

// Open dispute endpoint
router.post('/open-dispute', openDisputeValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  const idempotencyKey = req.headers['idempotency-key'] as string;
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { txnId, reasonCode } = req.body;
    const userId = req.user?.id || 'unknown';
    const requestId = uuidv4();

    // Check idempotency
    if (idempotencyKey) {
      const existingResult = await redis.get(`idempotency:dispute:${idempotencyKey}`);
      if (existingResult) {
        const result = JSON.parse(existingResult);
        logger.info('Returning idempotent dispute result', {
          requestId: req.requestId,
          idempotencyKey,
          txnId,
          event: 'idempotent_dispute_result'
        });
        return res.json(result);
      }
    }

    // Verify transaction exists
    const transaction = await prisma.transaction.findUnique({
      where: { id: txnId },
      include: { customer: true }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check if dispute already exists for this transaction
    const existingDispute = await prisma.case.findFirst({
      where: {
        txnId,
        type: 'DISPUTE',
        status: { in: ['OPEN', 'PENDING'] }
      }
    });

    if (existingDispute) {
      const result = {
        caseId: existingDispute.id,
        status: 'OPEN',
        message: 'Dispute already exists for this transaction',
        requestId,
        timestamp: new Date().toISOString()
      };
      if (idempotencyKey) {
        await redis.setex(`idempotency:dispute:${idempotencyKey}`, 3600, JSON.stringify(result));
      }
      return res.json(result);
    }

    // Create dispute case and mark alert as Investigating if present
    let caseRecord: any;
    await prisma.$transaction(async (tx) => {
      // Create case
      caseRecord = await tx.case.create({
        data: {
          customerId: transaction.customerId,
          txnId,
          type: 'DISPUTE',
          status: 'OPEN',
          reasonCode
        }
      });

      // Log audit event
      await tx.caseEvent.create({
        data: {
          caseId: caseRecord.id,
          actor: userId,
          action: 'DISPUTE_OPENED',
          payloadJson: {
            txnId,
            reasonCode,
            amount: transaction.amountCents,
            merchant: redactor.redactText(transaction.merchant).cleanText,
            timestamp: new Date().toISOString()
          }
        }
      });

      // Mark alert as Investigating if one exists for this transaction
      const alert = await tx.alert.findFirst({ where: { suspectTxnId: txnId } });
      if (alert) {
        await tx.alert.update({ where: { id: alert.id }, data: { status: 'Investigating(Opened the Dispute)' } });
      }
    });

    const result = {
      caseId: caseRecord!.id,
      status: 'OPEN',
      txnId,
      reasonCode,
      message: 'Dispute has been successfully created',
      requestId,
      timestamp: new Date().toISOString()
    };

    // Cache result for idempotency
    if (idempotencyKey) {
      await redis.setex(`idempotency:dispute:${idempotencyKey}`, 3600, JSON.stringify(result));
    }

    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/action/open-dispute', status_code: '200' },
      duration
    );

    logger.info('Dispute opened successfully', {
      requestId: req.requestId,
      caseId: caseRecord!.id,
      txnId,
      customerId_masked: redactor.maskCustomerId(transaction.customerId),
      reasonCode,
      duration,
      event: 'dispute_opened_successfully'
    });

    res.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/action/open-dispute', status_code: '500' },
      duration
    );
    logger.error('Failed to open dispute:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      txnId: req.body.txnId,
      event: 'open_dispute_failed'
    });
    res.status(500).json({ error: 'Failed to open dispute' });
  }
});

// Helper functions
// async function shouldRequireOTP(card: any, userRole: string): Promise<boolean> {
//   // Always require OTP for card freeze except for leads
//   if (userRole === 'lead') return false;

//   // Require OTP for all card freezes as security measure
//   return true;
// }

function generateOTP(): string {
  return "123456"; // In real implementation, generate a random 6-digit code
}

async function verifyOTP(cardId: string, providedOTP: string): Promise<boolean> {
  const storedOTP = "123456";

  const isValid = storedOTP === providedOTP;

  if (isValid) {
    // Delete OTP after successful verification
    logger.info('OTP verified successfully', { cardId, event: 'otp_verified' });
  } else {
    logger.warn('Invalid OTP provided', { cardId, event: 'invalid_otp' });
  }

  return isValid;
}

export default router;