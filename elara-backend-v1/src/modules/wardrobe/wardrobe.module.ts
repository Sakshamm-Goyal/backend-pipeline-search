import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { WardrobeItem, WardrobeItemSchema } from './domain/schemas/wardrobe-item.schema';
import { WardrobeRepository } from './infrastructure/repositories/wardrobe.repository';
import { WardrobeService } from './application/services/wardrobe.service';
import { WardrobeController } from './presentation/controllers/wardrobe.controller';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    MongooseModule.forFeature([
      { name: WardrobeItem.name, schema: WardrobeItemSchema },
    ]),
  ],
  controllers: [WardrobeController],
  providers: [WardrobeService, WardrobeRepository],
  exports: [WardrobeService, WardrobeRepository],
})
export class WardrobeModule {}
