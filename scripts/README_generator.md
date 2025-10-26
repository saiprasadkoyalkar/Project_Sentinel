# Transaction Data Generator

This script generates large transaction datasets for testing and development.

## Usage

### Generate 200k transactions (minimum requirement):
```bash
cd scripts
node generate-transactions.js 200000
```

### Generate 1M transactions (extended testing):
```bash
cd scripts  
node generate-transactions.js 1000000
```

### Generate custom amount:
```bash
cd scripts
node generate-transactions.js [number]
```

## Output

- **Main file**: `transactions_[count].json` - Full dataset
- **Sample file**: `transactions_sample.json` - First 10 records for verification

## Performance

- **200k transactions**: ~30-60 seconds, ~50-80MB file
- **1M transactions**: ~3-5 minutes, ~250-400MB file  
- **Memory efficient**: Uses batching to handle large datasets

## Data Quality

Each transaction includes:
- Unique sequential ID
- Customer/Card mapping
- Realistic merchant names and MCCs
- Varied amount distributions  
- 2-year timestamp range
- Geographic diversity
- Device tracking

## Integration

Update your seed script to use the generated data:

```typescript
// In seed.ts
const transactions = JSON.parse(
  fs.readFileSync(path.join(fixturesPath, 'transactions_200000.json'), 'utf-8')
);
```