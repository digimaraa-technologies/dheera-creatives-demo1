import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminServicesController } from './admin-services.controller';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [AuthModule, UploadsModule],
  controllers: [ServicesController, AdminServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
