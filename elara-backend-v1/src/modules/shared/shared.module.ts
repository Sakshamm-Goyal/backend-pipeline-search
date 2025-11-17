import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './services/storage.service';
import { ImageProcessingService } from './services/image-processing.service';

@Module({
  imports: [ConfigModule],
  providers: [StorageService, ImageProcessingService],
  exports: [StorageService, ImageProcessingService],
})
export class SharedModule {}
