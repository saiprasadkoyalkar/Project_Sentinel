# Troubleshooting Guide

## Quick Diagnosis Commands

```bash
# System health check
npm run health

# Check all containers
docker-compose ps

# View logs
docker-compose logs api
docker-compose logs web
docker-compose logs postgres
docker-compose logs redis

# Database connection test
npm run db:check

# Reset everything
npm run clean:all
```

## Common Issues

### 1. **Database Connection Errors**

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**
```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Restart database
docker-compose restart postgres

# Check database logs
docker-compose logs postgres

# Verify connection string
echo $DATABASE_URL

# Test connection manually
psql $DATABASE_URL -c "SELECT 1"
```

**Root Causes:**
- Database container not started
- Wrong DATABASE_URL in .env
- Network connectivity issues
- Database still starting up (wait 30s)

### 2. **Redis Connection Failed**

**Symptoms:**
```
Error: Redis connection failed
Rate limiting disabled
```

**Solutions:**
```bash
# Check Redis status
docker-compose ps redis

# Restart Redis
docker-compose restart redis

# Test Redis connection
redis-cli -h localhost -p 6379 ping

# Check Redis logs
docker-compose logs redis
```

**Root Causes:**
- Redis container down
- Port 6379 already in use
- Network configuration issues

### 3. **API Build Failures**

**Symptoms:**
```
Error: Cannot find module './types'
TypeScript compilation failed
```

**Solutions:**
```bash
# Clean and rebuild
cd api
rm -rf node_modules dist
npm install
npm run build

# Check TypeScript version
npm list typescript

# Verify all imports
npm run type-check
```

**Root Causes:**
- Missing dependencies
- TypeScript version mismatch
- Circular import dependencies
- Wrong import paths

### 4. **Frontend Build Issues**

**Symptoms:**
```
Error: Failed to resolve import
Vite build failed
```

**Solutions:**
```bash
# Clean Vite cache
cd web
rm -rf node_modules/.vite dist
npm install
npm run build

# Check for unused imports
npm run lint

# Verify environment variables
cat .env.local
```

**Root Causes:**
- Vite cache corruption
- Missing environment variables
- Import path errors
- Dependency conflicts

### 5. **Agent Timeout Issues**

**Symptoms:**
```
Agent timeout after 2000ms
Circuit breaker opened for fraud-agent
```

**Solutions:**
```bash
# Check system resources
htop
df -h

# Increase timeout in config
# Edit api/src/agents/orchestrator.ts
# Change AGENT_TIMEOUT_MS = 5000

# Restart API
docker-compose restart api
```

**Root Causes:**
- High CPU/memory usage
- Database queries too slow
- External service delays
- Need to tune timeout values

### 6. **Memory Issues**

**Symptoms:**
```
JavaScript heap out of memory
Process killed by system
```

**Solutions:**
```bash
# Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=4096"

# Check memory usage
docker stats

# Optimize queries
# Review large result sets
# Add pagination limits
```

**Root Causes:**
- Large dataset processing
- Memory leaks in code
- Insufficient container limits
- Missing pagination

### 7. **Permission Denied Errors**

**Symptoms:**
```
Error: EACCES: permission denied
Docker: permission denied
```

**Solutions:**
```bash
# Fix file permissions
sudo chown -R $USER:$USER .

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Windows: Run as Administrator
# Or use Docker Desktop
```

**Root Causes:**
- Wrong file ownership
- Docker permissions
- Windows path issues
- SELinux/AppArmor blocking

### 8. **Port Already in Use**

**Symptoms:**
```
Error: listen EADDRINUSE :::3000
Port 3000 is already in use
```

**Solutions:**
```bash
# Find process using port
lsof -i :3000
netstat -tulpn | grep 3000

# Kill process
kill -9 <PID>

# Use different port
export PORT=3001
```

**Root Causes:**
- Previous instance not killed
- Other application using port
- Development server still running

### 9. **SSL/TLS Certificate Issues**

**Symptoms:**
```
Error: self signed certificate
HTTPS required but certificate invalid
```

**Solutions:**
```bash
# Development: Disable SSL check
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Production: Install proper certificates
# Update nginx.conf with cert paths
# Restart nginx container
```

**Root Causes:**
- Self-signed certificates
- Expired certificates
- Wrong certificate configuration

### 10. **Database Migration Failures**

**Symptoms:**
```
Prisma migrate failed
Database schema out of sync
```

**Solutions:**
```bash
# Reset database (development only)
npm run db:reset

# Check migration status
npx prisma migrate status

# Manual migration
npx prisma db push

# Generate new migration
npx prisma migrate dev --name fix_schema
```

**Root Causes:**
- Schema conflicts
- Missing migrations
- Database version mismatch
- Manual schema changes

## Performance Issues

### Slow Database Queries

**Diagnosis:**
```sql
-- Enable query logging in PostgreSQL
-- Add to docker-compose.yml postgres command:
-- -c log_statement=all -c log_duration=on

-- Check slow queries
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

**Solutions:**
- Add missing indexes
- Optimize WHERE clauses
- Use EXPLAIN ANALYZE
- Consider query caching

### High Memory Usage

**Diagnosis:**
```bash
# Check Node.js heap usage
curl http://localhost:3000/health

# Monitor container memory
docker stats --no-stream

# Profile memory usage
node --inspect api/dist/index.js
```

**Solutions:**
- Implement streaming for large datasets
- Add memory limits to containers
- Optimize object creation
- Use pagination consistently

### High CPU Usage

**Diagnosis:**
```bash
# Profile CPU usage
perf top -p $(pgrep node)

# Check event loop lag
curl http://localhost:3000/health

# Monitor system load
iostat -x 1
```

**Solutions:**
- Optimize hot code paths
- Use worker threads for CPU-intensive tasks
- Implement request queuing
- Scale horizontally

## Security Issues

### Authentication Failures

**Symptoms:**
```
401 Unauthorized
Invalid API key
```

**Solutions:**
```bash
# Check API key configuration
echo $API_KEY

# Verify authentication middleware
curl -H "Authorization: Bearer $API_KEY" \
     http://localhost:3000/api/v1/health

# Reset API key if compromised
openssl rand -hex 32
```

### Rate Limiting Triggered

**Symptoms:**
```
429 Too Many Requests
Rate limit exceeded
```

**Solutions:**
```bash
# Check rate limit status
redis-cli get "rate_limit:192.168.1.1"

# Adjust rate limits if legitimate traffic
# Edit api/src/middleware/rate-limit.ts

# Whitelist IP addresses if needed
```

### PII Leakage Detection

**Symptoms:**
```
PII found in logs
Compliance violation detected
```

**Solutions:**
```bash
# Search for PII in logs
grep -r "4[0-9]{15}" logs/
grep -r "@.*\.com" logs/

# Update PII redaction patterns
# Edit api/src/utils/pii-redaction.ts

# Rotate logs immediately
rm -f logs/*.log
```

## Monitoring and Alerting

### Health Check Endpoints

```bash
# Overall system health
curl http://localhost:3000/health

# Database connectivity
curl http://localhost:3000/health/db

# Redis connectivity  
curl http://localhost:3000/health/redis

# Agent status
curl http://localhost:3000/health/agents
```

### Key Metrics to Monitor

- **Response Time**: P95 < 100ms for customer queries
- **Error Rate**: < 0.1% for all endpoints
- **Memory Usage**: < 80% of container limit
- **Database Connections**: < 80% of pool size
- **Agent Success Rate**: > 99.5% for critical agents

### Setting Up Alerts

```bash
# CPU usage > 80%
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert": "high_cpu", "threshold": 80}'

# Memory usage > 85%
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert": "high_memory", "threshold": 85}'

# Error rate > 1%
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert": "high_errors", "threshold": 1}'
```

## Recovery Procedures

### Database Recovery

```bash
# Create backup
pg_dump $DATABASE_URL > backup.sql

# Restore from backup
psql $DATABASE_URL < backup.sql

# Point-in-time recovery
# Requires WAL archiving setup
```

### System Recovery

```bash
# Complete system restart
docker-compose down
docker-compose up -d

# Rebuild everything
npm run clean:all
npm run build:all
npm run start:all

# Verify recovery
npm run test:integration
```

### Data Corruption Recovery

```bash
# Check database integrity
npx prisma db pull

# Repair schema if needed
npx prisma migrate reset
npm run db:seed

# Verify data integrity
npm run test:data-integrity
```

## Getting Help

1. **Check this troubleshooting guide first**
2. **Review logs for error messages**
3. **Search GitHub issues**
4. **Check system resources (CPU, memory, disk)**
5. **Verify environment configuration**

For persistent issues:
- Collect system information: `npm run debug:info`
- Export logs: `docker-compose logs > debug.log`
- Document reproduction steps
- Include error messages and stack traces