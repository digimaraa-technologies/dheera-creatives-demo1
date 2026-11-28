import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  const { isProduction } = configureApp(app, config);
  if (!isProduction) {
    new Logger('Bootstrap').warn(
      'NODE_ENV is not "production": Secure cookies and HSTS are disabled.',
    );
  }

  const port = Number(config.get('PORT')) || 3000;
  // Explicit host so the app does not silently listen on every interface in
  // production. Development defaults to 0.0.0.0 (see env.validation.ts).
  const host = config.get<string>('BIND_HOST') ?? '0.0.0.0';
  if (isProduction && (host === '0.0.0.0' || host === '::')) {
    new Logger('Bootstrap').warn(
      `Listening on ${host}: the app is reachable on every network interface. Ensure this matches the managed runtime/proxy configuration.`,
    );
  }
  await app.listen(port, host);
}

void bootstrap();
