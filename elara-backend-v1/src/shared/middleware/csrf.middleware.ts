import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/**
 * CSRF Protection Middleware using Double-Submit Cookie Pattern
 *
 * How it works:
 * 1. Sets a random CSRF token in a cookie (httpOnly for security)
 * 2. Client must send the same token in a custom header (X-CSRF-Token)
 * 3. Middleware compares cookie value with header value
 * 4. Only protects state-changing methods (POST, PUT, PATCH, DELETE)
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly CSRF_COOKIE_NAME = 'XSRF-TOKEN';
  private readonly CSRF_HEADER_NAME = 'x-csrf-token';
  private readonly CSRF_SECRET_COOKIE_NAME = '_csrf_secret';

  use(req: Request, res: Response, next: NextFunction): void {
    // Skip CSRF check for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // Generate and set CSRF token for safe requests
      this.generateCsrfToken(req, res);
      return next();
    }

    // Skip CSRF check for public auth routes (initial login/register)
    // Also skip for API routes that are already protected by JWT
    const publicRoutes = [
      '/auth/login',
      '/auth/register',
      '/auth/google/callback',
      '/auth/apple/callback',
      '/auth/refresh',
      '/auth/verify-email',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/logout',
      // Chat routes - protected by JWT, CSRF not needed for API calls
      '/chat/message',
      '/chat/conversations',
    ];

    // In NestJS with global prefix, req.path doesn't include the prefix
    // So we check req.path, req.url, and req.originalUrl for matching routes
    const path = req.path;
    const url = req.url;
    const originalUrl = req.originalUrl;

    const isPublicRoute = publicRoutes.some(route =>
      path.startsWith(route) ||
      path === route ||
      url.includes(route) ||
      originalUrl.includes(route)
    );

    if (isPublicRoute) {
      return next();
    }

    // Validate CSRF token for state-changing requests
    const tokenFromHeader = req.headers[this.CSRF_HEADER_NAME] as string;
    const tokenFromCookie = req.cookies?.[this.CSRF_SECRET_COOKIE_NAME];

    if (!tokenFromHeader || !tokenFromCookie) {
      throw new ForbiddenException('CSRF token missing');
    }

    // Constant-time comparison to prevent timing attacks
    if (!this.safeCompare(tokenFromHeader, tokenFromCookie)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    next();
  }

  /**
   * Generate and set CSRF token in cookies
   */
  private generateCsrfToken(req: Request, res: Response): void {
    // Check if token already exists
    if (req.cookies?.[this.CSRF_SECRET_COOKIE_NAME]) {
      return;
    }

    // Generate random token
    const csrfToken = randomBytes(32).toString('hex');

    // Set httpOnly cookie for validation (not accessible by JavaScript)
    res.cookie(this.CSRF_SECRET_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    // Set readable cookie for client to include in headers (accessible by JavaScript)
    res.cookie(this.CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false, // Client needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}
