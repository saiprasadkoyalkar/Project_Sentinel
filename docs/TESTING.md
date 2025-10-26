# Testing Strategy

## Overview

The Sentinel Support system implements a comprehensive testing strategy covering unit tests, integration tests, end-to-end tests, and load testing to ensure reliability at scale.

## Test Pyramid

```
                    🔺 E2E Tests (5%)
                   Selenium, Playwright
               🔺🔺 Integration Tests (25%)
              API tests, Database tests
         🔺🔺🔺🔺 Unit Tests (70%)
        Functions, Components, Services
```

## Testing Stack

- **Unit**: Jest + Testing Library
- **Integration**: Supertest + Test Containers
- **E2E**: Playwright
- **Load**: Artillery.js
- **Security**: OWASP ZAP
- **Performance**: Lighthouse CI

## Test Categories

### 1. Unit Tests (70% coverage target)

**Location**: `*/src/**/*.test.ts`

**Scope**:
- Pure functions and utilities
- React components in isolation
- Agent logic without external dependencies
- Business rules and validation

**Example Structure**:
```typescript
// api/src/agents/fraud-agent.test.ts
describe('FraudAgent', () => {
  describe('analyzeVelocity', () => {
    it('should flag high transaction velocity', () => {
      const transactions = createMockTransactions(10, '5m');
      const result = analyzeVelocity(transactions);
      expect(result.riskLevel).toBe('HIGH');
      expect(result.reason).toContain('velocity');
    });
  });
});
```

**Key Testing Patterns**:
- Arrange-Act-Assert pattern
- Mock external dependencies
- Test edge cases and error conditions
- Parameterized tests for business rules

### 2. Integration Tests (25% coverage target)

**Location**: `*/src/**/*.integration.test.ts`

**Scope**:
- API endpoints with real database
- Multi-agent workflows
- Database queries and migrations
- External service integrations

**Test Database Setup**:
```typescript
// Use test containers for isolated testing
beforeAll(async () => {
  testDb = await new PostgreSqlContainer()
    .withDatabase('sentinel_test')
    .withUsername('test')
    .withPassword('test')
    .start();
});
```

**Example Test**:
```typescript
describe('POST /api/v1/triage', () => {
  it('should run complete triage workflow', async () => {
    // Arrange
    const customer = await createTestCustomer();
    const transactions = await createTestTransactions(customer.id);
    
    // Act
    const response = await request(app)
      .post('/api/v1/triage')
      .send({ customerId: customer.id })
      .expect(200);
    
    // Assert
    expect(response.body.runId).toBeDefined();
    expect(response.body.status).toBe('running');
    
    // Wait for completion
    await waitForTriageCompletion(response.body.runId);
    
    // Verify results
    const triageRun = await prisma.triageRun.findUnique({
      where: { id: response.body.runId },
      include: { agentTraces: true }
    });
    
    expect(triageRun.status).toBe('completed');
    expect(triageRun.agentTraces).toHaveLength(5);
  });
});
```

### 3. End-to-End Tests (5% coverage target)

**Location**: `e2e/**/*.spec.ts`

**Scope**:
- Critical user workflows
- Cross-browser compatibility
- Performance under load
- Error recovery scenarios

**Example E2E Test**:
```typescript
// e2e/triage-workflow.spec.ts
test('support agent can complete full triage', async ({ page }) => {
  // Login
  await page.goto('/login');
  await page.fill('[data-testid=username]', 'agent1');
  await page.fill('[data-testid=password]', 'password');
  await page.click('[data-testid=login-btn]');
  
  // Navigate to customer
  await page.goto('/customers/cust_001');
  await expect(page.locator('[data-testid=customer-name]')).toContainText('John Doe');
  
  // Start triage
  await page.click('[data-testid=start-triage-btn]');
  
  // Wait for triage completion
  await expect(page.locator('[data-testid=triage-status]')).toContainText('completed', { timeout: 10000 });
  
  // Verify recommendations
  await expect(page.locator('[data-testid=recommendations]')).toBeVisible();
  
  // Execute recommended action
  await page.click('[data-testid=execute-freeze-card]');
  await page.fill('[data-testid=otp-code]', '123456');
  await page.click('[data-testid=confirm-action]');
  
  // Verify action completed
  await expect(page.locator('[data-testid=action-status]')).toContainText('Card frozen successfully');
});
```

## Test Data Management

### Fixtures

**Location**: `fixtures/`

**Categories**:
- Customers: 5 personas covering different risk profiles
- Transactions: Normal, suspicious, and fraudulent patterns
- Cards: Various states (active, frozen, expired)
- Knowledge Base: Common support scenarios
- Policies: Business rules and compliance requirements

### Test Database Seeding

```typescript
// scripts/seed-test-data.ts
export async function seedTestData() {
  // Clear existing data
  await prisma.transaction.deleteMany();
  await prisma.customer.deleteMany();
  
  // Load fixtures
  const customers = JSON.parse(await fs.readFile('fixtures/customers.json', 'utf8'));
  const transactions = JSON.parse(await fs.readFile('fixtures/transactions.json', 'utf8'));
  
  // Create test data with relationships
  for (const customerData of customers) {
    const customer = await prisma.customer.create({
      data: customerData,
      include: { accounts: true, cards: true }
    });
    
    // Create transactions for customer
    const customerTransactions = transactions.filter(t => t.customerId === customer.id);
    await prisma.transaction.createMany({
      data: customerTransactions
    });
  }
}
```

### Data Cleanup

```typescript
// Automatic cleanup after each test
afterEach(async () => {
  await prisma.triageRun.deleteMany();
  await prisma.agentTrace.deleteMany();
  await prisma.case.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

## Performance Testing

### Load Testing with Artillery

**Configuration**: `load-tests/config.yml`
```yaml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10
    - duration: 120
      arrivalRate: 50
    - duration: 60
      arrivalRate: 100
  processor: './scenarios.js'

scenarios:
  - name: 'Customer lookup'
    weight: 40
    flow:
      - get:
          url: '/api/v1/customers/{{ customerId }}'
          headers:
            Authorization: 'Bearer {{ apiKey }}'
  
  - name: 'Triage workflow'
    weight: 30
    flow:
      - post:
          url: '/api/v1/triage'
          headers:
            Authorization: 'Bearer {{ apiKey }}'
          json:
            customerId: '{{ customerId }}'
      - think: 5
      - get:
          url: '/api/v1/triage/{{ runId }}'
```

**Performance Targets**:
- **Throughput**: 1000 RPS for read operations
- **Latency**: P95 < 100ms for customer queries
- **Concurrent Users**: 500 simultaneous users
- **Triage Completion**: < 5 seconds end-to-end

### Memory and CPU Profiling

```bash
# CPU profiling during load test
node --prof api/dist/index.js &
npm run load-test:heavy
node --prof-process isolate-*.log > cpu-profile.txt

# Memory profiling
node --inspect api/dist/index.js &
# Connect Chrome DevTools and record heap snapshots
```

## Security Testing

### OWASP ZAP Automated Scanning

```bash
# Start ZAP daemon
zap.sh -daemon -port 8080 -config api.disablekey=true

# Run baseline scan
zap-baseline.py -t http://localhost:3000 -J zap-report.json

# Run full scan
zap-full-scan.py -t http://localhost:3000 -J zap-full-report.json
```

### Security Test Cases

1. **Authentication Bypass**
2. **SQL Injection** (via Prisma)
3. **XSS Prevention** (CSP headers)
4. **CSRF Protection** (SameSite cookies)
5. **Rate Limiting** (brute force protection)
6. **PII Leakage** (log scanning)

### Compliance Testing

```typescript
describe('PCI DSS Compliance', () => {
  it('should redact PAN in all logs', async () => {
    const logs = await fs.readFile('logs/app.log', 'utf8');
    const panPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
    expect(logs).not.toMatch(panPattern);
  });
  
  it('should encrypt card data at rest', async () => {
    const card = await prisma.card.findFirst();
    expect(card.pan).toMatch(/^\$2[aby]\$\d+\$/); // bcrypt pattern
  });
});
```

## Test Automation

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:coverage
      
  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:integration
      
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build
      - run: docker-compose up -d
      - run: npm run test:e2e
      - run: docker-compose down
```

### Test Coverage Requirements

- **Unit Tests**: 70% minimum, 85% target
- **Integration Tests**: Critical paths covered
- **E2E Tests**: Happy path + error scenarios
- **Performance Tests**: All API endpoints under load

### Coverage Reporting

```bash
# Generate coverage report
npm run test:coverage

# Upload to Codecov
bash <(curl -s https://codecov.io/bash)

# View HTML report
open coverage/lcov-report/index.html
```

## Testing Best Practices

### 1. Test Organization

```
tests/
├── unit/
│   ├── agents/
│   ├── utils/
│   └── components/
├── integration/
│   ├── api/
│   ├── database/
│   └── workflows/
├── e2e/
│   ├── scenarios/
│   └── pages/
└── load/
    ├── configs/
    └── scenarios/
```

### 2. Test Naming Convention

```typescript
// Good: Descriptive test names
describe('FraudAgent.analyzeVelocity', () => {
  it('should flag transactions exceeding 10 per hour as high risk', () => {});
  it('should ignore transactions older than 24 hours', () => {});
  it('should handle empty transaction history gracefully', () => {});
});

// Bad: Vague test names
describe('FraudAgent', () => {
  it('should work', () => {});
  it('should pass', () => {});
});
```

### 3. Test Data Builders

```typescript
// Use builder pattern for test data
class CustomerBuilder {
  private customer: Partial<Customer> = {};
  
  withId(id: string) {
    this.customer.id = id;
    return this;
  }
  
  withHighRiskProfile() {
    this.customer.riskLevel = 'HIGH';
    this.customer.suspiciousActivity = true;
    return this;
  }
  
  build(): Customer {
    return {
      id: 'cust_test',
      email: 'test@example.com',
      phone: '+1234567890',
      riskLevel: 'LOW',
      ...this.customer
    };
  }
}

// Usage
const highRiskCustomer = new CustomerBuilder()
  .withId('cust_001')
  .withHighRiskProfile()
  .build();
```

### 4. Async Testing Patterns

```typescript
// Good: Proper async/await usage
it('should complete triage within timeout', async () => {
  const runId = await startTriage(customerId);
  
  const result = await waitFor(() => 
    getTriageStatus(runId),
    { timeout: 5000, interval: 100 }
  );
  
  expect(result.status).toBe('completed');
});

// Bad: Missing await
it('should complete triage', async () => {
  const runId = startTriage(customerId); // Missing await
  // Test will pass incorrectly
});
```

## Test Debugging

### VS Code Configuration

```json
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest Tests",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--testNamePattern=${input:testName}"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

### Test Isolation

```typescript
// Ensure test isolation
describe('Database operations', () => {
  beforeEach(async () => {
    // Start fresh transaction
    await prisma.$executeRaw`BEGIN`;
  });
  
  afterEach(async () => {
    // Rollback all changes
    await prisma.$executeRaw`ROLLBACK`;
  });
});
```

### Debugging Failed Tests

```bash
# Run specific test with debug output
npm test -- --testNamePattern="should flag high velocity" --verbose

# Run with debugger
node --inspect-brk node_modules/.bin/jest --runInBand

# Generate test report
npm test -- --reporters=default --reporters=jest-html-reporter
```

## Continuous Quality

### Quality Gates

1. **All tests must pass** before merge
2. **Coverage must not decrease** below current level
3. **Performance tests** must meet SLA requirements
4. **Security scans** must pass with no high-severity issues
5. **E2E tests** must pass in production-like environment

### Test Metrics

Track and monitor:
- Test execution time trends
- Flaky test identification
- Coverage trends by module
- Performance regression detection
- Security vulnerability trends

This comprehensive testing strategy ensures the Sentinel Support system maintains high quality, performance, and security standards throughout development and deployment.