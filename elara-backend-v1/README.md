# Elara Backend v1

Enterprise-grade NestJS authentication system with MongoDB, JWT, and OAuth (Google & Apple).

## Features

- **Email/Password Authentication** with Argon2id hashing
- **JWT Authentication** with refresh token rotation
- **OAuth Integration** (Google & Apple Sign-In)
- **Email Verification** with secure tokens
- **Password Reset** with time-limited tokens
- **Account Linking** - Link multiple OAuth providers to one account
- **Global JWT Guard** - Routes protected by default, use `@Public()` decorator to skip
- **Role-Based Access Control** ready
- **MongoDB** with Mongoose ODM
- **TypeScript** with strict typing
- **Security Best Practices** (HttpOnly cookies, CORS, validation)

## Tech Stack

- NestJS 11.x
- MongoDB with Mongoose
- Passport (JWT, Local, Google OAuth20, Apple)
- Argon2 for password hashing
- class-validator for DTO validation
- cookie-parser for HttpOnly cookies
- Helmet for security headers
- Pino for structured logging
- Throttler for rate limiting
- express-mongo-sanitize for NoSQL injection protection

## Getting Started

### 1. Prerequisites

- Node.js 18+ and pnpm
- MongoDB instance (local or cloud)
- Google OAuth credentials (optional)
- Apple Sign-In credentials (optional)

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update the following required variables:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/elara

# JWT Secrets (IMPORTANT: Change these!)
JWT_ACCESS_SECRET=your-super-secret-access-token-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-token-min-32-chars
```

For OAuth (optional):

**Google OAuth:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable Google+ API
3. Create OAuth 2.0 credentials
4. Add authorized redirect URI: `http://localhost:5000/api/v1/auth/google/callback`
5. Copy Client ID and Secret to `.env`

**Apple Sign-In:**
1. Go to [Apple Developer](https://developer.apple.com/)
2. Create an App ID and Service ID
3. Generate a private key (.p8 file)
4. Save the key file and add its path to `.env`

### 4. Run the Application

```bash
# Development
pnpm run start:dev

# Production
pnpm run build
pnpm run start:prod
```

The API will be available at: `http://localhost:5000/api/v1`

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user | No |
| POST | `/auth/login` | Login with email/password | No |
| POST | `/auth/refresh` | Refresh access token | No |
| POST | `/auth/logout` | Logout user | Yes |
| GET | `/auth/verify-email?token=xxx` | Verify email | No |
| POST | `/auth/forgot-password` | Request password reset | No |
| POST | `/auth/reset-password` | Reset password | No |
| GET | `/auth/me` | Get current user | Yes |

### OAuth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google` | Initiate Google OAuth |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/apple` | Initiate Apple Sign-In |
| POST | `/auth/apple/callback` | Apple callback |
| DELETE | `/auth/oauth/:provider` | Unlink OAuth provider |

## Usage Examples

### Register User

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

### Login

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Access Protected Route

```bash
curl http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Making State-Changing Requests (CSRF Protection)

For POST, PUT, PATCH, DELETE requests, you need to include a CSRF token:

1. **Get CSRF Token:** The token is automatically set in the `XSRF-TOKEN` cookie on GET requests
2. **Include in Header:** Send the token in the `x-csrf-token` header

```bash
# Example: Update user profile
curl -X PUT http://localhost:5000/api/v1/user/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "x-csrf-token: YOUR_CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -b "XSRF-TOKEN=YOUR_CSRF_TOKEN" \
  -d '{"firstName": "Jane"}'
```

**Note:** Public routes (login, register, etc.) are exempt from CSRF protection.

## Architecture

```
src/
├── config/                  # Configuration files
│   ├── database.config.ts
│   ├── jwt.config.ts
│   ├── oauth.config.ts
│   └── mail.config.ts
├── modules/
│   ├── auth/
│   │   ├── domain/         # Schemas, enums
│   │   ├── application/    # Services, DTOs, interfaces
│   │   ├── infrastructure/ # Repositories, strategies, guards
│   │   └── presentation/   # Controllers
│   └── user/
│       └── domain/         # User schema
└── shared/
    ├── constants/          # DI tokens
    ├── filters/            # Exception filters
    ├── middleware/         # CSRF, request ID middleware
    ├── services/           # Shared services (email, encryption)
    └── health/             # Health check endpoints
```

## Security Features

- **Password Hashing:** Argon2id with 64MB memory cost
- **JWT Tokens:** Separate access (15min) and refresh (7 days) tokens
- **Token Rotation:** Refresh tokens are rotated on use
- **HttpOnly Cookies:** Refresh tokens stored securely
- **Email Verification:** Required before account activation (optional)
- **Password Reset:** Time-limited tokens (1 hour)
- **OAuth Account Linking:** Multiple providers per account
- **Global Authentication:** All routes protected by default
- **Input Validation:** class-validator with whitelist
- **CORS:** Configured for frontend origin
- **CSRF Protection:** Double-submit cookie pattern for state-changing requests
- **Rate Limiting:** Throttler guard (10 requests/minute default, configurable per route)
- **Security Headers:** Helmet.js with Content Security Policy
- **NoSQL Injection Protection:** express-mongo-sanitize
- **Request ID Tracking:** Unique request IDs for logging and tracing

## Development

### Project Structure

Following Domain-Driven Design (DDD) principles:

- **Domain Layer:** Schemas, entities, enums
- **Application Layer:** Business logic, services, DTOs
- **Infrastructure Layer:** External concerns (DB, OAuth, guards)
- **Presentation Layer:** Controllers, HTTP handling

### Adding a Protected Route

Since JWT authentication is global, routes are protected by default. Just use the `@CurrentUser()` decorator:

```typescript
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './modules/auth/application/decorators/current-user.decorator';
import { User } from './modules/user/domain/schemas/user.schema';

@Controller('example')
export class ExampleController {
  @Get()
  getProtectedData(@CurrentUser() user: User) {
    return { message: `Hello ${user.firstName}!` };
  }
}
```

### Making a Route Public

```typescript
import { Public } from './modules/auth/application/decorators/public.decorator';

@Public()
@Get('public')
getPublicData() {
  return { message: 'This route is public' };
}
```

### Role-Based Access Control

Since both JWT and Roles guards are global, you only need to use the `@Roles()` decorator:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Roles } from './modules/auth/application/decorators/roles.decorator';

@Controller('admin')
export class AdminController {
  @Roles('admin')
  @Get('only')
  getAdminData() {
    return { message: 'Admin only' };
  }
}
```

## Testing

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Test coverage
pnpm run test:cov
```

## License

MIT
