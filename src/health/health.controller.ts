import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RATE_LIMITS } from '../common/rate-limit';

/**
 * Liveness probe for the reverse proxy, systemd and uptime monitoring.
 * Deliberately does not touch the database: a database outage should not make
 * the process look dead and trigger restarts. Use `pg_isready` or a dedicated
 * readiness check for database health.
 */
@Controller('api/health')
@UseGuards(ThrottlerGuard)
@Throttle({ default: RATE_LIMITS.public })
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
