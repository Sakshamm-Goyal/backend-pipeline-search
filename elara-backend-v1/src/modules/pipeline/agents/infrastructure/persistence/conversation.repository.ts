import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation } from '../../domain/schemas/conversation.schema';
import { ConversationContext } from '../../dto/chat-message.dto';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
  ) {}

  /**
   * Save a new conversation or update an existing one
   */
  async save(context: ConversationContext): Promise<void> {
    try {
      const existingConversation = await this.conversationModel.findOne({
        conversationId: context.conversationId,
      });

      if (existingConversation) {
        // Update existing conversation
        existingConversation.history = context.history;
        existingConversation.currentIntent = context.currentIntent;
        existingConversation.userContext = context.userContext;
        if (context.metadata) {
          existingConversation.metadata = {
            startedAt: context.metadata.startedAt || new Date(),
            lastMessageAt: context.metadata.lastMessageAt || new Date(),
            messageCount: context.metadata.messageCount || context.history.length,
          };
        }
        existingConversation.sessionId = context.sessionId;

        await existingConversation.save();
        this.logger.debug(`Updated conversation ${context.conversationId}`);
      } else {
        // Create new conversation
        const conversation = new this.conversationModel({
          conversationId: context.conversationId,
          userId: new Types.ObjectId(context.userId),
          sessionId: context.sessionId,
          history: context.history,
          currentIntent: context.currentIntent,
          userContext: context.userContext,
          metadata: context.metadata,
          isActive: true,
        });

        await conversation.save();
        this.logger.debug(`Created new conversation ${context.conversationId}`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error saving conversation: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find a conversation by ID and user ID (ensures ownership)
   */
  async findById(conversationId: string, userId: string): Promise<ConversationContext | null> {
    try {
      const conversation = await this.conversationModel.findOne({
        conversationId,
        userId: new Types.ObjectId(userId),
        isActive: true,
      });

      if (!conversation) {
        return null;
      }

      return this.toConversationContext(conversation);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding conversation: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find all conversations for a user with pagination
   */
  async findByUserId(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ conversations: ConversationContext[]; total: number; page: number; totalPages: number }> {
    try {
      const skip = (page - 1) * limit;

      const [conversations, total] = await Promise.all([
        this.conversationModel
          .find({
            userId: new Types.ObjectId(userId),
            isActive: true,
          })
          .sort({ 'metadata.lastMessageAt': -1 })
          .skip(skip)
          .limit(limit),
        this.conversationModel.countDocuments({
          userId: new Types.ObjectId(userId),
          isActive: true,
        }),
      ]);

      return {
        conversations: conversations.map((conv) => this.toConversationContext(conv)),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding user conversations: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Soft delete a conversation (mark as inactive)
   */
  async delete(conversationId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.conversationModel.updateOne(
        {
          conversationId,
          userId: new Types.ObjectId(userId),
          isActive: true,
        },
        {
          $set: {
            isActive: false,
            deletedAt: new Date(),
          },
        },
      );

      if (result.modifiedCount === 0) {
        this.logger.warn(`Conversation ${conversationId} not found or already deleted`);
        return false;
      }

      this.logger.debug(`Soft deleted conversation ${conversationId}`);
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error deleting conversation: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Hard delete a conversation (permanently remove from database)
   * Use with caution - typically only for cleanup or admin actions
   */
  async hardDelete(conversationId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.conversationModel.deleteOne({
        conversationId,
        userId: new Types.ObjectId(userId),
      });

      if (result.deletedCount === 0) {
        this.logger.warn(`Conversation ${conversationId} not found for hard deletion`);
        return false;
      }

      this.logger.debug(`Hard deleted conversation ${conversationId}`);
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error hard deleting conversation: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Check if a conversation exists and belongs to the user
   */
  async existsAndBelongsToUser(conversationId: string, userId: string): Promise<boolean> {
    try {
      const count = await this.conversationModel.countDocuments({
        conversationId,
        userId: new Types.ObjectId(userId),
        isActive: true,
      });

      return count > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error checking conversation ownership: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get conversation statistics for a user
   */
  async getUserStats(userId: string): Promise<{
    totalConversations: number;
    totalMessages: number;
    averageMessagesPerConversation: number;
  }> {
    try {
      const stats = await this.conversationModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            isActive: true,
          },
        },
        {
          $group: {
            _id: null,
            totalConversations: { $sum: 1 },
            totalMessages: { $sum: '$metadata.messageCount' },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalConversations: 0,
          totalMessages: 0,
          averageMessagesPerConversation: 0,
        };
      }

      const { totalConversations, totalMessages } = stats[0];
      return {
        totalConversations,
        totalMessages,
        averageMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting user stats: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Clean up old soft-deleted conversations (optional maintenance task)
   */
  async cleanupDeletedConversations(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.conversationModel.deleteMany({
        isActive: false,
        deletedAt: { $lt: cutoffDate },
      });

      this.logger.debug(`Cleaned up ${result.deletedCount} old conversations`);
      return result.deletedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error cleaning up conversations: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Convert MongoDB document to ConversationContext
   */
  private toConversationContext(conversation: Conversation): ConversationContext {
    return {
      conversationId: conversation.conversationId,
      userId: conversation.userId.toString(),
      sessionId: conversation.sessionId,
      history: conversation.history,
      currentIntent: conversation.currentIntent,
      userContext: conversation.userContext,
      metadata: conversation.metadata ? {
        startedAt: conversation.metadata.startedAt,
        lastMessageAt: conversation.metadata.lastMessageAt,
        messageCount: conversation.metadata.messageCount,
      } : undefined,
    };
  }
}
