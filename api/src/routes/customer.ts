import { Router, Request, Response } from 'express';
import { param, query, validationResult } from 'express-validator';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { redactor } from '../utils/redactor';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Validation rules
const customerParamValidation = [
  param('id').isString().notEmpty().withMessage('Customer ID is required')
];

const transactionQueryValidation = [
  query('from').optional().isISO8601().withMessage('From date must be valid ISO8601'),
  query('to').optional().isISO8601().withMessage('To date must be valid ISO8601'),
  query('cursor').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
];

// Get customer transactions with keyset pagination
router.get('/:id/transactions', 
  customerParamValidation, 
  transactionQueryValidation, 
  async (req: AuthenticatedRequest, res: Response) => {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id: customerId } = req.params;
      const { from, to, cursor, limit = '50' } = req.query;

      // Build date filters
      const dateFilters: any = {};
      if (from) dateFilters.gte = new Date(from as string);
      if (to) dateFilters.lte = new Date(to as string);

      // Build cursor filters for keyset pagination
      const cursorFilters: any = {};
      if (cursor) {
        const [cursorId, cursorTs] = (cursor as string).split('|');
        cursorFilters.OR = [
          { ts: { lt: new Date(cursorTs) } },
          { 
            ts: new Date(cursorTs),
            id: { lt: cursorId }
          }
        ];
      }

      const whereClause = {
        customerId,
        ...(Object.keys(dateFilters).length > 0 && { ts: dateFilters }),
        ...cursorFilters
      };

      const limitNum = parseInt(limit as string);
      
      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        orderBy: [
          { ts: 'desc' },
          { id: 'desc' }
        ],
        take: limitNum + 1, // Take one extra to determine if there's a next page
        include: {
          card: {
            select: { last4: true, network: true }
          }
        }
      });

      // Determine if there's a next page
      const hasNextPage = transactions.length > limitNum;
      const items = hasNextPage ? transactions.slice(0, limitNum) : transactions;

      // Generate next cursor
      let nextCursor = null;
      if (hasNextPage) {
        const lastItem = items[items.length - 1];
        nextCursor = `${lastItem.id}|${lastItem.ts.toISOString()}`;
      }

      // Redact PII from response
      const cleanItems = items.map(txn => {
        const { cleanObj } = redactor.redactObject(txn);
        return {
          ...cleanObj,
          customerId_masked: redactor.maskCustomerId(txn.customerId)
        };
      });

      const duration = Date.now() - startTime;
      metrics.apiRequestLatency.observe(
        { method: req.method, route: '/customer/:id/transactions', status_code: '200' },
        duration
      );

      logger.info('Customer transactions retrieved', {
        requestId: req.requestId,
        customerId_masked: redactor.maskCustomerId(customerId),
        count: items.length,
        duration,
        event: 'customer_transactions_retrieved'
      });

      res.json({
        items: cleanItems,
        nextCursor,
        hasNextPage,
        totalRetrieved: items.length
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.apiRequestLatency.observe(
        { method: req.method, route: '/customer/:id/transactions', status_code: '500' },
        duration
      );
      
      logger.error('Failed to retrieve customer transactions:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
        customerId_masked: redactor.maskCustomerId(req.params.id),
        event: 'customer_transactions_retrieval_failed'
      });
      
      res.status(500).json({ error: 'Failed to retrieve transactions' });
    }
  }
);

// Get customer profile
router.get('/:id', customerParamValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id: customerId } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        cards: {
          select: {
            id: true,
            last4: true,
            network: true,
            status: true,
            createdAt: true
          }
        },
        accounts: {
          select: {
            id: true,
            balanceCents: true,
            currency: true
          }
        },
        _count: {
          select: {
            transactions: true,
            alerts: true,
            cases: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Redact customer data
    const { cleanObj: cleanCustomer } = redactor.redactObject(customer);

    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/customer/:id', status_code: '200' },
      duration
    );

    logger.info('Customer profile retrieved', {
      requestId: req.requestId,
      customerId_masked: redactor.maskCustomerId(customerId),
      duration,
      event: 'customer_profile_retrieved'
    });

    res.json({
      ...cleanCustomer,
      id_masked: redactor.maskCustomerId(customer.id)
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/customer/:id', status_code: '500' },
      duration
    );
    
    logger.error('Failed to retrieve customer profile:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      customerId_masked: redactor.maskCustomerId(req.params.id),
      event: 'customer_profile_retrieval_failed'
    });
    
    res.status(500).json({ error: 'Failed to retrieve customer profile' });
  }
});

export default router;