import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Validation rules
const searchValidation = [
  query('q').isString().isLength({ min: 1, max: 500 }).withMessage('Query must be 1-500 characters')
];

interface KBResult {
  docId: string;
  title: string;
  anchor: string;
  extract: string;
  relevanceScore: number;
}

// Knowledge base search endpoint
router.get('/search', searchValidation, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { q: query } = req.query as { q: string };
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Simple text search (in production, you'd use full-text search or vector similarity)
    const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
    
    const kbDocs = await prisma.kbDoc.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' as any } },
          { contentText: { contains: query, mode: 'insensitive' as any } },
          ...searchTerms.map(term => ({
            OR: [
              { title: { contains: term, mode: 'insensitive' as any } },
              { contentText: { contains: term, mode: 'insensitive' as any } }
            ]
          }))
        ]
      },
      take: limit * 2 // Get more for relevance scoring
    });

    // Calculate relevance scores
    const results: KBResult[] = kbDocs.map(doc => {
      const titleMatches = countMatches(doc.title.toLowerCase(), searchTerms);
      const contentMatches = countMatches(doc.contentText.toLowerCase(), searchTerms);
      
      // Weight title matches higher
      const relevanceScore = (titleMatches * 3) + contentMatches;
      
      // Extract relevant snippet
      const extract = extractSnippet(doc.contentText, query, 200);

      return {
        docId: doc.id,
        title: doc.title,
        anchor: doc.anchor,
        extract,
        relevanceScore
      };
    })
    .filter(result => result.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/kb/search', status_code: '200' },
      duration
    );

    logger.info('KB search completed', {
      requestId: req.requestId,
      query: query.substring(0, 100), // Log first 100 chars only
      resultCount: results.length,
      duration,
      event: 'kb_search_completed'
    });

    res.json({
      results,
      query,
      totalResults: results.length
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.apiRequestLatency.observe(
      { method: req.method, route: '/kb/search', status_code: '500' },
      duration
    );
    
    logger.error('KB search failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
      query: (req.query.q as string)?.substring(0, 100),
      event: 'kb_search_failed'
    });
    
    res.status(500).json({ error: 'Search failed' });
  }
});

function countMatches(text: string, terms: string[]): number {
  let matches = 0;
  for (const term of terms) {
    const regex = new RegExp(term, 'gi');
    const termMatches = (text.match(regex) || []).length;
    matches += termMatches;
  }
  return matches;
}

function extractSnippet(text: string, query: string, maxLength: number): string {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Find the first occurrence of any query term
  const queryTerms = queryLower.split(' ').filter(term => term.length > 2);
  let bestIndex = -1;
  let bestTerm = '';
  
  for (const term of queryTerms) {
    const index = textLower.indexOf(term);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestTerm = term;
    }
  }
  
  if (bestIndex === -1) {
    // No direct matches, return beginning of text
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  }
  
  // Extract snippet around the match
  const padding = Math.floor((maxLength - bestTerm.length) / 2);
  const start = Math.max(0, bestIndex - padding);
  const end = Math.min(text.length, start + maxLength);
  
  let snippet = text.substring(start, end);
  
  // Add ellipsis if truncated
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}

export default router;