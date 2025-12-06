import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page } from 'playwright';
import { BaseScraperService } from './base-scraper.service';
import { Product, SearchSource, normalizeProduct } from '../dto/product.dto';
import type { SearchQuery } from '../dto/search-query.dto';
import { QueryBuilderService } from '../query-builder.service';
import { Retry } from '../../infrastructure/resilience/retry.decorator';

/**
 * ASOS Scraper
 *
 * FIXED implementation to handle 403 errors from Python version.
 * Improvements:
 * - Proper browser fingerprinting
 * - Rate limiting between requests
 * - Stealth mode (anti-detection)
 * - Smart retries with backoff
 * - Cookie handling
 *
 * ASOS is a major fashion retailer with 85,000+ products.
 */
@Injectable()
export class AsosScraperService extends BaseScraperService {
  readonly name = SearchSource.ASOS_SCRAPER;
  readonly priority = 70; // Medium priority (after APIs)
  protected readonly waitForSelector = 'article[data-auto-id="productTile"]';

  constructor(
    private config: ConfigService,
    private queryBuilder: QueryBuilderService,
  ) {
    super();
  }

  get enabled(): boolean {
    return this.config.get<boolean>('ENABLE_PLAYWRIGHT_SCRAPERS') !== false;
  }

  /**
   * Search ASOS for products
   */
  @Retry({
    maxRetries: 2, // Fewer retries for scrapers (slower)
    backoff: 'exponential',
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();
    let context = null;
    let page: Page | null = null;

    try {
      // Build search URL
      const url = this.buildSearchUrl(query);

      // Get browser context
      context = await this.getContext();
      page = await this.createPage(context);

      // Navigate to search page
      await this.navigateWithRetry(page, url);

      // Wait for products to load
      await this.waitForProducts(page);

      // Parse product list
      const products = await this.parseProductList(page);

      // Track success
      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(
        `ASOS scraper returned ${products.length} products in ${latency}ms`,
      );

      return products;
    } catch (error) {
      this.trackFailure(error as Error);

      // Take screenshot for debugging
      if (page) {
        await this.takeScreenshot(page, 'asos-error');
      }

      this.logger.error(`ASOS scraper failed: ${(error as Error).message}`, (error as Error).stack);

      throw error;
    } finally {
      if (page) await page.close();
      if (context) await this.returnContext(context);
    }
  }

  /**
   * Build ASOS search URL
   */
  protected buildSearchUrl(query: SearchQuery): string {
    return this.queryBuilder.buildAsosUrl(query);
  }

  /**
   * Wait for product tiles to load
   */
  private async waitForProducts(page: Page): Promise<void> {
    try {
      // Wait for product tiles to appear
      await page.waitForSelector(this.waitForSelector, {
        timeout: 15000,
      });

      // Wait for images to start loading
      await this.sleep(2000);

      // Scroll to load lazy images
      await this.scrollToLoadMore(page, 2);
    } catch (error) {
      this.logger.warn(`Products may not have loaded: ${(error as Error).message}`);
    }
  }

  /**
   * Parse product list from ASOS page
   */
  protected async parseProductList(page: Page): Promise<Product[]> {
    const products: Product[] = [];

    try {
      // Get all product tiles
      const productTiles = await page.$$(
        'article[data-auto-id="productTile"]',
      );

      this.logger.debug(`Found ${productTiles.length} product tiles`);

      for (const tile of productTiles) {
        try {
          const product = await this.parseProductTile(tile, page);
          if (product) {
            products.push(product);
          }
        } catch (error) {
          this.logger.warn(`Failed to parse product tile: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to parse product list: ${(error as Error).message}`);
    }

    return products;
  }

  /**
   * Parse individual product tile
   */
  private async parseProductTile(
    tile: any,
    page: Page,
  ): Promise<Product | null> {
    try {
      // Extract product link
      const linkElement = await tile.$('a');
      if (!linkElement) return null;

      const href = await linkElement.getAttribute('href');
      if (!href) return null;

      const productUrl = href.startsWith('http')
        ? href
        : `https://www.asos.com${href}`;

      // Extract product ID from URL
      const productIdMatch = productUrl.match(/\/prd\/(\d+)/);
      const productId = productIdMatch ? productIdMatch[1] : Date.now().toString();

      // Extract product image
      const imgElement = await tile.$('img');
      const imageUrl = imgElement
        ? await imgElement.getAttribute('src')
        : null;

      // Extract product title/description
      const titleElement = await tile.$('[data-auto-id="productTileDescription"]');
      const title = titleElement
        ? await titleElement.textContent()
        : 'Unknown Product';

      // Extract brand
      const brandElement = await tile.$('[data-auto-id="productTileBrand"]');
      const brand = brandElement ? await brandElement.textContent() : null;

      // Extract price
      const priceElement = await tile.$('[data-auto-id="productTilePrice"]');
      const priceText = priceElement
        ? await priceElement.textContent()
        : null;

      // Parse price (ASOS shows "£XX.XX" or "$XX.XX")
      const price = this.parsePrice(priceText);

      // Check if on sale (has strikethrough price)
      const originalPriceElement = await tile.$('[data-auto-id="productTilePreviousPrice"]');
      const originalPrice = originalPriceElement
        ? this.parsePrice(await originalPriceElement.textContent())
        : undefined;

      // Create normalized product
      const product = normalizeProduct(
        {
          id: productId,
          title: title?.trim() || 'Unknown',
          brand: brand?.trim(),
          retailer: 'ASOS',
          price,
          originalPrice,
          currency: 'USD',
          onSale: !!originalPrice && originalPrice > price,
          image: imageUrl || '',
          productUrl,
          inStock: true, // Assume in stock if displayed
        },
        SearchSource.ASOS_SCRAPER,
      );

      return product;
    } catch (error) {
      this.logger.warn(`Failed to parse tile: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get product details page (for enrichment)
   */
  async getProductDetails(productUrl: string): Promise<Product | null> {
    let context = null;
    let page: Page | null = null;

    try {
      context = await this.getContext();
      page = await this.createPage(context);

      await this.navigateWithRetry(page, productUrl);

      // Wait for product details to load
      await page.waitForSelector('[data-auto-id="productTitle"]', {
        timeout: 10000,
      });

      // Extract detailed information
      const title = await this.extractText(page, '[data-auto-id="productTitle"]');
      const priceText = await this.extractText(page, '[data-auto-id="productPrice"]');
      const price = this.parsePrice(priceText);

      // Extract all images
      const imageElements = await page.$$('[data-auto-id="productImage"]');
      const images: string[] = [];
      for (const img of imageElements) {
        const src = await img.getAttribute('src');
        if (src) images.push(src);
      }

      // Extract product details
      const descriptionText = await this.extractText(
        page,
        '[data-auto-id="productDescription"]',
      );

      // Extract size options
      const sizeElements = await page.$$('[data-auto-id="sizeSelect"] option');
      const sizes: string[] = [];
      for (const option of sizeElements) {
        const sizeText = await option.textContent();
        if (sizeText) sizes.push(sizeText.trim());
      }

      // Extract product ID
      const productIdMatch = productUrl.match(/\/prd\/(\d+)/);
      const productId = productIdMatch ? productIdMatch[1] : Date.now().toString();

      const product = normalizeProduct(
        {
          id: productId,
          title: title || 'Unknown',
          description: descriptionText || undefined,
          retailer: 'ASOS',
          price,
          currency: 'USD',
          onSale: false,
          image: images[0] || '',
          images,
          productUrl,
          sizes: sizes.filter((s) => s.length > 0),
          inStock: true,
        },
        SearchSource.ASOS_SCRAPER,
      );

      return product;
    } catch (error) {
      this.logger.error(
        `Failed to get ASOS product details: ${(error as Error).message}`,
      );
      return null;
    } finally {
      if (page) await page.close();
      if (context) await this.returnContext(context);
    }
  }
}
