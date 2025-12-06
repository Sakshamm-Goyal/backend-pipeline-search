import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './shared/health/health.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WardrobeModule } from './modules/wardrobe/wardrobe.module';
import { OutfitsModule } from './modules/outfits/outfits.module';
import { SharedModule } from './modules/shared/shared.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ChatModule } from './modules/chat/chat.module';
import { JwtAuthGuard } from './modules/auth/infrastructure/guards/jwt-auth-global.guard';
import { RolesGuard } from './modules/auth/infrastructure/guards/roles.guard';
import { RequestIdMiddleware } from './shared/middleware/request-id.middleware';
import { CsrfMiddleware } from './shared/middleware/csrf.middleware';

// Config
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import oauthConfig from './config/oauth.config';
import mailConfig from './config/mail.config';
import llmConfig from './config/llm.config';
import scrapersConfig from './config/scrapers.config';
import cacheConfig from './config/cache.config';
import { validationSchema } from './config/env.validation';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        jwtConfig,
        oauthConfig,
        mailConfig,
        llmConfig,
        scrapersConfig,
        cacheConfig,
      ],
      envFilePath: ['.env.local', '.env'],
      validationSchema,
      validationOptions: {
        abortEarly: false, // Show all validation errors at once
      },
    }),

    // Logging
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          remove: true,
        },
        customProps: (req: any) => ({
          requestId: req.id,
        }),
        serializers: {
          req: (req: any) => ({
            method: req.method,
            url: req.url,
            params: req.params,
            query: req.query,
            requestId: req.id,
          }),
          res: (res: any) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 10, // 10 requests per minute (adjustable per environment)
      },
    ]),

    // Scheduled Tasks (cron jobs)
    ScheduleModule.forRoot(),

    // Database
    MongooseModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ReturnType<typeof databaseConfig>) => ({
        uri: dbConfig.uri,
        retryWrites: true,
        retryReads: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4, // Use IPv4, skip IPv6
        maxPoolSize: 10,
        minPoolSize: 2,
        connectTimeoutMS: 10000,
      }),
    }),

    // Feature Modules
    AuthModule,
    HealthModule,
    SharedModule,
    OnboardingModule,
    WardrobeModule,
    OutfitsModule,
    PipelineModule, // AI Pipeline Module
    ChatModule, // WebSocket Chat Module
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global Rate Limiter
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global JWT Guard - all routes protected by default, use @Public() to skip
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Roles Guard - checks @Roles() decorator for RBAC
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
