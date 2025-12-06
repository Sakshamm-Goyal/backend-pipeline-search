import { Logger } from '@nestjs/common';
import { chromium, Browser, Page, BrowserContext, Route } from 'playwright';
import { BaseSearchSource } from '../sources/search-source.interface';
import { Product, SearchSource } from '../dto/product.dto';
import { SearchQuery } from '../dto/search-query.dto';

/**
 * Base Playwright Scraper
 *
 * Provides common scraping functionality for all retail scrapers.
 * Handles browser management, anti-detection, and retry logic.
 *
 * Key features:
 * - Browser pooling (reuse browsers)
 * - Stealth mode (avoid detection)
 * - Smart waiting (wait for content to load)
 * - Screenshot on failure (debugging)
 * - Automatic cleanup
 */
export abstract class BaseScraperService extends BaseSearchSource {
  protected readonly logger: Logger;

  // Browser pool
  private static browser: Browser | null = null;
  private static contextPool: BrowserContext[] = [];
  private static readonly MAX_CONTEXTS = 5;

  // Scraper configuration
  // Individual timeout per source (public to match ISearchSource interface)
  readonly timeout = 30000; // 30s default for scrapers
  protected readonly waitForSelector: string = 'body'; // Override in subclasses

  constructor() {
    super();
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Abstract methods to be implemented by each scraper
   */
  abstract search(query: SearchQuery): Promise<Product[]>;
  protected abstract buildSearchUrl(query: SearchQuery): string;
  protected abstract parseProductList(page: Page): Promise<Product[]>;

  /**
   * Get or create browser instance (singleton)
   */
  protected async getBrowser(): Promise<Browser> {
    if (!BaseScraperService.browser) {
      this.logger.debug('Launching new browser instance');

      BaseScraperService.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });

      // Cleanup on process exit
      process.on('beforeExit', async () => {
        await this.closeBrowser();
      });
    }

    return BaseScraperService.browser;
  }

  /**
   * Get or create browser context (with stealth features)
   */
  protected async getContext(): Promise<BrowserContext> {
    // Reuse existing context if available
    if (BaseScraperService.contextPool.length > 0) {
      const context = BaseScraperService.contextPool.pop()!;
      return context;
    }

    // Create new context with stealth settings
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: [],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });

    // Block unnecessary resources for faster scraping
    await context.route('**/*', (route: Route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    return context;
  }

  /**
   * Return context to pool for reuse
   */
  protected async returnContext(context: BrowserContext): Promise<void> {
    // Clear cookies and storage
    await context.clearCookies();

    // Add back to pool if not full
    if (BaseScraperService.contextPool.length < BaseScraperService.MAX_CONTEXTS) {
      BaseScraperService.contextPool.push(context);
    } else {
      await context.close();
    }
  }

  /**
   * Create a new page with anti-detection measures
   */
  protected async createPage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();

    // Override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    // Set realistic properties
    await page.addInitScript(() => {
      (window.navigator as any).chrome = {
        runtime: {},
      };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    return page;
  }

  /**
   * Navigate to URL with retry logic
   */
  protected async navigateWithRetry(
    page: Page,
    url: string,
    maxRetries: number = 3,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Navigating to ${url} (attempt ${attempt}/${maxRetries})`);

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });

        // Wait for body to be ready
        await page.waitForSelector(this.waitForSelector, {
          timeout: this.timeout,
        });

        return; // Success
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Navigation attempt ${attempt} failed: ${(error as Error).message}`,
        );

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = 1000 * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `Failed to navigate after ${maxRetries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Smart scroll to load lazy-loaded content
   */
  protected async scrollToLoadMore(
    page: Page,
    maxScrolls: number = 3,
  ): Promise<void> {
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for content to load
      await this.sleep(1000);
    }
  }

  /**
   * Wait for network to be idle (no ongoing requests)
   */
  protected async waitForNetworkIdle(
    page: Page,
    timeout: number = 5000,
  ): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout });
    } catch {
      // Timeout is acceptable, continue anyway
      this.logger.debug('Network idle timeout, continuing...');
    }
  }

  /**
   * Take screenshot for debugging (on failure)
   */
  protected async takeScreenshot(
    page: Page,
    name: string,
  ): Promise<void> {
    try {
      const filename = `/tmp/scraper-${name}-${Date.now()}.png`;
      await page.screenshot({ path: filename, fullPage: true });
      this.logger.debug(`Screenshot saved: ${filename}`);
    } catch (error) {
      this.logger.warn(`Failed to take screenshot: ${(error as Error).message}`);
    }
  }

  /**
   * Extract text from element safely
   */
  protected async extractText(
    page: Page,
    selector: string,
  ): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;

      const text = await element.textContent();
      return text?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract attribute from element safely
   */
  protected async extractAttribute(
    page: Page,
    selector: string,
    attribute: string,
  ): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;

      return await element.getAttribute(attribute);
    } catch {
      return null;
    }
  }

  /**
   * Parse price from string
   */
  protected parsePrice(priceStr: string | null): number {
    if (!priceStr) return 0;

    // Remove currency symbols and extract number
    const cleaned = priceStr.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }

  /**
   * Close browser (cleanup)
   */
  protected async closeBrowser(): Promise<void> {
    if (BaseScraperService.browser) {
      this.logger.debug('Closing browser');

      // Close all contexts
      for (const context of BaseScraperService.contextPool) {
        await context.close();
      }
      BaseScraperService.contextPool = [];

      await BaseScraperService.browser.close();
      BaseScraperService.browser = null;
    }
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Random delay (humanize behavior)
   */
  protected async randomDelay(minMs: number = 500, maxMs: number = 2000): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.sleep(delay);
  }

  /**
   * Health check: verify scraper can access the site
   */
  async healthCheck(): Promise<boolean> {
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.getContext();
      page = await this.createPage(context);

      // Try a simple test query
      const testQuery: SearchQuery = {
        terms: 'dress',
        limit: 1,
      };

      const url = this.buildSearchUrl(testQuery);
      await this.navigateWithRetry(page, url, 1);

      return true;
    } catch (error) {
      this.logger.error(`Health check failed: ${(error as Error).message}`);
      return false;
    } finally {
      if (page) await page.close();
      if (context) await this.returnContext(context);
    }
  }
}
