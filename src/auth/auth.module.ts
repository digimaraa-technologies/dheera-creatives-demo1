import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_OPTIONS } from '../common/rate-limit';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { LoginOriginGuard } from './guards/login-origin.guard';
import { LoginAttemptsService } from './login-attempts.service';

@Module({
  imports: [
    // Global: every controller can opt in with @UseGuards(ThrottlerGuard).
    ThrottlerModule.forRoot(THROTTLER_OPTIONS),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminAuthGuard, LoginOriginGuard, LoginAttemptsService],
  exports: [AuthService, AdminAuthGuard],
})
export class AuthModule {}
