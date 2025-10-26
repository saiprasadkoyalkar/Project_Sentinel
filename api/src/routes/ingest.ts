import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

interface TransactionData {
  customerId: string;
  cardId: string;
  mcc: string;
  merchant: string;
  amountCents: number;
  currency: string;
  ts: string;
  deviceId?: string;
  country?: string;
  city?: string;
}

// Validation rules
const transactionValidation = [
  body('transactions').isArray().withMessage('Transactions must be an array'),
  body('transactions.*.customerId').notEmpty().withMessage('Customer ID is required'),
  body('transactions.*.cardId').notEmpty().withMessage('Card ID is required'),
  body('transactions.*.mcc').notEmpty().withMessage('MCC is required'),
  body('transactions.*.merchant').notEmpty().withMessage('Merchant is required'),
  body('transactions.*.amountCents').isInt({ min: 1 }).withMessage('Amount must be positive integer'),
  body('transactions.*.currency').isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters'),
  body('transactions.*.ts').isISO8601().withMessage('Timestamp must be valid ISO8601')
];

// CSV upload endpoint
router.post('/transactions/csv', upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const transactions: TransactionData[] = [];
    const stream = Readable.from(req.file.buffer);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Parse and validate CSV data
          const transaction: TransactionData = {
            customerId: data.customerId || data.customer_id,
            cardId: data.cardId || data.card_id,
            mcc: data.mcc,
            merchant: data.merchant,
            amountCents: parseInt(data.amountCents || data.amount_cents),
            currency: data.currency,
            ts: data.ts || data.timestamp,
            deviceId: data.deviceId || data.device_id,
            country: data.country,
            city: data.city
          };
          
          // Redact PII from merchant name
          const { cleanText: cleanMerchant } = redactor.redactText(transaction.merchant);
          transaction.merchant = cleanMerchant;
          
          transactions.push(transaction);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const result = await ingestTransactions(transactions, req.requestId || 'unknown');
    
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/ingest/transactions/csv', status_code: '200' },
      duration
    );

    res.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/ingest/transactions/csv', status_code: '500' },
      duration
    );
    
    logger.error('CSV ingestion failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      event: 'csv_ingestion_failed'
    });
    
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

// JSON ingestion endpoint
router.post('/transactions', transactionValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { transactions } = req.body;
    
    // Redact PII from all transactions
    const cleanTransactions = transactions.map((txn: TransactionData) => {
      const { cleanText: cleanMerchant } = redactor.redactText(txn.merchant);
      return { ...txn, merchant: cleanMerchant };
    });

    const result = await ingestTransactions(cleanTransactions, req.requestId || 'unknown');
    
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/ingest/transactions', status_code: '200' },
      duration
    );

    res.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/ingest/transactions', status_code: '500' },
      duration
    );
    
    logger.error('Transaction ingestion failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      event: 'transaction_ingestion_failed'
    });
    
    res.status(500).json({ error: 'Failed to ingest transactions' });
  }
});

async function ingestTransactions(transactions: TransactionData[], requestId: string) {
  const startTime = Date.now();
  let accepted = 0;
  let skipped = 0;
  
  try {
    // Use transaction for atomic operation
    await prisma.$transaction(async (tx) => {
      for (const txnData of transactions) {
        try {
          // Check if transaction already exists (deduplication)
          const existing = await tx.transaction.findFirst({
            where: {
              customerId: txnData.customerId,
              merchant: txnData.merchant,
              amountCents: txnData.amountCents,
              ts: new Date(txnData.ts)
            }
          });

          if (existing) {
            skipped++;
            continue;
          }

          // Verify customer and card exist
          const customer = await tx.customer.findUnique({
            where: { id: txnData.customerId }
          });

          if (!customer) {
            logger.warn(`Customer not found: ${redactor.maskCustomerId(txnData.customerId)}`, {
              requestId,
              customerId_masked: redactor.maskCustomerId(txnData.customerId),
              event: 'customer_not_found'
            });
            skipped++;
            continue;
          }

          const card = await tx.card.findUnique({
            where: { id: txnData.cardId }
          });

          if (!card) {
            logger.warn(`Card not found: ${txnData.cardId}`, {
              requestId,
              cardId: txnData.cardId,
              event: 'card_not_found'
            });
            skipped++;
            continue;
          }

          // Insert transaction
          await tx.transaction.create({
            data: {
              customerId: txnData.customerId,
              cardId: txnData.cardId,
              mcc: txnData.mcc,
              merchant: txnData.merchant,
              amountCents: txnData.amountCents,
              currency: txnData.currency,
              ts: new Date(txnData.ts),
              deviceId: txnData.deviceId,
              country: txnData.country,
              city: txnData.city
            }
          });

          accepted++;
        } catch (error) {
          logger.error('Failed to process transaction:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            requestId,
            txnData: redactor.redactObject(txnData).cleanObj,
            event: 'transaction_processing_failed'
          });
          skipped++;
        }
      }
    });

    const duration = Date.now() - startTime;
    
    logger.info('Transaction ingestion completed', {
      requestId,
      accepted,
      skipped,
      total: transactions.length,
      duration,
      event: 'transaction_ingestion_completed'
    });

    return {
      accepted: true,
      count: accepted,
      skipped,
      total: transactions.length,
      requestId,
      durationMs: duration
    };
  } catch (error) {
    logger.error('Transaction ingestion failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      event: 'transaction_ingestion_failed'
    });
    throw error;
  }
}

export default router;