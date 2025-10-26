import { prisma } from '../index';
import { logger } from '../utils/logger';

export interface KBSearchResult {
  results: Array<{
    docId: string;
    title: string;
    anchor: string;
    extract: string;
    relevanceScore: number;
  }>;
  citations: string[];
}

export class KBAgent {
  async searchRelevantDocs(reasons: string[]): Promise<KBSearchResult> {
    try {
      logger.info('Starting KB search', {
        reasonCount: reasons.length,
        event: 'kb_search_started'
      });

      if (reasons.length === 0) {
        return { results: [], citations: [] };
      }

      // Build search query from reasons
      const searchTerms = this.extractSearchTerms(reasons);
      const query = searchTerms.join(' ');

      if (!query.trim()) {
        return { results: [], citations: [] };
      }

      // Search knowledge base
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
        take: 20
      });

      // Score and rank results
      const results = kbDocs.map(doc => {
        const relevanceScore = this.calculateRelevance(doc, searchTerms);
        const extract = this.extractSnippet(doc.contentText, query, 150);

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
      .slice(0, 5);

      // Generate citations
      const citations = this.generateCitations(results, reasons);

      logger.info('KB search completed', {
        query,
        resultCount: results.length,
        event: 'kb_search_completed'
      });

      return { results, citations };
    } catch (error) {
      logger.error('KB search failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'kb_search_failed'
      });
      
      // Return empty results on failure
      return { results: [], citations: [] };
    }
  }

  private extractSearchTerms(reasons: string[]): string[] {
    const terms = new Set<string>();
    
    for (const reason of reasons) {
      // Extract key terms from reason text
      const words = reason.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3);
      
      // Add relevant fraud/finance terms
      const relevantTerms = words.filter(word => 
        this.isRelevantTerm(word)
      );
      
      relevantTerms.forEach(term => terms.add(term));
    }
    
    // Add common fraud-related terms based on reason patterns
    if (reasons.some(r => r.includes('velocity'))) {
      terms.add('velocity');
      terms.add('rapid');
      terms.add('multiple');
    }
    
    if (reasons.some(r => r.includes('device'))) {
      terms.add('device');
      terms.add('authentication');
    }
    
    if (reasons.some(r => r.includes('location'))) {
      terms.add('location');
      terms.add('geographic');
      terms.add('travel');
    }
    
    if (reasons.some(r => r.includes('merchant'))) {
      terms.add('merchant');
      terms.add('suspicious');
    }
    
    return Array.from(terms);
  }

  private isRelevantTerm(word: string): boolean {
    const relevantTerms = [
      'fraud', 'suspicious', 'unusual', 'velocity', 'device', 'location',
      'merchant', 'transaction', 'card', 'payment', 'dispute', 'chargeback',
      'authorization', 'authentication', 'risk', 'security', 'compliance',
      'verification', 'identity', 'pattern', 'behavior', 'anomaly'
    ];
    
    return relevantTerms.includes(word) || word.length > 4;
  }

  private calculateRelevance(doc: any, searchTerms: string[]): number {
    let score = 0;
    const title = doc.title.toLowerCase();
    const content = doc.contentText.toLowerCase();
    
    for (const term of searchTerms) {
      // Title matches are weighted higher
      const titleMatches = (title.match(new RegExp(term, 'g')) || []).length;
      const contentMatches = (content.match(new RegExp(term, 'g')) || []).length;
      
      score += titleMatches * 3 + contentMatches;
    }
    
    return score;
  }

  private extractSnippet(text: string, query: string, maxLength: number): string {
    const queryTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
    let bestIndex = -1;
    
    // Find the first occurrence of any query term
    for (const term of queryTerms) {
      const index = text.toLowerCase().indexOf(term);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
      }
    }
    
    if (bestIndex === -1) {
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }
    
    // Extract snippet around the match
    const padding = Math.floor((maxLength - 20) / 2);
    const start = Math.max(0, bestIndex - padding);
    const end = Math.min(text.length, start + maxLength);
    
    let snippet = text.substring(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    
    return snippet;
  }

  private generateCitations(results: any[], reasons: string[]): string[] {
    const citations: string[] = [];
    
    if (results.length === 0) {
      citations.push('No relevant knowledge base articles found');
      return citations;
    }
    
    // Generate contextual citations based on results and reasons
    for (const result of results.slice(0, 3)) {
      if (result.relevanceScore > 5) {
        citations.push(`See KB: ${result.title} (${result.anchor})`);
      }
    }
    
    // Add specific citations based on fraud patterns
    if (reasons.some(r => r.includes('velocity'))) {
      citations.push('Reference: Transaction Velocity Guidelines');
    }
    
    if (reasons.some(r => r.includes('dispute'))) {
      citations.push('Reference: Dispute Processing Procedures');
    }
    
    if (reasons.some(r => r.includes('device'))) {
      citations.push('Reference: Device Authentication Protocols');
    }
    
    if (citations.length === 0) {
      citations.push('Manual review recommended - see fraud investigation procedures');
    }
    
    return citations;
  }
}