import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  OutfitCombination,
  OutfitCombinationSchema,
} from './domain/schemas/outfit-combination.schema';
import { OutfitRepository } from './infrastructure/repositories/outfit.repository';
import { OutfitService } from './application/services/outfit.service';
import { OutfitController } from './presentation/controllers/outfit.controller';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: OutfitCombination.name, schema: OutfitCombinationSchema },
    ]),
  ],
  controllers: [OutfitController],
  providers: [OutfitService, OutfitRepository],
  exports: [OutfitService, OutfitRepository],
})
export class OutfitsModule {}
