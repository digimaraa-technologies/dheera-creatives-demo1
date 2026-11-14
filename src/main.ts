import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { serveUploads } from './uploads/uploads.static';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // The frontend is unchanged; it is served as-is from public/.
  app.useStaticAssets(join(__dirname, '..', 'public'), { index: 'index.html' });

  // Uploaded product/service images, served read-only from uploads/.
  serveUploads(app);

  // The admin dashboard is a separate origin; only configured origins may call
  // the API with cookies. No wildcard is possible when credentials are enabled.
  const allowedOrigins = (config.get<string>('ADMIN_FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    });
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
