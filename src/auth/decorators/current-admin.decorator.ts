import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedRequest, SafeAdmin } from '../auth.types';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeAdmin =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().admin,
);
