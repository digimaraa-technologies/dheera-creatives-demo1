import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RATE_LIMITS } from '../common/rate-limit';
import {
  clearCookieOptions,
  csrfCookieName,
  csrfCookieOptions,
  readSecurityCookies,
  sessionCookieName,
  sessionCookieOptions,
} from './auth.cookies';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, SafeAdmin } from './auth.types';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { LoginDto } from './dto/login.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { LoginOriginGuard } from './guards/login-origin.guard';
import { LoginAttemptsService } from './login-attempts.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginOriginGuard, ThrottlerGuard)
  @Throttle({ default: RATE_LIMITS.login })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ admin: SafeAdmin }> {
    // Keyed by the identifier so an attacker rotating IPs cannot keep guessing
    // one account's password. Checked before bcrypt to avoid CPU amplification.
    const key = dto.identifier.trim().toLowerCase();
    this.loginAttempts.assertAllowed(key);

    let session;
    try {
      session = await this.auth.login(dto);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.loginAttempts.recordFailure(key);
      }
      throw error;
    }
    this.loginAttempts.reset(key);

    response.cookie(
      sessionCookieName(this.auth.isProduction),
      session.token,
      sessionCookieOptions(this.auth.isProduction, this.auth.sessionTtlMs),
    );
    response.cookie(
      csrfCookieName(this.auth.isProduction),
      session.csrfToken,
      csrfCookieOptions(this.auth.isProduction, this.auth.sessionTtlMs),
    );

    return { admin: session.admin };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard, ThrottlerGuard)
  @Throttle({ default: RATE_LIMITS.session })
  me(@CurrentAdmin() admin: SafeAdmin): { admin: SafeAdmin } {
    return { admin };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard, ThrottlerGuard)
  @Throttle({ default: RATE_LIMITS.session })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    const { session } = readSecurityCookies(
      request.headers.cookie,
      this.auth.isProduction,
    );
    if (session) {
      await this.auth.logout(session);
    }

    this.clearAuthCookies(response);
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard, ThrottlerGuard)
  @Throttle({ default: RATE_LIMITS.session })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    // Scoped to the authenticated admin; other admins keep their sessions.
    await this.auth.logoutAll(request.admin.id);

    this.clearAuthCookies(response);
    return { success: true };
  }

  private clearAuthCookies(response: Response): void {
    response.clearCookie(
      sessionCookieName(this.auth.isProduction),
      clearCookieOptions(this.auth.isProduction, true),
    );
    response.clearCookie(
      csrfCookieName(this.auth.isProduction),
      clearCookieOptions(this.auth.isProduction, false),
    );
  }
}
