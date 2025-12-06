import { Injectable, Logger } from '@nestjs/common';
import {
  EventContext,
  OCCASION_FORMALITY,
} from '../dto/context-pack.dto';

/**
 * Event Intelligence Service
 *
 * Analyzes event/occasion context to determine appropriate
 * dress code, formality level, and other style constraints.
 */
@Injectable()
export class EventIntelligenceService {
  private readonly logger = new Logger(EventIntelligenceService.name);

  /**
   * Analyze event context from filters
   */
  async analyze(params: {
    occasion?: string;
    location?: string;
    datetime?: Date;
    additionalContext?: string;
  }): Promise<EventContext | undefined> {
    if (!params.occasion) {
      return undefined;
    }

    const occasionLower = params.occasion.toLowerCase().replace(/[_-]/g, '_');

    // Determine formality level
    const formality = this.determineFormality(occasionLower);

    // Determine setting type
    const settingType = this.determineSettingType(occasionLower, params.location);

    // Determine activity level
    const activityLevel = this.determineActivityLevel(occasionLower);

    // Determine social context
    const socialContext = this.determineSocialContext(occasionLower);

    // Get cultural considerations
    const culturalConsiderations = this.getCulturalConsiderations(occasionLower);

    const context: EventContext = {
      occasion: params.occasion,
      formality,
      settingType,
      activityLevel,
      socialContext,
      culturalConsiderations,
    };

    // Add time-based adjustments
    if (params.datetime) {
      this.applyTimeBasedAdjustments(context, params.datetime);
    }

    this.logger.log(`Event analyzed: ${params.occasion} -> ${formality} formality`);

    return context;
  }

  /**
   * Determine formality level from occasion
   */
  private determineFormality(occasion: string): EventContext['formality'] {
    // Check direct mapping
    const mapped = OCCASION_FORMALITY[occasion];
    if (mapped) {
      return mapped as EventContext['formality'];
    }

    // Keyword-based detection
    const formalKeywords = ['wedding', 'gala', 'black_tie', 'formal', 'ceremony', 'ball'];
    const businessKeywords = ['interview', 'meeting', 'presentation', 'client', 'board'];
    const smartCasualKeywords = ['dinner', 'date', 'party', 'cocktail', 'evening'];
    const casualKeywords = ['casual', 'brunch', 'beach', 'picnic', 'shopping', 'errands'];

    if (formalKeywords.some(kw => occasion.includes(kw))) {
      return 'formal';
    }
    if (businessKeywords.some(kw => occasion.includes(kw))) {
      return 'business';
    }
    if (smartCasualKeywords.some(kw => occasion.includes(kw))) {
      return 'smart_casual';
    }
    if (casualKeywords.some(kw => occasion.includes(kw))) {
      return 'casual';
    }

    // Default to smart casual
    return 'smart_casual';
  }

  /**
   * Determine if the event is indoor/outdoor
   */
  private determineSettingType(
    occasion: string,
    location?: string,
  ): EventContext['settingType'] {
    const outdoorKeywords = ['beach', 'picnic', 'garden', 'park', 'outdoor', 'hiking', 'bbq', 'festival'];
    const indoorKeywords = ['office', 'restaurant', 'theater', 'museum', 'gallery', 'meeting', 'interview'];

    // Check location first
    if (location) {
      const locationLower = location.toLowerCase();
      if (outdoorKeywords.some(kw => locationLower.includes(kw))) {
        return 'outdoor';
      }
      if (indoorKeywords.some(kw => locationLower.includes(kw))) {
        return 'indoor';
      }
    }

    // Check occasion
    if (outdoorKeywords.some(kw => occasion.includes(kw))) {
      return 'outdoor';
    }
    if (indoorKeywords.some(kw => occasion.includes(kw))) {
      return 'indoor';
    }

    // Default to mixed
    return 'mixed';
  }

  /**
   * Determine activity level for the event
   */
  private determineActivityLevel(occasion: string): EventContext['activityLevel'] {
    const highActivityKeywords = ['workout', 'gym', 'hiking', 'sports', 'dance', 'festival', 'shopping'];
    const lowActivityKeywords = ['dinner', 'meeting', 'interview', 'theater', 'opera', 'ceremony'];

    if (highActivityKeywords.some(kw => occasion.includes(kw))) {
      return 'high';
    }
    if (lowActivityKeywords.some(kw => occasion.includes(kw))) {
      return 'low';
    }

    return 'moderate';
  }

  /**
   * Determine social context
   */
  private determineSocialContext(occasion: string): EventContext['socialContext'] {
    const professionalKeywords = ['work', 'meeting', 'interview', 'office', 'client', 'conference', 'networking'];
    const romanticKeywords = ['date', 'anniversary', 'romantic', 'valentine'];
    const familyKeywords = ['family', 'reunion', 'thanksgiving', 'christmas', 'holiday'];
    const socialKeywords = ['party', 'birthday', 'friend', 'brunch', 'drinks'];

    if (professionalKeywords.some(kw => occasion.includes(kw))) {
      return 'professional';
    }
    if (romanticKeywords.some(kw => occasion.includes(kw))) {
      return 'romantic';
    }
    if (familyKeywords.some(kw => occasion.includes(kw))) {
      return 'family';
    }
    if (socialKeywords.some(kw => occasion.includes(kw))) {
      return 'social';
    }

    return 'social';
  }

  /**
   * Get cultural considerations for specific occasions
   */
  private getCulturalConsiderations(occasion: string): string[] {
    const considerations: string[] = [];

    // Wedding-specific
    if (occasion.includes('wedding')) {
      considerations.push('Avoid wearing white (traditionally reserved for the bride)');
      considerations.push('Check if the invitation specifies dress code');
    }

    // Religious events
    if (occasion.includes('church') || occasion.includes('religious') || occasion.includes('funeral')) {
      considerations.push('Consider modest attire');
      considerations.push('Avoid overly bright colors for solemn occasions');
    }

    // Business contexts
    if (occasion.includes('interview') || occasion.includes('meeting')) {
      considerations.push('Err on the side of more formal');
      considerations.push('Research company culture if possible');
    }

    // International considerations
    if (occasion.includes('international') || occasion.includes('cultural')) {
      considerations.push('Research local dress customs');
      considerations.push('When in doubt, choose conservative options');
    }

    return considerations;
  }

  /**
   * Apply time-based adjustments to context
   */
  private applyTimeBasedAdjustments(context: EventContext, datetime: Date): void {
    const hour = datetime.getHours();

    // Evening events are typically more formal
    if (hour >= 18 && context.formality === 'smart_casual') {
      // Suggest slightly more polished for evening
      context.dressCode = 'evening smart casual';
    }

    // Morning events can be slightly more casual
    if (hour < 12 && context.formality === 'business_casual') {
      context.dressCode = 'relaxed business casual';
    }

    // Weekend adjustments
    const isWeekend = datetime.getDay() === 0 || datetime.getDay() === 6;
    if (isWeekend && context.formality === 'business_casual') {
      context.formality = 'smart_casual';
    }
  }

  /**
   * Get outfit slot requirements based on formality
   */
  getRequiredSlots(formality: EventContext['formality']): string[] {
    switch (formality) {
      case 'black_tie':
        return ['top', 'bottom', 'footwear', 'outerwear', 'accessory'];
      case 'formal':
        return ['top', 'bottom', 'footwear', 'accessory'];
      case 'business':
        return ['top', 'bottom', 'footwear'];
      case 'business_casual':
        return ['top', 'bottom', 'footwear'];
      case 'smart_casual':
        return ['top', 'bottom', 'footwear'];
      case 'casual':
      default:
        return ['top', 'bottom', 'footwear'];
    }
  }

  /**
   * Get suggested styles based on event context
   */
  getSuggestedStyles(context: EventContext): string[] {
    switch (context.formality) {
      case 'black_tie':
        return ['elegant', 'sophisticated', 'luxurious'];
      case 'formal':
        return ['polished', 'refined', 'classic'];
      case 'business':
        return ['professional', 'tailored', 'conservative'];
      case 'business_casual':
        return ['professional', 'relaxed', 'modern'];
      case 'smart_casual':
        return ['stylish', 'put-together', 'contemporary'];
      case 'casual':
      default:
        return ['comfortable', 'relaxed', 'effortless'];
    }
  }
}
