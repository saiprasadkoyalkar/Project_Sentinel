#!/usr/bin/env node

/**
 * Transaction Generator Script
 * Generates large transaction datasets for testing (200k to 1M+ rows)
 * 
 * Usage:
 *   node generate-transactions.js [count]
 *   
 * Examples:
 *   node generate-transactions.js 200000    # Generate 200k transactions
 *   node generate-transactions.js 1000000   # Generate 1M transactions
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DEFAULT_COUNT = 200000;
const BATCH_SIZE = 10000; // Write in batches to avoid memory issues

// Sample data pools
const MERCHANTS = [
  'Starbucks Coffee', 'Amazon.com', 'Uber Technologies', 'Walmart', 'Target',
  'McDonald\'s', 'Shell Gas Station', 'Best Buy', 'Home Depot', 'Costco',
  'Apple Store', 'Netflix', 'Spotify', 'Whole Foods', 'CVS Pharmacy',
  'Chevron', 'Safeway', 'Kroger', 'Walgreens', 'Dollar General',
  'Tesco', 'IKEA', 'H&M', 'Zara', 'Nike Store', 'Adidas',
  'Booking.com', 'Airbnb', 'Expedia', 'Hotels.com', 'Marriott',
  'Subway', 'Pizza Hut', 'KFC', 'Burger King', 'Dominos',
  'Tesla Supercharger', 'ExxonMobil', 'BP Gas', 'Circle K', '7-Eleven'
];

const MCCS = [
  '5812', // Eating places, restaurants
  '5411', // Grocery stores, supermarkets  
  '4121', // Taxicabs and limousines
  '5541', // Service stations
  '5732', // Electronics stores
  '5999', // Miscellaneous retail
  '4111', // Transportation - suburban and local commuter
  '5912', // Drug stores and pharmacies
  '5661', // Shoe stores
  '5691', // Men's and women's clothing stores
  '7011', // Hotels, motels, resorts
  '5814', // Fast food restaurants
  '5533', // Automotive parts and accessories
  '5311', // Department stores
  '4900'  // Utilities
];

const COUNTRIES = ['US', 'CA', 'GB', 'FR', 'DE', 'AU', 'JP', 'IT', 'ES', 'NL'];
const US_CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
  'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
  'Fort Worth', 'Columbus', 'Charlotte', 'San Francisco', 'Indianapolis',
  'Seattle', 'Denver', 'Washington', 'Boston', 'El Paso', 'Nashville',
  'Detroit', 'Oklahoma City', 'Portland', 'Las Vegas', 'Memphis', 'Louisville',
  'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson', 'Fresno', 'Sacramento'
];

const CUSTOMER_IDS = [
  'cust_001', 'cust_002', 'cust_003', 'cust_004', 'cust_005'
];

const CARD_IDS = [
  'card_001', 'card_002', 'card_003', 'card_004', 'card_005'
];

const DEVICE_IDS = [
  'device_001', 'device_002', 'device_003', 'device_004', 'device_005',
  'device_006', 'device_007', 'device_008', 'device_009', 'device_010'
];

// Utility functions
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount() {
  // Generate realistic amounts with different distributions
  const rand = Math.random();
  if (rand < 0.4) {
    // Small purchases $1-$50
    return randomInt(100, 5000); // cents
  } else if (rand < 0.8) {
    // Medium purchases $50-$500  
    return randomInt(5000, 50000);
  } else if (rand < 0.95) {
    // Large purchases $500-$2000
    return randomInt(50000, 200000);
  } else {
    // Very large purchases $2000-$10000
    return randomInt(200000, 1000000);
  }
}

function randomTimestamp() {
  // Generate timestamps over the last 2 years
  const now = new Date();
  const twoYearsAgo = new Date(now.getTime() - (2 * 365 * 24 * 60 * 60 * 1000));
  const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
  return new Date(randomTime).toISOString();
}

function generateTransaction(id) {
  const customerId = randomChoice(CUSTOMER_IDS);
  const cardIndex = CUSTOMER_IDS.indexOf(customerId);
  const cardId = CARD_IDS[cardIndex];
  
  return {
    id: `txn_${String(id).padStart(12, '0')}`,
    customerId: customerId,
    cardId: cardId,
    mcc: randomChoice(MCCS),
    merchant: randomChoice(MERCHANTS),
    amountCents: randomAmount(),
    currency: 'USD',
    ts: randomTimestamp(),
    deviceId: randomChoice(DEVICE_IDS),
    country: randomChoice(COUNTRIES),
    city: randomChoice(US_CITIES)
  };
}

async function generateTransactions(totalCount) {
  const outputFile = path.join(__dirname, `transactions_${totalCount}.json`);
  const tempFile = outputFile + '.tmp';
  
  console.log(`🚀 Generating ${totalCount.toLocaleString()} transactions...`);
  console.log(`📁 Output file: ${outputFile}`);
  
  const startTime = Date.now();
  
  // Start JSON array
  fs.writeFileSync(tempFile, '[\n');
  
  for (let batch = 0; batch < Math.ceil(totalCount / BATCH_SIZE); batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalCount);
    const batchSize = batchEnd - batchStart;
    
    console.log(`📦 Processing batch ${batch + 1}: transactions ${batchStart + 1}-${batchEnd}`);
    
    const transactions = [];
    for (let i = batchStart; i < batchEnd; i++) {
      transactions.push(generateTransaction(i + 1));
    }
    
    // Write batch to file
    const jsonData = transactions.map(t => JSON.stringify(t, null, 2)).join(',\n');
    const isLastBatch = batchEnd === totalCount;
    const suffix = isLastBatch ? '\n' : ',\n';
    
    fs.appendFileSync(tempFile, jsonData + suffix);
    
    // Progress update
    const progress = ((batchEnd / totalCount) * 100).toFixed(1);
    console.log(`✅ Batch ${batch + 1} complete (${progress}%)`);
  }
  
  // Close JSON array
  fs.appendFileSync(tempFile, ']');
  
  // Move temp file to final location
  fs.renameSync(tempFile, outputFile);
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const fileStats = fs.statSync(outputFile);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`\n🎉 Generation complete!`);
  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Records: ${totalCount.toLocaleString()}`);
  console.log(`💾 File size: ${fileSizeMB} MB`);
  console.log(`📁 Location: ${outputFile}`);
  
  // Generate sample for quick verification
  const sampleFile = path.join(__dirname, 'transactions_sample.json');
  const sampleData = JSON.parse(fs.readFileSync(outputFile, 'utf8')).slice(0, 10);
  fs.writeFileSync(sampleFile, JSON.stringify(sampleData, null, 2));
  console.log(`🔍 Sample (first 10 records): ${sampleFile}`);
}

// Main execution
const count = parseInt(process.argv[2]) || DEFAULT_COUNT;

if (count < 1000) {
  console.error('❌ Minimum count is 1000 transactions');
  process.exit(1);
}

if (count > 10000000) {
  console.error('❌ Maximum count is 10M transactions (memory/disk constraints)');
  process.exit(1);
}

console.log(`📋 Transaction Generator`);
console.log(`🎯 Target: ${count.toLocaleString()} transactions`);
console.log(`⚡ Batch size: ${BATCH_SIZE.toLocaleString()}\n`);

generateTransactions(count)
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Generation failed:', error);
    process.exit(1);
  });