import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookieOptions,
  csrfCookieOptions,
  readCookie,
  sessionCookieOptions,
} from './auth.cookies';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, SafeAdmin } from './auth.types';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { LoginDto } from './dto/login.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ admin: SafeAdmin }> {
    const session = await this.auth.login(dto);

    response.cookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(this.auth.isProduction, this.auth.sessionTtlMs),
    );
    response.cookie(
      CSRF_COOKIE,
      session.csrfToken,
      csrfCookieOptions(this.auth.isProduction, this.auth.sessionTtlMs),
    );

    return { admin: session.admin };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: SafeAdmin): { admin: SafeAdmin } {
    return { admin };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) {
      await this.auth.logout(token);
    }

    response.clearCookie(
      SESSION_COOKIE,
      clearCookieOptions(this.auth.isProduction, true),
    );
    response.clearCookie(
      CSRF_COOKIE,
      clearCookieOptions(this.auth.isProduction, false),
    );

    return { success: true };
  }
}
