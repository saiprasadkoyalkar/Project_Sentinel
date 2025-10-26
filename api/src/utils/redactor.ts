import { logger } from './logger';
const PAN_PATTERN = /\b\d{13,19}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;

export class Redactor {
  private static instance: Redactor;
  
  public static getInstance(): Redactor {
    if (!Redactor.instance) {
      Redactor.instance = new Redactor();
    }
    return Redactor.instance;
  }

  
  public redactText(text: string): { cleanText: string; masked: boolean } {
    if (!text || typeof text !== 'string') {
      return { cleanText: text, masked: false };
    }

    let cleanText = text;
    let masked = false;

    
    if (PAN_PATTERN.test(cleanText)) {
      cleanText = cleanText.replace(PAN_PATTERN, '****REDACTED****');
      masked = true;
      logger.info('PAN redacted from text', { masked: true, event: 'pii_redacted' });
    }

    
    if (EMAIL_PATTERN.test(cleanText)) {
      cleanText = cleanText.replace(EMAIL_PATTERN, (match) => {
        const parts = match.split('@');
        if (parts.length === 2) {
          const local = parts[0];
          const domain = parts[1];
          const maskedLocal = local && local.length > 2 
            ? local.substring(0, 2) + '***' 
            : '***';
          return `${maskedLocal}@${domain}`;
        }
        return '***@***.***';
      });
      masked = true;
      logger.info('Email redacted from text', { masked: true, event: 'pii_redacted' });
    }

    
    if (PHONE_PATTERN.test(cleanText)) {
      cleanText = cleanText.replace(PHONE_PATTERN, '***-***-****');
      masked = true;
      logger.info('Phone redacted from text', { masked: true, event: 'pii_redacted' });
    }

    return { cleanText, masked };
  }

  
  public redactObject(obj: any): { cleanObj: any; masked: boolean } {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') {
        const { cleanText, masked } = this.redactText(obj);
        return { cleanObj: cleanText, masked };
      }
      return { cleanObj: obj, masked: false };
    }

    let masked = false;
    const cleanObj: any = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        
        if (typeof value === 'string') {
          const { cleanText, masked: textMasked } = this.redactText(value);
          cleanObj[key] = cleanText;
          if (textMasked) masked = true;
        } else if (typeof value === 'object' && value !== null) {
          const { cleanObj: nestedClean, masked: nestedMasked } = this.redactObject(value);
          cleanObj[key] = nestedClean;
          if (nestedMasked) masked = true;
        } else {
          cleanObj[key] = value;
        }
      }
    }

    return { cleanObj, masked };
  }

  
  public maskCustomerId(customerId: string): string {
    if (!customerId || customerId.length < 8) {
      return '***masked***';
    }
    return customerId.substring(0, 4) + '***' + customerId.slice(-2);
  }

  
  public containsPII(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    return PAN_PATTERN.test(text) || 
           EMAIL_PATTERN.test(text) || 
           PHONE_PATTERN.test(text);
  }
}

export const redactor = Redactor.getInstance();