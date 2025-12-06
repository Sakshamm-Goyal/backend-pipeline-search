# Elara Fashion AI Pipeline - Quick Reference

**Version**: 1.0.0-beta+auth+tests
**Last Updated**: November 30, 2025

---

## 🚀 Quick Start (30 seconds)

```bash
npm install && npm test && npm run start:dev
```

Then open: http://localhost:3000/api/docs

---

## 📋 Essential Commands

### Development

```bash
# Start development server
npm run start:dev

# Start with watch mode (auto-reload)
npm run start:dev

# Build for production
npm run build

# Start production server
npm run start:prod
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- intent-router.service.spec

# Run tests in watch mode
npm test -- --watch

# Run E2E tests
npm run test:e2e
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run build

# View test coverage report
npm test -- --coverage && open coverage/lcov-report/index.html
```

---

## 🔧 Common Tasks

### 1. Test the Health Endpoint

```bash
curl http://localhost:3000/api/v1/chat/health
```

### 2. Login and Get Token

```bash
# Register new user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "firstName": "Test",
    "lastName": "User"
  }'

# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }' | jq -r '.accessToken')

echo $TOKEN
```

### 3. Send Chat Message

```bash
curl -X POST http://localhost:3000/api/v1/chat/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "I need a dress for a wedding",
    "userContext": {
      "gender": "female",
      "style": "elegant"
    }
  }'
```

### 4. Create Conversation

```bash
curl -X POST http://localhost:3000/api/v1/chat/conversations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId": "user123"
  }'
```

---

## 🐳 Docker Commands

### Build Image

```bash
docker build -t elara-api:latest .
```

### Run Container

```bash
docker run -d \
  --name elara-api \
  -p 3000:3000 \
  --env-file .env.production \
  elara-api:latest
```

### View Logs

```bash
docker logs -f elara-api
```

### Stop Container

```bash
docker stop elara-api
docker rm elara-api
```

---

## 📊 Monitoring

### Check Application Status

```bash
# Health check
curl http://localhost:3000/api/v1/chat/health

# View logs
tail -f logs/app.log

# Check Redis
redis-cli ping

# Check MongoDB
mongosh --eval "db.adminCommand('ping')"
```

### Performance Check

```bash
# Test response time
time curl -s http://localhost:3000/api/v1/chat/health > /dev/null

# Load test (with autocannon)
npx autocannon -c 10 -d 30 http://localhost:3000/api/v1/chat/health
```

---

## 🔍 Debugging

### View Application Logs

```bash
# Development (console)
npm run start:dev

# Production (file)
tail -f logs/combined.log
tail -f logs/error.log
```

### Debug Tests

```bash
# Run single test with debugging
npm test -- --runInBand --detectOpenHandles intent-router.service.spec

# Debug with Node inspector
node --inspect-brk ./node_modules/.bin/jest intent-router.service.spec
```

### Check Environment

```bash
# Verify .env file
cat .env | grep -v "^#" | grep -v "^$"

# Check Node version
node --version  # Should be 18+

# Check npm version
npm --version

# Check Redis connection
redis-cli ping  # Should return PONG
```

---

## 🗄️ Database Commands

### MongoDB (Existing Auth)

```bash
# Connect
mongosh mongodb://localhost:27017/elara

# Check users
db.users.countDocuments()

# View sample user
db.users.findOne()
```

### Redis (Cache)

```bash
# Connect
redis-cli

# Check keys
KEYS search:*

# Get cache stats
INFO stats

# Clear cache
FLUSHDB
```

---

## 📦 Dependency Management

### Install Dependencies

```bash
# Install all
npm install

# Install specific package
npm install <package-name>

# Install dev dependency
npm install --save-dev <package-name>

# Update dependencies
npm update

# Check for outdated
npm outdated
```

### Verify Installation

```bash
# Check installed packages
npm list --depth=0

# Check specific package
npm list <package-name>

# Verify critical packages
npm list @nestjs/common @anthropic-ai/sdk ioredis opossum
```

---

## 🧪 Testing Shortcuts

### Run Specific Test Suites

```bash
# Intent Router
npm test -- intent-router.service.spec

# Search Agent
npm test -- search-agent.service.spec

# Outfit Generator
npm test -- outfit-generator-agent.service.spec

# Chat Orchestrator
npm test -- chat-orchestrator.service.spec

# Chat Controller
npm test -- chat.controller.spec

# E2E
npm run test:e2e
```

### Test with Different Options

```bash
# Silent mode
npm test -- --silent

# Verbose mode
npm test -- --verbose

# Show coverage
npm test -- --coverage

# Update snapshots
npm test -- -u

# Run in CI mode
npm test -- --ci
```

---

## 🔐 Security

### Generate JWT Secrets

```bash
# Generate strong secret (64 chars)
openssl rand -base64 64

# Or use Node
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

### Check for Vulnerabilities

```bash
# Audit dependencies
npm audit

# Fix vulnerabilities
npm audit fix

# Force fix (may break)
npm audit fix --force
```

---

## 📚 Documentation

### Generate API Docs

```bash
# Start server
npm run start:dev

# View Swagger docs
open http://localhost:3000/api/docs
```

### View Test Coverage

```bash
# Generate coverage report
npm test -- --coverage

# Open HTML report
open coverage/lcov-report/index.html
```

---

## 🌐 Environment Configuration

### Development (.env)

```env
NODE_ENV=development
PORT=3000

ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

REDIS_HOST=localhost
REDIS_PORT=6379

MONGODB_URI=mongodb://localhost:27017/elara
```

### Production (.env.production)

```env
NODE_ENV=production
PORT=3000

ANTHROPIC_API_KEY=sk-ant-prod-...
GEMINI_API_KEY=prod-...

REDIS_URL=redis://prod-redis:6379
REDIS_PASSWORD=...

MONGODB_URI=mongodb+srv://prod-user:pass@cluster/elara
```

---

## 🚨 Common Issues

### Port Already in Use

```bash
# Find process on port 3000
lsof -ti:3000

# Kill process
kill -9 $(lsof -ti:3000)

# Or use different port
PORT=3001 npm run start:dev
```

### Redis Connection Failed

```bash
# Start Redis
# macOS
brew services start redis

# Linux
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### Tests Failing

```bash
# Clear Jest cache
npm test -- --clearCache

# Reinstall node_modules
rm -rf node_modules package-lock.json
npm install

# Run tests in sequence (not parallel)
npm test -- --runInBand
```

### Build Errors

```bash
# Clean build
rm -rf dist
npm run build

# Check TypeScript
npx tsc --noEmit

# Fix linting
npm run lint -- --fix
```

---

## 🎯 Useful Aliases (Add to ~/.bashrc or ~/.zshrc)

```bash
# Elara shortcuts
alias elara-start='cd ~/path/to/elara && npm run start:dev'
alias elara-test='cd ~/path/to/elara && npm test'
alias elara-logs='cd ~/path/to/elara && tail -f logs/combined.log'
alias elara-health='curl -s http://localhost:3000/api/v1/chat/health | jq'

# Git shortcuts for Elara
alias elara-status='cd ~/path/to/elara && git status'
alias elara-pull='cd ~/path/to/elara && git pull'
alias elara-push='cd ~/path/to/elara && git add . && git commit -m "Update" && git push'
```

---

## 📞 Help & Support

### Getting Help

```bash
# View all npm scripts
npm run

# View help for specific command
npm test -- --help

# Check NestJS CLI
nest --help
```

### Documentation Links

- **Main README**: [README.md](README.md)
- **Implementation Status**: [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md)
- **All Docs**: [docs/README.md](docs/README.md)
- **Build Guide**: [docs/BUILD_VERIFICATION.md](docs/BUILD_VERIFICATION.md)
- **API Docs**: http://localhost:3000/api/docs (when running)

### Quick Links

```bash
# Open documentation
open docs/README.md

# Open Swagger docs (requires server running)
open http://localhost:3000/api/docs

# View latest phase docs
open docs/PHASE_5_AUTH_AND_TESTING.md
```

---

## 🎉 Cheat Sheet

### Most Used Commands

```bash
npm run start:dev          # Start development server
npm test                   # Run all tests
npm test -- --coverage     # Run tests with coverage
npm run build              # Build for production
curl localhost:3000/api/v1/chat/health  # Health check
```

### Quick Test Flow

```bash
# 1. Install
npm install

# 2. Test
npm test

# 3. Start
npm run start:dev

# 4. Verify
curl http://localhost:3000/api/v1/chat/health
```

### Quick Deploy Flow

```bash
# 1. Build
npm run build

# 2. Test build
NODE_ENV=production node dist/main

# 3. Docker build
docker build -t elara-api .

# 4. Docker run
docker run -p 3000:3000 --env-file .env.production elara-api
```

---

**Need more details?** Check [docs/README.md](docs/README.md) for complete documentation index.

**Quick start?** Run `npm install && npm test && npm run start:dev`

**Issues?** See [docs/BUILD_VERIFICATION.md](docs/BUILD_VERIFICATION.md) § Troubleshooting

---

**Last Updated**: November 30, 2025
**Version**: 1.0.0-beta+auth+tests
**Status**: Ready for Phase 6 (Database Integration)

