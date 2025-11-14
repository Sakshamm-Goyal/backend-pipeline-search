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
4. Add authorized redirect URI: `http://localhost:3000/api/v1/auth/google/callback`
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

The API will be available at: `http://localhost:3000/api/v1`

## API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user | No |
| POST | `/auth/login` | Login with email/password | No |
| POST | `/auth/refresh` | Refresh access token | No |
| POST | `/auth/logout` | Logout user | No |
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
curl -X POST http://localhost:3000/api/v1/auth/register \
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
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Access Protected Route

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

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
    └── constants/          # DI tokens
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

## Development

### Project Structure

Following Domain-Driven Design (DDD) principles:

- **Domain Layer:** Schemas, entities, enums
- **Application Layer:** Business logic, services, DTOs
- **Infrastructure Layer:** External concerns (DB, OAuth, guards)
- **Presentation Layer:** Controllers, HTTP handling

### Adding a Protected Route

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './modules/auth/infrastructure/guards/jwt-auth.guard';
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

```typescript
import { Roles } from './modules/auth/application/decorators/roles.decorator';
import { RolesGuard } from './modules/auth/infrastructure/guards/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin-only')
getAdminData() {
  return { message: 'Admin only' };
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
