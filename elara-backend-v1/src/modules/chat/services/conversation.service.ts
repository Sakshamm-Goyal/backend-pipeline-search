import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation } from '../domain/schemas/conversation.schema';
import { Message } from '../domain/schemas/message.schema';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
    @InjectModel(Message.name)
    private messageModel: Model<Message>,
  ) {}

  async getOrCreateConversation(
    userId: string,
    sessionId: string,
  ): Promise<Conversation> {
    // Try to find existing conversation
    let conversation = await this.conversationModel.findOne({
      _id: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(userId),
    });

    // Create new conversation if not found
    if (!conversation) {
      conversation = await this.conversationModel.create({
        _id: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
        status: 'active',
        metadata: {},
      });
      this.logger.log(`Created new conversation: ${sessionId}`);
    }

    return conversation;
  }

  async getContext(sessionId: string, userId: string): Promise<any> {
    // Get conversation
    const conversation = await this.getOrCreateConversation(userId, sessionId);

    // Get recent messages (last 20)
    const messages = await this.messageModel
      .find({ conversationId: new Types.ObjectId(sessionId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec();

    return {
      conversationId: sessionId,
      userId,
      messages: messages.reverse(), // Reverse to get chronological order
      lastOutfits: conversation.lastOutfits || [],
      summary: conversation.summary,
    };
  }

  async saveMessage(
    sessionId: string,
    messageData: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      data?: any;
      intent?: string;
    },
  ): Promise<Message> {
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(sessionId),
      ...messageData,
    });

    return message;
  }

  async updateLastOutfits(sessionId: string, outfits: any[]): Promise<void> {
    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(sessionId) },
      { $set: { lastOutfits: outfits } },
    );
  }

  async archiveConversation(sessionId: string): Promise<void> {
    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(sessionId) },
      { $set: { status: 'archived' } },
    );
  }
}
