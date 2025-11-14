import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Delete,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from '../../application/services/auth.service';
import { RegisterDto } from '../../application/dto/register.dto';
import { LoginDto } from '../../application/dto/login.dto';
import { ForgotPasswordDto } from '../../application/dto/forgot-password.dto';
import { ResetPasswordDto } from '../../application/dto/reset-password.dto';
import { LocalAuthGuard } from '../../infrastructure/guards/local-auth.guard';
import { JwtAuthGuard } from '../../infrastructure/guards/jwt-auth.guard';
import { GoogleAuthGuard } from '../../infrastructure/guards/google-auth.guard';
import { AppleAuthGuard } from '../../infrastructure/guards/apple-auth.guard';
import { Public } from '../../application/decorators/public.decorator';
import { CurrentUser } from '../../application/decorators/current-user.decorator';
import { User } from '../../../user/domain/schemas/user.schema';
import { AuthProvider } from '../../domain/enums/auth-provider.enum';
import { TokenService } from '../../application/services/token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // SECURITY: 3 attempts per minute
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // SECURITY: 5 attempts per minute
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const result = await this.authService.login(dto, ipAddress, userAgent);

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('Refresh token not found');
    }

    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const result = await this.authService.refreshTokens(refreshToken, ipAddress, userAgent);

    // Set new refresh token as HttpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (refreshToken) {
      const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
      await this.authService.logout(refreshToken, ipAddress);
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    return { message: 'Logged out successfully' };
  }

  @Public()
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // SECURITY: 3 attempts per minute
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // SECURITY: 3 attempts per minute
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // Google OAuth
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Initiates Google OAuth flow
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as User;
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(
      user,
      ipAddress,
      userAgent,
    );

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from strict to lax for OAuth redirects
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // SECURITY FIX: Use POST form auto-submit instead of URL redirect
    // This prevents token exposure in browser history and server logs
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting...</title>
        </head>
        <body>
          <form id="authForm" method="POST" action="${frontendUrl}/auth/callback">
            <input type="hidden" name="accessToken" value="${accessToken}" />
          </form>
          <script>
            document.getElementById('authForm').submit();
          </script>
          <noscript>
            <p>Please click the button below to continue:</p>
            <button type="submit" form="authForm">Continue</button>
          </noscript>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  // Apple OAuth
  @Public()
  @Get('apple')
  @UseGuards(AppleAuthGuard)
  async appleAuth() {
    // Initiates Apple OAuth flow
  }

  @Public()
  @Post('apple/callback')
  @UseGuards(AppleAuthGuard)
  async appleAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as User;
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(
      user,
      ipAddress,
      userAgent,
    );

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from strict to lax for OAuth redirects
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // SECURITY FIX: Use POST form auto-submit instead of URL redirect
    // This prevents token exposure in browser history and server logs
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting...</title>
        </head>
        <body>
          <form id="authForm" method="POST" action="${frontendUrl}/auth/callback">
            <input type="hidden" name="accessToken" value="${accessToken}" />
          </form>
          <script>
            document.getElementById('authForm').submit();
          </script>
          <noscript>
            <p>Please click the button below to continue:</p>
            <button type="submit" form="authForm">Continue</button>
          </noscript>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  // Unlink OAuth provider
  @UseGuards(JwtAuthGuard)
  @Delete('oauth/:provider')
  @HttpCode(HttpStatus.OK)
  async unlinkProvider(
    @Param('provider') provider: AuthProvider,
    @CurrentUser() user: User,
  ) {
    await this.authService.validateOAuthUser({
      provider,
      userId: (user._id as any).toString(),
    });
    return { message: `${provider} account unlinked successfully` };
  }

  // Get current user
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getCurrentUser(@CurrentUser() user: User) {
    return {
      id: (user._id as any).toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      providers: user.providers,
    };
  }
}
