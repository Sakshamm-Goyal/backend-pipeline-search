/**
 * Slot-Category Mapping Service
 *
 * Centralized validation for outfit slot assignments.
 * Ensures products are placed in correct slots based on their category/type.
 *
 * Problem this solves:
 * - LLM (Gemini/Claude) returns arbitrary slot names that don't match slotProducts Map keys
 * - Pants appearing in "outerwear" slot, jackets in "bottom" slot, etc.
 * - No validation that product category matches assigned slot
 *
 * Solution:
 * - Define valid categories for each slot
 * - Provide functions to validate and correct slot assignments
 * - Normalize LLM slot names to valid slot keys
 */

import { Product } from '../search/dto/product.dto';

/**
 * Mapping from slot name to valid product categories
 * Used to validate that a product belongs in a given slot
 */
export const SLOT_TO_CATEGORIES: Record<string, string[]> = {
  // Main garments
  dress: [
    'dress', 'gown', 'jumpsuit', 'romper', 'one-piece', 'maxi', 'midi',
    'mini', 'evening dress', 'cocktail dress', 'party dress', 'formal dress',
  ],
  top: [
    'top', 'shirt', 'blouse', 'sweater', 'tee', 't-shirt', 'polo', 'tank',
    'camisole', 'cardigan', 'pullover', 'hoodie', 'crop top', 'tunic',
    'button-down', 'henley', 'vest top',
    // CRITICAL: "dress shirt" is a TOP, not a dress!
    'dress shirt', 'oxford shirt', 'button-up shirt', 'formal shirt',
  ],
  bottom: [
    'bottom', 'pants', 'jeans', 'trousers', 'skirt', 'shorts', 'leggings',
    'chinos', 'slacks', 'culottes', 'palazzo', 'joggers', 'cargo pants',
    'dress pants', 'suit pants', 'suit trousers',
  ],
  outerwear: [
    'outerwear', 'jacket', 'blazer', 'coat', 'cardigan', 'vest', 'bomber',
    'parka', 'trench', 'denim jacket', 'leather jacket', 'suit jacket',
    'sport coat', 'overcoat', 'windbreaker', 'puffer', 'fleece',
    // Add "suit" patterns (suits go in outerwear slot, NOT top)
    'suit', 'regular suit', 'slim suit', 'formal suit', 'business suit',
    'wedding suit', 'tuxedo', 'tux', 'double breasted',
  ],

  // Footwear
  shoes: [
    'shoes', 'heels', 'sneakers', 'sandals', 'boots', 'loafers', 'flats',
    'footwear', 'pumps', 'stilettos', 'wedges', 'mules', 'oxfords', 'oxford',
    'brogues', 'brogue', 'derbys', 'derby', 'espadrilles', 'slip-ons', 'trainers', 'high heels',
    'ankle boots', 'knee boots', 'chelsea boots', 'dress shoes',
    // Men's formal shoe patterns
    'cap toe', 'wingtip', 'monk strap', 'penny loafer',
  ],

  // Accessories
  bag: [
    'bag', 'clutch', 'purse', 'handbag', 'tote', 'crossbody', 'satchel',
    'backpack', 'messenger', 'shoulder bag', 'evening bag', 'pouch',
    'wallet', 'briefcase',
  ],
  jewelry: [
    'jewelry', 'necklace', 'earrings', 'bracelet', 'ring', 'pendant',
    'chain', 'choker', 'studs', 'hoops', 'drop earrings', 'bangle',
    'cuff', 'anklet', 'brooch', 'statement jewelry',
  ],
  watch: [
    'watch', 'wristwatch', 'timepiece', 'smartwatch', 'analog watch',
    'digital watch', 'dress watch', 'chronograph',
  ],
  belt: [
    'belt', 'waist belt', 'leather belt', 'dress belt', 'casual belt',
    'chain belt', 'woven belt',
  ],
  sunglasses: [
    'sunglasses', 'eyewear', 'shades', 'aviators', 'wayfarers',
    'cat-eye', 'round sunglasses', 'oversized sunglasses',
  ],
  scarf: [
    'scarf', 'shawl', 'wrap', 'pashmina', 'silk scarf', 'neck scarf',
  ],
  hat: [
    'hat', 'cap', 'beanie', 'fedora', 'beret', 'sun hat', 'bucket hat',
  ],

  // Generic accessory slot (catches misc accessories)
  accessories: [
    'accessory', 'accessories', 'tie', 'bow tie', 'pocket square',
    'cufflinks', 'hair accessory', 'headband', 'hair clip',
  ],
};

/**
 * Reverse mapping: category keyword -> valid slot
 * Built at module load time for fast lookup
 */
export const CATEGORY_TO_SLOT: Record<string, string> = {};

// Build the reverse mapping
for (const [slot, categories] of Object.entries(SLOT_TO_CATEGORIES)) {
  for (const category of categories) {
    CATEGORY_TO_SLOT[category.toLowerCase()] = slot;
  }
}

/**
 * LLM slot name variations that should be normalized
 * Maps common LLM-returned slot names to our canonical slot keys
 */
export const SLOT_NAME_ALIASES: Record<string, string> = {
  // Dress variations
  'dress': 'dress',
  'dresses': 'dress',
  'gown': 'dress',
  'one-piece': 'dress',
  'one_piece': 'dress',
  'onepiece': 'dress',

  // Top variations
  'top': 'top',
  'tops': 'top',
  'shirt': 'top',
  'blouse': 'top',
  'sweater': 'top',
  'dress_shirt': 'top',  // CRITICAL: "dress shirt" is a top, NOT a dress
  'dress shirt': 'top',
  'oxford_shirt': 'top',
  'formal_shirt': 'top',

  // Bottom variations
  'bottom': 'bottom',
  'bottoms': 'bottom',
  'pants': 'bottom',
  'jeans': 'bottom',
  'trousers': 'bottom',
  'skirt': 'bottom',
  'shorts': 'bottom',

  // Outerwear variations
  'outerwear': 'outerwear',
  'outer_wear': 'outerwear',
  'jacket': 'outerwear',
  'blazer': 'outerwear',
  'coat': 'outerwear',
  'layer': 'outerwear',
  'layering': 'outerwear',

  // Outerwear - additional aliases (suits are outerwear!)
  'suit': 'outerwear',
  'suits': 'outerwear',
  'tuxedo': 'outerwear',

  // Shoes variations
  'shoes': 'shoes',
  'shoe': 'shoes',
  'footwear': 'shoes',
  'heels': 'shoes',
  'sneakers': 'shoes',
  'boots': 'shoes',
  'sandals': 'shoes',
  'loafers': 'shoes',
  'oxford': 'shoes',
  'oxfords': 'shoes',
  'brogues': 'shoes',
  'wingtip': 'shoes',

  // Bag variations
  'bag': 'bag',
  'bags': 'bag',
  'clutch': 'bag',
  'purse': 'bag',
  'handbag': 'bag',
  'tote': 'bag',

  // Jewelry variations
  'jewelry': 'jewelry',
  'jewellery': 'jewelry',
  'necklace': 'jewelry',
  'earrings': 'jewelry',
  'bracelet': 'jewelry',

  // Watch variations
  'watch': 'watch',
  'watches': 'watch',
  'wristwatch': 'watch',
  'timepiece': 'watch',

  // Belt variations
  'belt': 'belt',
  'belts': 'belt',

  // Sunglasses variations
  'sunglasses': 'sunglasses',
  'eyewear': 'sunglasses',
  'shades': 'sunglasses',

  // Scarf variations
  'scarf': 'scarf',
  'scarves': 'scarf',

  // Hat variations
  'hat': 'hat',
  'hats': 'hat',
  'cap': 'hat',

  // Generic accessory
  'accessory': 'accessories',
  'accessories': 'accessories',
};

/**
 * Normalize a slot name from LLM response to our canonical slot key
 *
 * @param rawSlot - The slot name returned by LLM (may be uppercase, plural, etc.)
 * @returns Normalized slot name or the original if no mapping found
 */
export function normalizeSlotName(rawSlot: string): string {
  if (!rawSlot) return '';

  const normalized = rawSlot.toLowerCase().trim().replace(/\s+/g, '_');

  // Check if we have a direct alias
  if (SLOT_NAME_ALIASES[normalized]) {
    return SLOT_NAME_ALIASES[normalized];
  }

  // Check if it's already a valid slot key
  if (SLOT_TO_CATEGORIES[normalized]) {
    return normalized;
  }

  // Try to find partial match
  for (const [alias, slot] of Object.entries(SLOT_NAME_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return slot;
    }
  }

  // Return as-is (will likely fail validation but at least we tried)
  return normalized;
}

/**
 * Check if a product title/category matches a given slot
 *
 * CRITICAL FIX: Uses detectProductSlot FIRST to check compound terms
 * This ensures "suit pants" → bottom (not outerwear), "dress shirt" → top (not dress)
 *
 * @param product - The product to validate
 * @param slotName - The slot to validate against
 * @returns true if product belongs in this slot
 */
export function validateItemForSlot(product: Product, slotName: string): boolean {
  if (!product || !slotName) return false;

  const normalizedSlot = normalizeSlotName(slotName);
  const validCategories = SLOT_TO_CATEGORIES[normalizedSlot];

  if (!validCategories) {
    // Unknown slot, can't validate
    return true; // Allow by default for unknown slots
  }

  // CRITICAL: Check compound terms FIRST using detectProductSlot
  // This handles "suit pants" → bottom, "dress shirt" → top, etc.
  // Must be done BEFORE single-word matching or "suit pants" would match "suit" in outerwear
  const detectedSlot = detectProductSlot(product);
  if (detectedSlot) {
    // Product has a clear slot detected - verify it matches the requested slot
    if (detectedSlot !== normalizedSlot) {
      // Product CLEARLY belongs in a different slot
      // e.g., "suit pants" detected as "bottom" but slot is "outerwear"
      return false;
    }
    // Product detected slot matches - it's valid
    return true;
  }

  // No compound term match found - fall back to single-word category matching
  // Get product identifiers to check
  const title = (product.title || '').toLowerCase();
  const category = (product.category || '').toLowerCase();
  const itemType = ((product as any).itemType || '').toLowerCase();

  // Check if any valid category appears in product data
  for (const validCategory of validCategories) {
    const categoryLower = validCategory.toLowerCase();
    if (
      title.includes(categoryLower) ||
      category.includes(categoryLower) ||
      itemType.includes(categoryLower)
    ) {
      return true;
    }
  }

  // No clear match found - reject it (be strict to avoid misplaced items)
  return false;
}

/**
 * Detect which slot a product should belong to based on its title/category
 *
 * @param product - The product to analyze
 * @returns The detected slot name, or null if unclear
 */
export function detectProductSlot(product: Product): string | null {
  if (!product) return null;

  const searchText = [
    product.title || '',
    product.category || '',
    (product as any).itemType || '',
  ].join(' ').toLowerCase();

  // CRITICAL: Check for compound terms FIRST to avoid false matches
  // "dress shirt" should be detected as "top", not "dress"
  // "suit pants" should be detected as "bottom", not "outerwear"
  // Order matters: more specific patterns should come first
  const compoundTermPriority: Array<{ term: string; slot: string }> = [
    // PANTS patterns - MUST come before single-word "suit"
    // NOTE: Check for explicit "pants" or "trousers" word to disambiguate
    { term: 'suit pants', slot: 'bottom' },
    { term: 'suit pant', slot: 'bottom' },  // singular
    { term: 'suit trousers', slot: 'bottom' },
    { term: 'suit trouser', slot: 'bottom' }, // singular
    { term: 'dress pants', slot: 'bottom' },
    { term: 'dress pant', slot: 'bottom' },
    { term: 'formal pants', slot: 'bottom' },
    { term: 'formal trousers', slot: 'bottom' },
    { term: 'wedding pants', slot: 'bottom' },
    { term: 'wedding trousers', slot: 'bottom' },
    { term: 'skinny pants', slot: 'bottom' },
    { term: 'slim pants', slot: 'bottom' },
    { term: 'slim trousers', slot: 'bottom' },
    { term: 'tailored pants', slot: 'bottom' },
    { term: 'tailored trousers', slot: 'bottom' },

    // JACKET patterns - MUST come before single-word "suit"
    { term: 'suit jacket', slot: 'outerwear' },
    { term: 'sport coat', slot: 'outerwear' },
    { term: 'sport jacket', slot: 'outerwear' },
    { term: 'suit blazer', slot: 'outerwear' },
    { term: 'wedding blazer', slot: 'outerwear' },
    { term: 'wedding jacket', slot: 'outerwear' },

    // SHIRT patterns (not dress)
    { term: 'dress shirt', slot: 'top' },
    { term: 'oxford shirt', slot: 'top' },
    { term: 'button-up shirt', slot: 'top' },
    { term: 'button down shirt', slot: 'top' },
    { term: 'button up shirt', slot: 'top' },
    { term: 'formal shirt', slot: 'top' },
    { term: 'wedding shirt', slot: 'top' },
    { term: 'textured shirt', slot: 'top' },
    { term: 'slim fit shirt', slot: 'top' },
    { term: 'regular fit shirt', slot: 'top' },

    // DRESS patterns (actual dresses)
    { term: 'dress shoes', slot: 'shoes' },
    { term: 'dress shoe', slot: 'shoes' },
    { term: 'evening dress', slot: 'dress' },
    { term: 'cocktail dress', slot: 'dress' },
    { term: 'party dress', slot: 'dress' },
    { term: 'formal dress', slot: 'dress' },
    { term: 'maxi dress', slot: 'dress' },
    { term: 'midi dress', slot: 'dress' },
    { term: 'mini dress', slot: 'dress' },
    { term: 'wrap dress', slot: 'dress' },
  ];

  // Check compound terms first (they take priority)
  for (const { term, slot } of compoundTermPriority) {
    if (searchText.includes(term)) {
      return slot;
    }
  }

  // Check each slot's categories
  let bestMatch: { slot: string; score: number } | null = null;

  for (const [slot, categories] of Object.entries(SLOT_TO_CATEGORIES)) {
    for (const category of categories) {
      const categoryLower = category.toLowerCase();
      // Use word boundary matching for better accuracy
      const regex = new RegExp(`\\b${categoryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(searchText)) {
        // Score based on category specificity (longer = more specific = better)
        const score = categoryLower.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { slot, score };
        }
      }
    }
  }

  return bestMatch?.slot || null;
}

/**
 * Get the correct slot for a product, validating it belongs there
 *
 * @param product - The product to find slot for
 * @param preferredSlot - The slot LLM suggested (optional)
 * @returns The best slot for this product
 */
export function getValidSlotForProduct(product: Product, preferredSlot?: string): string {
  // First, try the preferred slot if given
  if (preferredSlot) {
    const normalizedPreferred = normalizeSlotName(preferredSlot);
    if (validateItemForSlot(product, normalizedPreferred)) {
      return normalizedPreferred;
    }
  }

  // Detect the best slot based on product data
  const detectedSlot = detectProductSlot(product);
  if (detectedSlot) {
    return detectedSlot;
  }

  // Fallback to preferred slot if detection failed
  if (preferredSlot) {
    return normalizeSlotName(preferredSlot);
  }

  // Ultimate fallback
  return 'accessories';
}

/**
 * Validate and correct an entire outfit's slot assignments
 *
 * @param outfitItems - Array of outfit items with slot and productId
 * @param slotProducts - Map of slot name to available products
 * @returns Corrected outfit items with validated slots
 */
export function validateAndCorrectOutfitSlots(
  outfitItems: Array<{ slot: string; productId: string; [key: string]: any }>,
  slotProducts: Map<string, Product[]>,
): Array<{ slot: string; productId: string; [key: string]: any }> {
  const validSlotKeys = new Set(slotProducts.keys());

  return outfitItems.map(item => {
    const normalizedSlot = normalizeSlotName(item.slot);

    // Check if slot is valid in our product map
    if (!validSlotKeys.has(normalizedSlot)) {
      // Try to find the product and determine correct slot
      const product = findProductById(item.productId, slotProducts);

      if (product) {
        const correctSlot = getValidSlotForProduct(product, item.slot);
        if (validSlotKeys.has(correctSlot)) {
          return { ...item, slot: correctSlot };
        }
      }

      // If we can't find a valid slot, normalize what we have
      return { ...item, slot: normalizedSlot };
    }

    // Slot is valid, but verify product belongs there
    const product = findProductById(item.productId, slotProducts);
    if (product) {
      const correctSlot = getValidSlotForProduct(product, normalizedSlot);
      if (correctSlot !== normalizedSlot && validSlotKeys.has(correctSlot)) {
        // Product belongs in a different slot
        return { ...item, slot: correctSlot };
      }
    }

    return { ...item, slot: normalizedSlot };
  });
}

/**
 * Find a product by ID across all slot products
 *
 * @param productId - The product ID to find
 * @param slotProducts - Map of slot name to products
 * @returns The found product or undefined
 */
function findProductById(
  productId: string,
  slotProducts: Map<string, Product[]>,
): Product | undefined {
  for (const products of slotProducts.values()) {
    const found = products.find(
      p => p.id === productId || p.sourceId === productId
    );
    if (found) return found;
  }
  return undefined;
}

/**
 * Get list of valid slot names for prompt generation
 * Useful for constraining LLM output
 *
 * @param availableSlots - Set of slots that have products available
 * @returns Array of valid slot names
 */
export function getValidSlotNamesForPrompt(availableSlots: Set<string>): string[] {
  return Array.from(availableSlots).filter(slot =>
    SLOT_TO_CATEGORIES.hasOwnProperty(slot)
  );
}

/**
 * Generate slot constraints text for LLM prompt
 * Helps LLM understand which slots it can use
 *
 * @param slotProducts - Map of available slots to products
 * @returns Constraint text for prompt
 */
export function generateSlotConstraintsForPrompt(slotProducts: Map<string, Product[]>): string {
  const availableSlots = Array.from(slotProducts.keys());

  const lines = [
    'CRITICAL SLOT RULES - READ CAREFULLY:',
    `- You can ONLY use these slot names: [${availableSlots.join(', ')}]`,
    '- Do NOT use any slot names not listed above',
    '- Match the productId to the slot it appears under in the product list',
    '',
    'SLOT ASSIGNMENT RULES:',
    '- Pants, jeans, trousers, skirts, shorts → ALWAYS use slot "bottom"',
    '- Jackets, blazers, coats → ALWAYS use slot "outerwear" (only if outerwear available)',
    '- Heels, sneakers, boots, sandals → ALWAYS use slot "shoes"',
    '- Necklaces, earrings, bracelets → ALWAYS use slot "jewelry"',
    '- Clutches, purses, handbags → ALWAYS use slot "bag"',
    '- Watches → ALWAYS use slot "watch"',
    '',
    '- NEVER put pants/trousers in "outerwear" slot',
    '- NEVER put jewelry in "bag" slot',
    '- ALWAYS match product to its listed slot in the product list above',
  ];

  return lines.join('\n');
}
