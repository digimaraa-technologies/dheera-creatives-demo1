import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Prisma codes raised by values the client can send (overlong strings, bad
// UUIDs, out-of-range numbers) rather than by a broken server or database.
const INPUT_ERROR_CODES = new Set([
  'P2000', // value too long for the column
  'P2005', // stored value not valid for the field type
  'P2006', // provided value not valid
  'P2007', // data validation error
  'P2011', // null constraint violation
  'P2012', // missing required value
  'P2013', // missing required argument
  'P2019', // input error
  'P2020', // value out of range
  'P2023', // inconsistent column data
]);

// Raw-query errors carry the PostgreSQL SQLSTATE in meta.code.
const INPUT_SQLSTATE_CODES = new Set(['22001', '22021', '22P02']);

function isClientInputError(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (INPUT_ERROR_CODES.has(error.code)) return true;
  const sqlState = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof sqlState === 'string' && INPUT_SQLSTATE_CODES.has(sqlState);
}

/**
 * Turns expected Prisma input errors into a generic 400 instead of leaking a
 * stack trace, while still logging unexpected failures as 500.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    error: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (isClientInputError(error)) {
      this.logger.warn(`Rejected invalid input (${error.code})`);
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request data',
      });
      return;
    }

    this.logger.error(`Database request failed (${error.code})`, error.stack);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
