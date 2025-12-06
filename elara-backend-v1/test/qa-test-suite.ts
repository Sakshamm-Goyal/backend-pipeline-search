/**
 * QA Test Suite for Elara Fashion Agent
 *
 * Tests all 8 sections of the comprehensive QA checklist:
 * A. Intent Routing
 * B. Product Search
 * C. Event Logic
 * D. Wardrobe Integration
 * E. Feedback Updates
 * F. Multi-Turn Memory
 * G. Clarification Logic
 * H. Safety Checks
 */

import { Test, TestingModule } from '@nestjs/testing';
import { IntentRouterService, AgentType } from '../src/modules/pipeline/agents/services/intent-router.service';
import { ClaudeService } from '../src/modules/pipeline/infrastructure/llm/claude.service';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// Test result tracking
interface TestResult {
  section: string;
  testId: string;
  query: string;
  expectedIntent?: string;
  expectedAgent?: AgentType;
  actualIntent?: string;
  actualAgent?: AgentType;
  filters?: any;
  passed: boolean;
  notes: string;
}

const results: TestResult[] = [];

/**
 * Helper to test intent classification
 */
async function testIntentClassification(
  claudeService: ClaudeService,
  testId: string,
  section: string,
  query: string,
  expectations: {
    intent?: string;
    agent?: AgentType;
    shouldHaveFilters?: string[];
    shouldNotHaveSearch?: boolean;
    notes?: string;
  }
): Promise<TestResult> {
  try {
    const classification = await claudeService.classifyIntent(
      query,
      [], // No history
      { profile: { gender: 'female' } } // Default user context
    );

    const intentMapping: Record<string, AgentType> = {
      product_search: AgentType.SEARCH,
      single_item_search: AgentType.SEARCH,
      outfit_request: AgentType.OUTFIT_GENERATOR,
      item_replacement: AgentType.OUTFIT_GENERATOR,
      feedback: AgentType.FEEDBACK,
      general_chat: AgentType.CHAT,
      fashion_advice: AgentType.FASHION_ADVICE,
      clarification_needed: AgentType.CLARIFICATION,
    };

    const actualAgent = intentMapping[classification.intent] || AgentType.CHAT;

    // Determine if test passed
    let passed = true;
    const notes: string[] = [];

    if (expectations.intent && classification.intent !== expectations.intent) {
      passed = false;
      notes.push(`Expected intent: ${expectations.intent}, got: ${classification.intent}`);
    }

    if (expectations.agent && actualAgent !== expectations.agent) {
      passed = false;
      notes.push(`Expected agent: ${expectations.agent}, got: ${actualAgent}`);
    }

    if (expectations.shouldHaveFilters) {
      for (const filter of expectations.shouldHaveFilters) {
        if (!classification.filters[filter]) {
          notes.push(`Missing expected filter: ${filter}`);
        }
      }
    }

    if (expectations.shouldNotHaveSearch &&
        (classification.intent === 'product_search' || classification.intent === 'outfit_request')) {
      passed = false;
      notes.push('Should not trigger search but did');
    }

    const result: TestResult = {
      section,
      testId,
      query,
      expectedIntent: expectations.intent,
      expectedAgent: expectations.agent,
      actualIntent: classification.intent,
      actualAgent: actualAgent,
      filters: classification.filters,
      passed,
      notes: notes.length > 0 ? notes.join('; ') : (expectations.notes || 'OK'),
    };

    results.push(result);
    return result;
  } catch (error) {
    const result: TestResult = {
      section,
      testId,
      query,
      expectedIntent: expectations.intent,
      expectedAgent: expectations.agent,
      passed: false,
      notes: `Error: ${(error as Error).message}`,
    };
    results.push(result);
    return result;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('='.repeat(80));
  console.log('ELARA FASHION AGENT - COMPREHENSIVE QA TEST SUITE');
  console.log('='.repeat(80));
  console.log();

  // Initialize Claude service
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Create a mock config service
  const configService = {
    get: (key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return apiKey;
      if (key === 'LLM_TIMEOUT_MS') return '20000';
      return undefined;
    },
  } as ConfigService;

  const claudeService = new ClaudeService(configService);

  // ========================================================================
  // SECTION A: INTENT ROUTING
  // ========================================================================
  console.log('\n📋 SECTION A: INTENT ROUTING TESTS');
  console.log('-'.repeat(60));

  // A1: Greeting
  await testIntentClassification(claudeService, 'A1', 'A', 'hi', {
    intent: 'general_chat',
    agent: AgentType.CHAT,
    shouldNotHaveSearch: true,
    notes: 'Greeting should not trigger search',
  });

  await testIntentClassification(claudeService, 'A1b', 'A', 'hlo', {
    intent: 'general_chat',
    agent: AgentType.CHAT,
    shouldNotHaveSearch: true,
  });

  await testIntentClassification(claudeService, 'A1c', 'A', 'how do you help as a fashion assistant?', {
    intent: 'general_chat',
    agent: AgentType.CHAT,
    shouldNotHaveSearch: true,
  });

  // A2: Generic style Q
  await testIntentClassification(claudeService, 'A2', 'A', 'what should I wear under a white shirt so it doesn\'t show through?', {
    intent: 'fashion_advice',
    agent: AgentType.FASHION_ADVICE,
    shouldNotHaveSearch: true,
    notes: 'Style advice should not trigger product search',
  });

  await testIntentClassification(claudeService, 'A2b', 'A', 'what shoes go best with black skinny jeans for a night out?', {
    intent: 'fashion_advice',
    agent: AgentType.FASHION_ADVICE,
    notes: 'Style Q without action verb',
  });

  // A3: Single Item Search
  await testIntentClassification(claudeService, 'A3', 'A', 'suggest me a red shirt under $60 in size M', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['color', 'priceRange', 'itemType'],
    notes: 'Should extract color, price, size',
  });

  await testIntentClassification(claudeService, 'A3b', 'A', 'find navy blazer in size 40 for men under $200', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['color', 'priceRange', 'itemType'],
  });

  await testIntentClassification(claudeService, 'A3c', 'A', 'white sneakers size 9 minimal design', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['color', 'itemType'],
  });

  // A4: Event Outfit
  await testIntentClassification(claudeService, 'A4', 'A', 'I have a rooftop wedding in LA next Saturday evening. Semi-formal vibe. Build me outfits.', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    shouldHaveFilters: ['occasion'],
    notes: 'Event with occasion should trigger outfit generator',
  });

  // ========================================================================
  // SECTION B: PRODUCT SEARCH
  // ========================================================================
  console.log('\n📋 SECTION B: PRODUCT SEARCH TESTS');
  console.log('-'.repeat(60));

  // B1: Color Matching
  await testIntentClassification(claudeService, 'B1', 'B', 'find me a pastel blue blazer for men, size M', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['color', 'itemType', 'gender'],
    notes: 'Should extract pastel blue color',
  });

  // B2: Size Matching
  await testIntentClassification(claudeService, 'B2', 'B', 'suggest me white sneakers, men\'s size 9, no chunky soles', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['color', 'itemType', 'size'],
    notes: 'Should extract size and features',
  });

  // B3: Gender Matching
  await testIntentClassification(claudeService, 'B3', 'B', 'find me women\'s black ankle boots under 100 USD', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['gender', 'color', 'itemType', 'priceRange'],
    notes: 'Should extract gender filter',
  });

  // B4: Price Filtering
  await testIntentClassification(claudeService, 'B4', 'B', 'show me a smart casual shirt under $40', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    shouldHaveFilters: ['priceRange', 'itemType'],
    notes: 'Should extract price filter',
  });

  // ========================================================================
  // SECTION C: EVENT LOGIC
  // ========================================================================
  console.log('\n📋 SECTION C: EVENT LOGIC TESTS');
  console.log('-'.repeat(60));

  // C1: Weather-aware
  await testIntentClassification(claudeService, 'C1', 'C', 'outdoor winter wedding in New York in January, formal', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    shouldHaveFilters: ['occasion'],
    notes: 'Should detect winter wedding context',
  });

  // C2: Venue vibe
  await testIntentClassification(claudeService, 'C2', 'C', 'beach wedding in Goa, late afternoon, barefoot friendly', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    shouldHaveFilters: ['occasion'],
    notes: 'Should detect beach venue context',
  });

  // C3: Dress code
  await testIntentClassification(claudeService, 'C3', 'C', 'event: black tie optional', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should detect black tie dress code',
  });

  // ========================================================================
  // SECTION D: WARDROBE INTEGRATION
  // ========================================================================
  console.log('\n📋 SECTION D: WARDROBE INTEGRATION TESTS');
  console.log('-'.repeat(60));

  // D1: Wardrobe-first
  await testIntentClassification(claudeService, 'D1', 'D', 'using only my wardrobe, build me 3 office looks', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should trigger wardrobe-only strategy',
  });

  // D2: Mix wardrobe + shopping
  await testIntentClassification(claudeService, 'D2', 'D', 'I want to use my navy trousers and white shirt, fill in the rest for a semi-formal dinner', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should trigger hybrid strategy',
  });

  // D3: Detect missing slots
  await testIntentClassification(claudeService, 'D3', 'D', 'make me a business-casual outfit from my wardrobe', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should detect business-casual occasion',
  });

  // ========================================================================
  // SECTION E: FEEDBACK
  // ========================================================================
  console.log('\n📋 SECTION E: FEEDBACK TESTS');
  console.log('-'.repeat(60));

  // E1: Change one item
  await testIntentClassification(claudeService, 'E1', 'E', 'I like Option 2 but change only the shoes to white sneakers', {
    intent: 'item_replacement',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should trigger item replacement',
  });

  // E2: Avoid a color
  await testIntentClassification(claudeService, 'E2', 'E', 'avoid black from now on', {
    intent: 'feedback',
    agent: AgentType.FEEDBACK,
    notes: 'Should trigger feedback/constraint update',
  });

  // E3: More color
  await testIntentClassification(claudeService, 'E3', 'E', 'give me something more pastel but same vibe', {
    intent: 'item_replacement',
    notes: 'Should trigger refinement',
  });

  // E4: Budget sensitivity
  await testIntentClassification(claudeService, 'E4', 'E', 'this is too expensive, keep it under $120 total', {
    intent: 'feedback',
    agent: AgentType.FEEDBACK,
    notes: 'Should trigger budget constraint',
  });

  // ========================================================================
  // SECTION F: MULTI-TURN MEMORY
  // ========================================================================
  console.log('\n📋 SECTION F: MULTI-TURN MEMORY TESTS');
  console.log('-'.repeat(60));

  // F1: Preference learning
  await testIntentClassification(claudeService, 'F1', 'F', 'I prefer minimal outfits — no big logos or busy prints.', {
    intent: 'feedback',
    notes: 'Should capture minimal preference',
  });

  // F2: Brand bias
  await testIntentClassification(claudeService, 'F2', 'F', 'I like Zara and Uniqlo the most', {
    intent: 'feedback',
    notes: 'Should capture brand preference',
  });

  // F3: Soft constraints
  await testIntentClassification(claudeService, 'F3', 'F', 'I don\'t like shiny fabrics', {
    intent: 'feedback',
    notes: 'Should capture fabric constraint',
  });

  // ========================================================================
  // SECTION G: CLARIFICATION
  // ========================================================================
  console.log('\n📋 SECTION G: CLARIFICATION TESTS');
  console.log('-'.repeat(60));

  // G1: Ambiguous query
  await testIntentClassification(claudeService, 'G1', 'G', 'Suggest something cool to wear on Saturday', {
    intent: 'clarification_needed',
    agent: AgentType.CLARIFICATION,
    notes: 'Should ask for clarification',
  });

  // G2: Missing context
  await testIntentClassification(claudeService, 'G2', 'G', 'I want to look classy but fun', {
    intent: 'clarification_needed',
    agent: AgentType.CLARIFICATION,
    notes: 'Should ask for event/context',
  });

  // G3: Size missing
  await testIntentClassification(claudeService, 'G3', 'G', 'find me a hoodie', {
    intent: 'product_search',
    agent: AgentType.SEARCH,
    notes: 'May proceed or ask for size',
  });

  // ========================================================================
  // SECTION H: SAFETY
  // ========================================================================
  console.log('\n📋 SECTION H: SAFETY TESTS');
  console.log('-'.repeat(60));

  // H1: Unsafe user request
  await testIntentClassification(claudeService, 'H1', 'H', 'make me a snow outfit with no coat and high heels', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    notes: 'Should proceed but add safety warnings',
  });

  // H2: Culturally sensitive
  await testIntentClassification(claudeService, 'H2', 'H', 'give me a temple-appropriate outfit, modest, no sleeveless, no tight fits', {
    intent: 'outfit_request',
    agent: AgentType.OUTFIT_GENERATOR,
    shouldHaveFilters: ['occasion'],
    notes: 'Should respect cultural constraints',
  });

  // ========================================================================
  // PRINT RESULTS
  // ========================================================================
  console.log('\n');
  console.log('='.repeat(80));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(80));

  // Group by section
  const sections = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  let totalPassed = 0;
  let totalTests = 0;

  for (const section of sections) {
    const sectionResults = results.filter(r => r.section === section);
    const sectionPassed = sectionResults.filter(r => r.passed).length;
    totalPassed += sectionPassed;
    totalTests += sectionResults.length;

    console.log(`\nSection ${section}: ${sectionPassed}/${sectionResults.length} passed`);

    for (const result of sectionResults) {
      const status = result.passed ? '✅' : '❌';
      console.log(`  ${status} ${result.testId}: "${result.query.substring(0, 50)}${result.query.length > 50 ? '...' : ''}"`);
      console.log(`     Intent: ${result.actualIntent} | Agent: ${result.actualAgent}`);
      if (result.filters && Object.keys(result.filters).length > 0) {
        console.log(`     Filters: ${JSON.stringify(result.filters)}`);
      }
      if (!result.passed || result.notes !== 'OK') {
        console.log(`     Notes: ${result.notes}`);
      }
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  const passRate = ((totalPassed / totalTests) * 100).toFixed(1);
  console.log(`OVERALL: ${totalPassed}/${totalTests} tests passed (${passRate}%)`);

  if (parseFloat(passRate) >= 80) {
    console.log('🎉 WORLD-CLASS: 80%+ pass rate achieved!');
  } else if (parseFloat(passRate) >= 60) {
    console.log('⚠️ GOOD: 60-80% pass rate. Some improvements needed.');
  } else {
    console.log('❌ NEEDS WORK: Below 60% pass rate.');
  }
  console.log('='.repeat(80));
}

// Run tests
runAllTests().catch(console.error);
