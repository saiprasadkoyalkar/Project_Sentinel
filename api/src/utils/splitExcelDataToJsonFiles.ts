// Helper to deduplicate by a key
function dedupeBy<T>(arr: T[], key: (item: T) => string) {
  const seen = new Set();
  return arr.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function splitExcelDataToJsonObjects(parsedData: any[]) {
  const customers = dedupeBy(parsedData.map(row => ({
    id: row.customer_id,
    name: row.customer_name,
    emailMasked: row.customer_email,
    kycLevel: row.kyc_level,
    createdAt: row.customer_registration_date ? new Date(row.customer_registration_date).toISOString() : new Date().toISOString(),
  })), c => c.id);

  
  const accounts = dedupeBy(parsedData.map(row => ({
    id: row.account_id,
    customerId: row.customer_id,
    balanceCents: row.balance_cents,
    currency: row.currency,
  })), a => a.id);

  
  const cards = dedupeBy(parsedData.map(row => ({
    id: row.card_id,
    customerId: row.customer_id,
    last4: row.last4,
    network: row.network,
    status: row.status,
    createdAt: row.card_created_at ? new Date(row.card_created_at).toISOString() : new Date().toISOString(),
  })), c => c.id);

  
  const transactions = dedupeBy(parsedData.map(row => ({
    id: row.transaction_id,
    customerId: row.customer_id,
    cardId: row.card_id,
    mcc: row.merchant_id ? String(row.merchant_id) : '',
    merchant: row.merchant_name,
    amountCents: row.amount_cents,
    currency: row.currency,
    ts: row.transactions_happend_time_stamp ? new Date(row.transactions_happend_time_stamp).toISOString() : new Date().toISOString(),
    deviceId: row.device_id,
    country: row.transaction_country,
    city: row.transaction_city,
    alert_status: row.alert_status,
    alert_risk: row.alert_risk,
  })), t => t.id);

  return { customers, accounts, cards, transactions };
}
