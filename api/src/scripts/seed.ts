import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { splitExcelDataToJsonObjects } from '../utils/splitExcelDataToJsonFiles';

const prisma = new PrismaClient();

export async function seedCustomersFromExcel(excelData: any[]) {
  console.log('Parsed Excel Data:', excelData);
  // Clear all tables
  await prisma.agentTrace.deleteMany();
  await prisma.triageRun.deleteMany();
  await prisma.caseEvent.deleteMany();
  await prisma.case.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.card.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.kbDoc.deleteMany();
  await prisma.policy.deleteMany();

  // Split Excel data
  const split = splitExcelDataToJsonObjects(excelData);
  const customers = split.customers;
  const cards = split.cards;
  const accounts = split.accounts;
  const transactions = split.transactions;

  // Use fixtures for kbDocs and policies
  const fixturesPath = path.join(__dirname, '../../../fixtures');
  const kbDocs = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'kb_docs.json'), 'utf-8'));
  const policies = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'policies.json'), 'utf-8'));

  // Insert customers
  for (const customer of customers) {
    await prisma.customer.create({
      data: {
        id: customer.id,
        name: customer.name,
        emailMasked: customer.emailMasked,
        kycLevel: customer.kycLevel,
        createdAt: new Date(customer.createdAt)
      }
    });
  }
  // Insert cards
  for (const card of cards) {
    await prisma.card.create({
      data: {
        id: card.id,
        customerId: card.customerId,
        last4: card.last4,
        network: card.network,
        status: card.status,
        createdAt: new Date(card.createdAt)
      }
    });
  }
  // Insert accounts
  for (const account of accounts) {
    await prisma.account.create({
      data: {
        id: account.id,
        customerId: account.customerId,
        balanceCents: account.balanceCents,
        currency: account.currency
      }
    });
  }
  // Insert transactions
  for (const txn of transactions) {
    await prisma.transaction.create({
      data: {
        id: txn.id,
        customerId: txn.customerId,
        cardId: txn.cardId,
        mcc: txn.mcc,
        merchant: txn.merchant,
        amountCents: txn.amountCents,
        currency: txn.currency,
        ts: new Date(txn.ts),
        deviceId: txn.deviceId,
        country: txn.country,
        city: txn.city,
      }
    });
  }
  // Insert kbDocs
  for (const doc of kbDocs) {
    await prisma.kbDoc.create({
      data: {
        id: doc.id,
        title: doc.title,
        anchor: doc.anchor,
        contentText: doc.contentText
      }
    });
  }
  // Insert policies
  for (const policy of policies) {
    await prisma.policy.create({
      data: {
        id: policy.id,
        code: policy.code,
        title: policy.title,
        contentText: policy.contentText
      }
    });
  }

  // Insert alerts for transactions with alert_status and alert_risk
  for (const txn of transactions) {
    if (txn.alert_status && txn.alert_risk) {
      await prisma.alert.create({
        data: {
          customerId: txn.customerId,
          suspectTxnId: txn.id,
          risk: txn.alert_risk,
          status: txn.alert_status
        }
      });
    }
  }

  console.log('✅ Excel data seeded successfully!');
}

async function main() {
  console.log('🌱 Starting database seed...');

  // Load fixture data
  const fixturesPath = path.join(__dirname, '../../../fixtures');

  const customers = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'customers.json'), 'utf-8'));
  const cards = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'cards.json'), 'utf-8'));
  const accounts = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'accounts.json'), 'utf-8'));
  const kbDocs = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'kb_docs.json'), 'utf-8'));
  const policies = JSON.parse(fs.readFileSync(path.join(fixturesPath, 'policies.json'), 'utf-8'));

  // Clear existing data
  console.log('🗑️  Clearing existing data...');
  await prisma.agentTrace.deleteMany();
  await prisma.triageRun.deleteMany();
  await prisma.caseEvent.deleteMany();
  await prisma.case.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.card.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.kbDoc.deleteMany();
  await prisma.policy.deleteMany();

  // Seed customers
  console.log('👥 Seeding customers...');
  for (const customer of customers) {
    await prisma.customer.create({
      data: {
        id: customer.id,
        name: customer.name,
        emailMasked: customer.emailMasked,
        kycLevel: customer.kycLevel,
        createdAt: new Date(customer.createdAt)
      }
    });
  }

  // Seed cards
  console.log('💳 Seeding cards...');
  for (const card of cards) {
    await prisma.card.create({
      data: {
        id: card.id,
        customerId: card.customerId,
        last4: card.last4,
        network: card.network,
        status: card.status,
        createdAt: new Date(card.createdAt)
      }
    });
  }

  // Seed accounts
  console.log('🏦 Seeding accounts...');
  for (const account of accounts) {
    await prisma.account.create({
      data: {
        id: account.id,
        customerId: account.customerId,
        balanceCents: account.balanceCents,
        currency: account.currency
      }
    });
  }

  // Seed knowledge base
  console.log('📚 Seeding knowledge base...');
  for (const doc of kbDocs) {
    await prisma.kbDoc.create({
      data: {
        id: doc.id,
        title: doc.title,
        anchor: doc.anchor,
        contentText: doc.contentText
      }
    });
  }

  // Seed policies
  console.log('📋 Seeding policies...');
  for (const policy of policies) {
    await prisma.policy.create({
      data: {
        id: policy.id,
        code: policy.code,
        title: policy.title,
        contentText: policy.contentText
      }
    });
  }

  // Generate sample transactions
  console.log('💰 Generating sample transactions...');
  await generateSampleTransactions();

  // Generate sample alerts
  console.log('🚨 Generating sample alerts...');
  await generateSampleAlerts();

  console.log('✅ Database seed completed successfully!');
}

async function generateSampleTransactions() {
  const merchants = [
    'Starbucks Coffee', 'Amazon.com', 'Uber Technologies', 'Walmart', 'Target',
    'McDonald\'s', 'Shell Gas Station', 'Best Buy', 'Home Depot', 'Costco',
    'Apple Store', 'Netflix', 'Spotify', 'Whole Foods', 'CVS Pharmacy'
  ];

  const mccs = ['5812', '5411', '4121', '5541', '5732', '5999', '4111', '5912'];
  const countries = ['US', 'CA', 'GB', 'FR', 'DE'];
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Toronto', 'London'];

  const customers = await prisma.customer.findMany({ include: { cards: true } });
  
  for (const customer of customers) {
    if (customer.cards.length === 0) continue;
    
    const card = customer.cards[0];
    const transactionCount = Math.floor(Math.random() * 50) + 20; // 20-70 transactions per customer
    
    for (let i = 0; i < transactionCount; i++) {
      const daysAgo = Math.floor(Math.random() * 90); // Last 90 days
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      date.setHours(Math.floor(Math.random() * 24));
      date.setMinutes(Math.floor(Math.random() * 60));

      await prisma.transaction.create({
        data: {
          customerId: customer.id,
          cardId: card.id,
          mcc: mccs[Math.floor(Math.random() * mccs.length)],
          merchant: merchants[Math.floor(Math.random() * merchants.length)],
          amountCents: Math.floor(Math.random() * 50000) + 500, // $5-$500
          currency: 'USD',
          ts: date,
          deviceId: `device_${Math.floor(Math.random() * 5) + 1}`,
          country: countries[Math.floor(Math.random() * countries.length)],
          city: cities[Math.floor(Math.random() * cities.length)]
        }
      });
    }
  }
}

async function generateSampleAlerts() {
  const transactions = await prisma.transaction.findMany({
    take: 10,
    orderBy: { ts: 'desc' }
  });

  for (let i = 0; i < Math.min(5, transactions.length); i++) {
    const txn = transactions[i];
    await prisma.alert.create({
      data: {
        customerId: txn.customerId,
        suspectTxnId: txn.id,
        risk: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
        status: 'INVESTIGATING'
      }
    });
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });