import puppeteer, { Browser, Page } from 'puppeteer';
import { LinkAnalysisResult } from '../models/ManualLink';
import { getRandomUserAgent } from '../config/userAgents';
import { ScrapeDoService } from './scrapeDoService';

export interface AnalysisOptions {
  timeout?: number;
  userAgent?: string;
  viewport?: { width: number; height: number };
  waitForSelector?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
}

export class LinkAnalyzer {
  private static browser: Browser | null = null;
  private static isInitialized = false;

  // Инициализация браузера
  static async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection'
        ]
      });

      this.isInitialized = true;
      console.log('Puppeteer browser initialized');
    } catch (error) {
      console.error('Failed to initialize Puppeteer browser:', error);
      throw error;
    }
  }

  // Закрытие браузера
  static async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isInitialized = false;
      console.log('Puppeteer browser closed');
    }
  }



  // Основной метод анализа ссылки
  static async analyzeLink(url: string, targetDomain: string, options: AnalysisOptions = {}): Promise<LinkAnalysisResult> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      // Создаем новый браузер для каждой ссылки
      const userAgent = getRandomUserAgent();
      console.log(`🔍 Analyzing ${url} with User-Agent: ${userAgent.substring(0, 50)}...`);
      
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-images',
          '--disable-css',
          '--disable-fonts'
        ]
      });

      page = await browser.newPage();
      
      const {
        timeout = 60000, // Увеличиваем таймаут до 60 секунд
        followRedirects = true,
        maxRedirects = 5
      } = options;

      // Установка User-Agent
      await page.setUserAgent(userAgent);
      
      // Установка таймаута
      page.setDefaultTimeout(timeout);

      // Отслеживание редиректов и X-Robots-Tag
      let redirectCount = 0;
      let finalUrl = url;
      let xRobotsTag: string | undefined;

      page.on('response', (response) => {
        // Проверяем только основной HTML ответ (не ресурсы)
        const responseUrl = response.url();
        const isMainResponse = responseUrl === url || responseUrl.includes(new URL(url).hostname);
        
        if (followRedirects && redirectCount < maxRedirects && isMainResponse) {
          const status = response.status();
          if (status >= 300 && status < 400) {
            redirectCount++;
            const location = response.headers()['location'];
            if (location) {
              finalUrl = location.startsWith('http') ? location : new URL(location, url).href;
            }
          }
        }
        
        // Сохраняем X-Robots-Tag заголовок только от основного HTML ответа
        if (isMainResponse) {
          const xRobots = response.headers()['x-robots-tag'];
          if (xRobots) {
            console.log(`🔍 Found X-Robots-Tag: ${xRobots} from ${responseUrl}`);
            xRobotsTag = xRobots;
          }
        }
      });

      // Первая попытка загрузки страницы
      console.log(`📄 Loading page: ${url}`);
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded', // Используем domcontentloaded для ускорения
        timeout 
      });

      const responseCode = response?.status() || 0;
      console.log(`📊 Response code: ${responseCode}`);

      // Дополнительно проверяем X-Robots-Tag от финального response
      if (response) {
        const finalXRobots = response.headers()['x-robots-tag'];
        if (finalXRobots) {
          console.log(`🔍 Final X-Robots-Tag from main response: ${finalXRobots}`);
          xRobotsTag = finalXRobots;
        }
      }

      // Проверка на ошибки HTTP - пробуем scrape.do fallback только для 403 (блокировки/капча)
      if (!response || responseCode >= 400) {
        if (responseCode === 403) {
          console.log(`🚫 HTTP 403 (blocked/captcha), trying scrape.do fallback...`);
          const scrapeDoResult = await this.analyzeWithScrapeDo(url, targetDomain, url);
          
          if (scrapeDoResult.linkType && scrapeDoResult.linkType !== 'not_found') {
            console.log(`✅ Scrape.do found link despite HTTP 403!`);
            return {
              status: scrapeDoResult.status || 'OK',
              responseCode, // Сохраняем оригинальный код
              indexable: scrapeDoResult.indexable || true,
              linkType: scrapeDoResult.linkType,
              ...(scrapeDoResult.canonicalUrl && { canonicalUrl: scrapeDoResult.canonicalUrl }),
              ...(scrapeDoResult.fullATag && { fullATag: scrapeDoResult.fullATag }),
              ...(scrapeDoResult.nonIndexableReason && { nonIndexableReason: scrapeDoResult.nonIndexableReason }),
              loadTime: Date.now() - startTime
            };
          } else {
            console.log(`❌ Scrape.do also failed for HTTP 403`);
            console.log(`💡 This site has extremely strong anti-bot protection`);
            console.log(`🔒 Even scrape.do with IP rotation couldn't bypass it`);
            return {
              status: 'Problem',
              responseCode,
              indexable: false,
              linkType: 'not_found',
              loadTime: Date.now() - startTime,
              error: `HTTP ${responseCode} error - site blocks all scrapers`
            };
          }
        } else {
          // Для 404, 500 и других ошибок - не используем scrape.do
          console.log(`❌ HTTP Error: ${responseCode} (not using scrape.do fallback)`);
          return {
            status: 'Problem',
            responseCode,
            indexable: false,
            linkType: 'not_found',
            loadTime: Date.now() - startTime,
            error: `HTTP ${responseCode} error`
          };
        }
      }

      // Ждем полной загрузки
      await page.waitForTimeout(3000);

      // Анализ содержимого страницы
      console.log(`🔍 Analyzing page content...`);
      const analysisResult = await this.analyzePageContent(page, targetDomain, finalUrl, xRobotsTag);
      
      // Если ссылка не найдена, пробуем перезагрузить страницу
      if (!analysisResult.linkType || analysisResult.linkType === 'not_found') {
        console.log(`🔄 Link not found, reloading page...`);
        
        // Перезагружаем страницу
        await page.reload({ waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(5000);
        
        // Прокручиваем страницу вниз для загрузки динамического контента
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(2000);
        
        // Повторный анализ
        const retryAnalysisResult = await this.analyzePageContent(page, targetDomain, finalUrl, xRobotsTag);
        
        // Используем результат повторного анализа
        if (retryAnalysisResult.linkType && retryAnalysisResult.linkType !== 'not_found') {
          console.log(`✅ Link found on retry!`);
          Object.assign(analysisResult, retryAnalysisResult);
        } else {
          // Если и после retry ссылка не найдена, пробуем scrape.do как fallback
          console.log(`🔄 Link still not found, trying scrape.do fallback...`);
          const scrapeDoResult = await this.analyzeWithScrapeDo(url, targetDomain, finalUrl);
          
          if (scrapeDoResult.linkType && scrapeDoResult.linkType !== 'not_found') {
            console.log(`✅ Link found via scrape.do fallback!`);
            Object.assign(analysisResult, scrapeDoResult);
          } else {
            console.log(`❌ Link not found even with scrape.do fallback`);
          }
        }
      }

      const loadTime = Date.now() - startTime;
      console.log(`⏱️ Analysis completed in ${loadTime}ms`);
      
      return {
        status: analysisResult.status || 'Problem',
        responseCode,
        indexable: analysisResult.indexable || false,
        linkType: analysisResult.linkType || 'not_found',
        ...(analysisResult.canonicalUrl && { canonicalUrl: analysisResult.canonicalUrl }),
        loadTime,
        ...(analysisResult.fullATag && { fullATag: analysisResult.fullATag }),
        ...(analysisResult.nonIndexableReason && { nonIndexableReason: analysisResult.nonIndexableReason }),
        ...(analysisResult.error && { error: analysisResult.error })
      };

    } catch (error) {
      console.error(`❌ Error analyzing link ${url}:`, error);
      
      // Если ошибка Puppeteer (таймаут, блокировка и т.д.), пробуем scrape.do
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`🔄 Puppeteer failed (${errorMessage}), trying scrape.do fallback...`);
      
      const scrapeDoResult = await this.analyzeWithScrapeDo(url, targetDomain, url);
      
      if (scrapeDoResult.linkType && scrapeDoResult.linkType !== 'not_found') {
        console.log(`✅ Scrape.do found link despite Puppeteer error!`);
        return {
          status: scrapeDoResult.status || 'OK',
          responseCode: 200, // scrape.do успешно получил страницу
          indexable: scrapeDoResult.indexable || true,
          linkType: scrapeDoResult.linkType,
          ...(scrapeDoResult.canonicalUrl && { canonicalUrl: scrapeDoResult.canonicalUrl }),
          ...(scrapeDoResult.fullATag && { fullATag: scrapeDoResult.fullATag }),
          ...(scrapeDoResult.nonIndexableReason && { nonIndexableReason: scrapeDoResult.nonIndexableReason }),
          loadTime: Date.now() - startTime
        };
      } else {
        console.log(`❌ Scrape.do also failed for Puppeteer error`);
        return {
          status: 'Problem',
          responseCode: 0,
          indexable: false,
          linkType: 'not_found',
          loadTime: Date.now() - startTime,
          error: errorMessage
        };
      }
    } finally {
      // Полное закрытие браузера с очисткой
      if (browser) {
        try {
          await browser.close();
          console.log(`🧹 Browser closed and cleaned up`);
        } catch (error) {
          console.error('Error closing browser:', error);
        }
      }
    }
  }

  // Анализ содержимого страницы
  private static async analyzePageContent(page: Page, targetDomain: string, currentUrl: string, xRobotsTag?: string): Promise<Partial<LinkAnalysisResult>> {
    try {
      // Проверка robots.txt и meta robots
      const indexabilityCheck = await this.checkIndexability(page, xRobotsTag);
      
      // Поиск ссылок на целевой домен
      const linkAnalysis = await this.findTargetLinks(page, targetDomain);
      
      // Получение canonical URL
      const canonicalUrl = await this.getCanonicalUrl(page);

      // Определяем статус и причину неиндексабельности
      let status: 'OK' | 'Problem';
      let nonIndexableReason: string | undefined;

      // Если ссылка не найдена - всегда Problem
      if (!linkAnalysis.found) {
        status = 'Problem';
      }
      // Если страница не индексабельна - Problem
      else if (!indexabilityCheck.indexable) {
        status = 'Problem';
        nonIndexableReason = indexabilityCheck.reason;
      }
      // Если canonical URL отличается от текущего URL - OK с предупреждением
      else if (canonicalUrl && canonicalUrl !== currentUrl) {
        status = 'OK';
        nonIndexableReason = 'Canonicalized';
      }
      // Все остальные случаи - OK
      else {
        status = 'OK';
      }

      const result: Partial<LinkAnalysisResult> = {
        status,
        indexable: indexabilityCheck.indexable,
        linkType: linkAnalysis.linkType,
        ...(canonicalUrl && { canonicalUrl }),
        ...(linkAnalysis.fullATag && { fullATag: linkAnalysis.fullATag }),
        ...(nonIndexableReason && { nonIndexableReason })
      };
      
      // console.log('Link analysis result:', result);
      // console.log('Full ATag:', linkAnalysis.fullATag);
      
      return result;

    } catch (error) {
      console.error('Error analyzing page content:', error);
      return {
        status: 'Problem',
        indexable: false,
        linkType: 'not_found',
        nonIndexableReason: 'Error analyzing page content',
        error: error instanceof Error ? error.message : 'Content analysis failed'
      };
    }
  }

  // Проверка индексабельности страницы
  private static async checkIndexability(page: Page, xRobotsTag?: string): Promise<{ indexable: boolean; reason?: string }> {
    try {
      // Проверка meta robots
      const robotsMeta = await page.$eval('meta[name="robots"]', (el) => el.getAttribute('content')).catch(() => null);
      if (robotsMeta) {
        const robots = robotsMeta.toLowerCase();
        if (robots.includes('noindex') || robots.includes('none')) {
          return { indexable: false, reason: `Meta robots: ${robotsMeta}` };
        }
        if (robots.includes('nofollow')) {
          return { indexable: true, reason: `Meta robots: ${robotsMeta}` };
        }
      }

      // Проверка X-Robots-Tag заголовка
      if (xRobotsTag) {
        console.log(`🔍 Checking X-Robots-Tag: "${xRobotsTag}"`);
        const xRobots = xRobotsTag.toLowerCase();
        if (xRobots.includes('noindex') || xRobots.includes('none')) {
          console.log(`❌ X-Robots-Tag contains noindex: ${xRobotsTag}`);
          return { indexable: false, reason: `X-Robots-Tag: ${xRobotsTag}` };
        }
        if (xRobots.includes('nofollow')) {
          console.log(`⚠️ X-Robots-Tag contains nofollow: ${xRobotsTag}`);
          return { indexable: true, reason: `X-Robots-Tag: ${xRobotsTag}` };
        }
        console.log(`✅ X-Robots-Tag is safe: ${xRobotsTag}`);
      } else {
        console.log(`ℹ️ No X-Robots-Tag found`);
      }
      
      return { indexable: true };
    } catch (error) {
      console.error('Error checking indexability:', error);
      return { indexable: false, reason: 'Error checking indexability' };
    }
  }

  // Поиск ссылок на целевой домен
  private static async findTargetLinks(page: Page, targetDomain: string): Promise<{ found: boolean; linkType: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found'; fullATag?: string }> {
    try {
      const links = await page.evaluate((domain) => {
        const targetLinks: Array<{ href: string; rel: string; fullTag: string; type: string }> = [];

        // 1. Поиск в обычных <a> тегах
        const anchorTags = document.querySelectorAll('a[href]');
        anchorTags.forEach((link) => {
          const href = link.getAttribute('href');
          if (href) {
            try {
              const url = new URL(href, window.location.href);
              if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                targetLinks.push({
                  href: url.href,
                  rel: link.getAttribute('rel') || '',
                  fullTag: link.outerHTML,
                  type: 'anchor'
                });
              }
            } catch (e) {
              // Игнорируем некорректные URL
            }
          }
        });

        // 2. Поиск в <area> тегах (карты изображений)
        const areaTags = document.querySelectorAll('area[href]');
        areaTags.forEach((area) => {
          const href = area.getAttribute('href');
          if (href) {
            try {
              const url = new URL(href, window.location.href);
              if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                targetLinks.push({
                  href: url.href,
                  rel: area.getAttribute('rel') || '',
                  fullTag: area.outerHTML,
                  type: 'area'
                });
              }
            } catch (e) {
              // Игнорируем некорректные URL
            }
          }
        });

        // 3. Поиск в JavaScript (простые случаи)
        const scripts = document.querySelectorAll('script');
        scripts.forEach((script) => {
          const content = script.textContent || script.innerHTML;
          if (content) {
            // Ищем URL в JavaScript коде
            const urlRegex = /https?:\/\/[^\s"'<>]+/g;
            const matches = content.match(urlRegex);
            if (matches) {
              matches.forEach((match) => {
                try {
                  const url = new URL(match);
                  if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                    targetLinks.push({
                      href: url.href,
                      rel: '',
                      fullTag: `<script>...${match}...</script>`,
                      type: 'javascript'
                    });
                  }
                } catch (e) {
                  // Игнорируем некорректные URL
                }
              });
            }
          }
        });

        // 4. Поиск в data-атрибутах
        const elementsWithData = document.querySelectorAll('[data-href], [data-url], [data-link]');
        elementsWithData.forEach((element) => {
          const href = element.getAttribute('data-href') || 
                      element.getAttribute('data-url') || 
                      element.getAttribute('data-link');
          if (href) {
            try {
              const url = new URL(href, window.location.href);
              if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                targetLinks.push({
                  href: url.href,
                  rel: element.getAttribute('rel') || '',
                  fullTag: element.outerHTML,
                  type: 'data-attribute'
                });
              }
            } catch (e) {
              // Игнорируем некорректные URL
            }
          }
        });

        // 5. Поиск в onclick и других событиях
        const elementsWithEvents = document.querySelectorAll('[onclick], [onmousedown], [onmouseup]');
        elementsWithEvents.forEach((element) => {
          const onclick = element.getAttribute('onclick') || 
                         element.getAttribute('onmousedown') || 
                         element.getAttribute('onmouseup');
          if (onclick) {
            const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
            const matches = onclick.match(urlRegex);
            if (matches) {
              matches.forEach((match) => {
                try {
                  const url = new URL(match);
                  if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                    targetLinks.push({
                      href: url.href,
                      rel: element.getAttribute('rel') || '',
                      fullTag: element.outerHTML,
                      type: 'event-handler'
                    });
                  }
                } catch (e) {
                  // Игнорируем некорректные URL
                }
              });
            }
          }
        });

        // 6. Поиск в SVG элементах
        const svgElements = document.querySelectorAll('svg a, svg [href]');
        svgElements.forEach((element) => {
          const href = element.getAttribute('href');
          if (href) {
            try {
              const url = new URL(href, window.location.href);
              if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                targetLinks.push({
                  href: url.href,
                  rel: element.getAttribute('rel') || '',
                  fullTag: element.outerHTML,
                  type: 'svg'
                });
              }
            } catch (e) {
              // Игнорируем некорректные URL
            }
          }
        });

        // 7. Поиск в изображениях с ссылками (img внутри a)
        const imageLinks = document.querySelectorAll('a img, a picture, a figure');
        imageLinks.forEach((img) => {
          const parentLink = img.closest('a');
          if (parentLink) {
            const href = parentLink.getAttribute('href');
            if (href) {
              try {
                const url = new URL(href, window.location.href);
                if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                  targetLinks.push({
                    href: url.href,
                    rel: parentLink.getAttribute('rel') || '',
                    fullTag: parentLink.outerHTML,
                    type: 'image-link'
                  });
                }
              } catch (e) {
                // Игнорируем некорректные URL
              }
            }
          }
        });

        // 8. Поиск в формах (action атрибуты)
        const forms = document.querySelectorAll('form[action]');
        forms.forEach((form) => {
          const action = form.getAttribute('action');
          if (action) {
            try {
              const url = new URL(action, window.location.href);
              if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
                targetLinks.push({
                  href: url.href,
                  rel: '',
                  fullTag: form.outerHTML,
                  type: 'form-action'
                });
              }
            } catch (e) {
              // Игнорируем некорректные URL
            }
          }
        });

        return targetLinks;
      }, targetDomain);

      console.log(`Found ${links.length} links for domain ${targetDomain}:`, links.map(l => ({ type: l.type, href: l.href })));

      if (links.length === 0) {
        return { found: false, linkType: 'not_found' };
      }

      // Анализ атрибутов rel
      let hasDofollow = false;
      let hasNofollow = false;
      let hasSponsored = false;
      let hasUgc = false;
      let firstFullTag = '';

      links.forEach((link, index) => {
        const rel = link.rel.toLowerCase();
        if (rel.includes('nofollow')) hasNofollow = true;
        if (rel.includes('sponsored')) hasSponsored = true;
        if (rel.includes('ugc')) hasUgc = true;
        if (!rel.includes('nofollow')) hasDofollow = true;
        
        // Сохраняем первый найденный тег
        if (index === 0) {
          firstFullTag = link.fullTag;
        }
      });

      // Определение типа ссылки
      if (hasSponsored) return { found: true, linkType: 'sponsored', fullATag: firstFullTag };
      if (hasUgc) return { found: true, linkType: 'ugc', fullATag: firstFullTag };
      if (hasNofollow && !hasDofollow) return { found: true, linkType: 'nofollow', fullATag: firstFullTag };
      if (hasDofollow) return { found: true, linkType: 'dofollow', fullATag: firstFullTag };

      return { found: true, linkType: 'dofollow', fullATag: firstFullTag }; // По умолчанию dofollow

    } catch (error) {
      console.error('Error finding target links:', error);
      return { found: false, linkType: 'not_found' };
    }
  }

  // Получение canonical URL
  private static async getCanonicalUrl(page: Page): Promise<string | null> {
    try {
      const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute('href')).catch(() => null);
      return canonical;
    } catch (error) {
      console.error('Error getting canonical URL:', error);
      return null;
    }
  }

  // Анализ нескольких ссылок параллельно
  static async analyzeMultipleLinks(
    links: Array<{ id: string; url: string; targetDomain: string }>,
    options: AnalysisOptions = {}
  ): Promise<Array<{ id: string; result: LinkAnalysisResult }>> {
    const results: Array<{ id: string; result: LinkAnalysisResult }> = [];
    const concurrency = 5; // Максимум 5 параллельных запросов

    // Разбиваем на батчи
    for (let i = 0; i < links.length; i += concurrency) {
      const batch = links.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (link) => {
        const result = await this.analyzeLink(link.url, link.targetDomain, options);
        return { id: link.id, result };
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((promiseResult) => {
        if (promiseResult.status === 'fulfilled') {
          results.push(promiseResult.value);
        } else {
          console.error('Link analysis failed:', promiseResult.reason);
        }
      });

      // Небольшая пауза между батчами
      if (i + concurrency < links.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // Проверка доступности URL
  static async checkUrlAvailability(url: string, timeout: number = 10000): Promise<{ available: boolean; statusCode?: number; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      clearTimeout(timeoutId);

      return {
        available: response.ok,
        statusCode: response.status
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Валидация URL
  static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Извлечение домена из URL
  static extractDomain(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }

  // Нормализация URL
  static normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.href;
    } catch {
      return url;
    }
  }

  // Нормализация target domain - извлекаем только домен без протокола, путей и поддоменов
  static normalizeTargetDomain(targetDomain: string): string {
    try {
      console.log(`Normalizing target domain: "${targetDomain}"`);
      
      // Если это уже просто домен без протокола, возвращаем как есть
      if (!targetDomain.includes('://') && !targetDomain.includes('/')) {
        const normalized = targetDomain.toLowerCase().trim();
        console.log(`Already normalized: "${normalized}"`);
        return normalized;
      }
      
      // Парсим URL
      const url = new URL(targetDomain.startsWith('http') ? targetDomain : `https://${targetDomain}`);
      
      // Извлекаем только домен (без www и других поддоменов)
      let domain = url.hostname.toLowerCase();
      
      // Убираем www. если есть
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      
      console.log(`Normalized target domain: "${targetDomain}" -> "${domain}"`);
      return domain;
      
    } catch (error) {
      console.error(`Error normalizing target domain "${targetDomain}":`, error);
      // Если не удалось распарсить, возвращаем как есть, но в нижнем регистре
      return targetDomain.toLowerCase().trim();
    }
  }

  /**
   * Fallback анализ через scrape.do API
   */
  private static async analyzeWithScrapeDo(
    url: string, 
    targetDomain: string, 
    currentUrl: string
  ): Promise<Partial<LinkAnalysisResult>> {
    try {
      console.log(`🌐 Starting scrape.do fallback analysis for ${url}`);

      // Проверяем доступность scrape.do
      if (!ScrapeDoService.isAvailable()) {
        console.log(`⚠️ Scrape.do not available, skipping fallback (API key not configured)`);
        return {
          linkType: 'not_found',
          error: 'Scrape.do not configured - please set SCRAPE_DO_API_KEY in agent_env.txt'
        };
      }

      // Скрапим страницу через scrape.do
      const scrapeResult = await ScrapeDoService.scrapePageWithRetry(url, {
        timeout: 60000 // Увеличиваем таймаут до 60 секунд
      });

      if (!scrapeResult.success || !scrapeResult.html) {
        console.log(`❌ Scrape.do failed: ${scrapeResult.error}`);
        return {
          linkType: 'not_found',
          error: `Scrape.do error: ${scrapeResult.error}`
        };
      }

      console.log(`✅ Scrape.do success: ${scrapeResult.statusCode} (${scrapeResult.html.length} chars)`);

      // Извлекаем ссылки из HTML
      const linkResult = ScrapeDoService.extractLinksFromHtml(scrapeResult.html, targetDomain, url);
      
      if (!linkResult.found) {
        console.log(`❌ No links found via scrape.do`);
        return {
          linkType: 'not_found'
        };
      }

      // Извлекаем canonical URL
      const canonicalUrl = ScrapeDoService.extractCanonicalUrl(scrapeResult.html);
      
      // Проверяем индексабельность
      const indexabilityResult = ScrapeDoService.checkIndexabilityFromHtml(scrapeResult.html);

      // Определяем статус на основе canonical URL
      let status: 'OK' | 'Problem' = 'OK';
      let nonIndexableReason: string | undefined;

      if (!indexabilityResult.indexable) {
        status = 'Problem';
        nonIndexableReason = indexabilityResult.reason;
      } else if (canonicalUrl && canonicalUrl !== currentUrl) {
        // Canonical отличается от текущего URL
        nonIndexableReason = 'Canonicalized';
      }

      console.log(`✅ Scrape.do analysis complete: ${linkResult.linkType}, status: ${status}`);

      return {
        status,
        indexable: indexabilityResult.indexable,
        linkType: linkResult.linkType,
        ...(canonicalUrl && { canonicalUrl }),
        ...(linkResult.fullATag && { fullATag: linkResult.fullATag }),
        ...(nonIndexableReason && { nonIndexableReason })
      };

    } catch (error) {
      console.error(`❌ Scrape.do fallback error:`, error);
      return {
        linkType: 'not_found',
        error: error instanceof Error ? error.message : 'Unknown scrape.do error'
      };
    }
  }
}
