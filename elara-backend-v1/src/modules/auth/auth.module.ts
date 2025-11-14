import { Module, DynamicModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Config
import jwtConfig from '../../config/jwt.config';
import oauthConfig from '../../config/oauth.config';

// Schemas
import { User, UserSchema } from '../user/domain/schemas/user.schema';
import { RefreshToken, RefreshTokenSchema } from './domain/schemas/refresh-token.schema';

// Services
import { AuthService } from './application/services/auth.service';
import { PasswordService } from './application/services/password.service';
import { TokenService } from './application/services/token.service';
import { OAuthService } from './application/services/oauth.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { EmailService } from '../../shared/services/email.service';

// Repositories
import { UserRepository } from '../user/infrastructure/persistence/repositories/user.repository';
import { RefreshTokenRepository } from './infrastructure/persistence/repositories/refresh-token.repository';

// Strategies
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy';
import { LocalStrategy } from './infrastructure/strategies/local.strategy';
import { GoogleStrategy } from './infrastructure/strategies/google.strategy';
import { AppleStrategy } from './infrastructure/strategies/apple.strategy';

// Controllers
import { AuthController } from './presentation/controllers/auth.controller';

// Tokens
import {
  USER_REPOSITORY_TOKEN,
  REFRESH_TOKEN_REPOSITORY_TOKEN,
} from '../../shared/constants/tokens';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    ConfigModule.forFeature(oauthConfig),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // Configuration is done in strategies
  ],
  controllers: [AuthController],
  providers: [
    // Services
    AuthService,
    PasswordService,
    TokenService,
    OAuthService,
    EncryptionService,
    EmailService,

    // Repositories
    {
      provide: USER_REPOSITORY_TOKEN,
      useClass: UserRepository,
    },
    {
      provide: REFRESH_TOKEN_REPOSITORY_TOKEN,
      useClass: RefreshTokenRepository,
    },

    // Strategies
    JwtStrategy,
    LocalStrategy,
    GoogleStrategy,
    // Apple Strategy - only register if configuration is present
    ...(process.env.APPLE_CLIENT_ID &&
        process.env.APPLE_TEAM_ID &&
        process.env.APPLE_KEY_ID &&
        process.env.APPLE_PRIVATE_KEY_PATH &&
        !process.env.APPLE_PRIVATE_KEY_PATH.includes('path/to/AuthKey')
      ? [AppleStrategy]
      : []),
  ],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
