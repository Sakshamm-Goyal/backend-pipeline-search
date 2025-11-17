import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserProfile } from '../../domain/schemas/user-profile.schema';

@Injectable()
export class UserProfileRepository {
  private readonly logger = new Logger(UserProfileRepository.name);

  constructor(
    @InjectModel(UserProfile.name)
    private userProfileModel: Model<UserProfile>,
  ) {}

  /**
   * Create a new user profile
   */
  async create(profileData: Partial<UserProfile>): Promise<UserProfile> {
    try {
      const profile = new this.userProfileModel(profileData);
      const saved = await profile.save();
      this.logger.log(`UserProfile created for userId: ${profileData.userId}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create UserProfile: ${error}`);
      throw error;
    }
  }

  /**
   * Find profile by user ID
   */
  async findByUserId(userId: string | Types.ObjectId): Promise<UserProfile | null> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      return await this.userProfileModel.findOne({ userId: objectId }).exec();
    } catch (error) {
      this.logger.error(`Failed to find UserProfile by userId: ${error}`);
      throw error;
    }
  }

  /**
   * Find profile by ID
   */
  async findById(id: string | Types.ObjectId): Promise<UserProfile | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      return await this.userProfileModel.findById(objectId).exec();
    } catch (error) {
      this.logger.error(`Failed to find UserProfile by id: ${error}`);
      throw error;
    }
  }

  /**
   * Update profile by user ID
   */
  async updateByUserId(
    userId: string | Types.ObjectId,
    updateData: Partial<UserProfile>,
  ): Promise<UserProfile | null> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

      // Special handling for location updates to properly manage coordinates
      if (updateData.location) {
        const updateQuery: any = {};

        // Set the location fields
        if (updateData.location.city !== undefined) {
          updateQuery['location.city'] = updateData.location.city;
        }
        if (updateData.location.state !== undefined) {
          updateQuery['location.state'] = updateData.location.state;
        }
        if (updateData.location.country !== undefined) {
          updateQuery['location.country'] = updateData.location.country;
        }
        if (updateData.location.timezone !== undefined) {
          updateQuery['location.timezone'] = updateData.location.timezone;
        }

        // Handle coordinates: set or unset
        if (updateData.location.coordinates !== undefined) {
          updateQuery['location.coordinates'] = updateData.location.coordinates;
        } else {
          // If coordinates are not provided, remove them from the document
          const updated = await this.userProfileModel
            .findOneAndUpdate(
              { userId: objectId },
              {
                $set: updateQuery,
                $unset: { 'location.coordinates': '' }
              },
              { new: true }
            )
            .exec();

          if (updated) {
            this.logger.log(`UserProfile updated for userId: ${userId}`);
          }
          return updated;
        }

        // If coordinates are provided, just use $set
        const updated = await this.userProfileModel
          .findOneAndUpdate(
            { userId: objectId },
            { $set: updateQuery },
            { new: true }
          )
          .exec();

        if (updated) {
          this.logger.log(`UserProfile updated for userId: ${userId}`);
        }
        return updated;
      }

      // For non-location updates, use simple update
      const updated = await this.userProfileModel
        .findOneAndUpdate({ userId: objectId }, updateData, { new: true })
        .exec();

      if (updated) {
        this.logger.log(`UserProfile updated for userId: ${userId}`);
      }

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update UserProfile: ${error}`);
      throw error;
    }
  }

  /**
   * Delete profile by user ID
   */
  async deleteByUserId(userId: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      const result = await this.userProfileModel.deleteOne({ userId: objectId }).exec();

      if (result.deletedCount > 0) {
        this.logger.log(`UserProfile deleted for userId: ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to delete UserProfile: ${error}`);
      throw error;
    }
  }

  /**
   * Check if profile exists for user
   */
  async existsByUserId(userId: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      const count = await this.userProfileModel.countDocuments({ userId: objectId }).exec();
      return count > 0;
    } catch (error) {
      this.logger.error(`Failed to check UserProfile existence: ${error}`);
      throw error;
    }
  }

  /**
   * Find profiles by style tag
   */
  async findByStyleTag(styleTag: string): Promise<UserProfile[]> {
    try {
      return await this.userProfileModel
        .find({ 'stylePreferences.selectedStyles': styleTag })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find profiles by style tag: ${error}`);
      throw error;
    }
  }

  /**
   * Find profiles near a location (geospatial query)
   */
  async findNearLocation(
    longitude: number,
    latitude: number,
    maxDistanceMeters: number = 50000, // 50km default
  ): Promise<UserProfile[]> {
    try {
      return await this.userProfileModel
        .find({
          'location.coordinates': {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [longitude, latitude],
              },
              $maxDistance: maxDistanceMeters,
            },
          },
        })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find profiles near location: ${error}`);
      throw error;
    }
  }
}
