import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Загрузка переменных окружения
dotenv.config({ path: '../../../.env' });

export interface ScrapeDoOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ScrapeDoResponse {
  success: boolean;
  html?: string;
  statusCode?: number;
  error?: string;
  responseTime?: number;
}

export class ScrapeDoService {
  private static readonly API_KEY = process.env['SCRAPE_DO_API_KEY'] || '2894e67325124e658435bcb05953e338102cc0bbd7c';
  private static readonly BASE_URL = process.env['SCRAPE_DO_BASE_URL'] || 'https://api.scrape.do';
  private static readonly DEFAULT_TIMEOUT = parseInt(process.env['SCRAPE_DO_TIMEOUT'] || '30000');
  private static readonly RETRY_ATTEMPTS = parseInt(process.env['SCRAPE_DO_RETRY_ATTEMPTS'] || '2');

  // Логируем статус API ключа при инициализации
  static {
    if (this.API_KEY && this.API_KEY !== 'your_scrape_do_api_key_here' && this.API_KEY !== '') {
      console.log(`✅ Scrape.do API key loaded successfully (${this.API_KEY.substring(0, 8)}...)`);
    } else {
      console.log(`⚠️ Scrape.do API key not configured - fallback will be disabled`);
    }
  }

  /**
   * Проверяет, доступен ли сервис scrape.do
   */
  static isAvailable(): boolean {
    return !!this.API_KEY && this.API_KEY !== 'your_scrape_do_api_key_here' && this.API_KEY !== '';
  }

  /**
   * Скрапит страницу через scrape.do API
   */
  static async scrapePage(
    url: string, 
    options: ScrapeDoOptions = {}
  ): Promise<ScrapeDoResponse> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'Scrape.do API key not configured'
      };
    }

    const {
      headers = {},
      timeout = this.DEFAULT_TIMEOUT
    } = options;

    const startTime = Date.now();

    try {
      console.log(`🌐 Scraping ${url} via scrape.do GET request`);

      // Формируем URL согласно документации scrape.do
      const encodedUrl = encodeURIComponent(url);
      const requestUrl = `${this.BASE_URL}/?token=${this.API_KEY}&url=${encodedUrl}&customHeaders=true&render=true`;
      
      console.log(`🔗 Scrape.do request URL: ${requestUrl}`);
      
      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: requestHeaders,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      const statusCode = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Scrape.do API error: ${statusCode} - ${errorText}`);
        
        // Если 403 - это может быть блокировка IP scrape.do
        if (statusCode === 403) {
          console.log(`🚫 Scrape.do got 403 - site is blocking even scrape.do IPs`);
          console.log(`💡 This site has very strong anti-bot protection`);
        }
        
        return {
          success: false,
          statusCode,
          error: `API error: ${statusCode}`,
          responseTime
        };
      }

      const html = await response.text();
      
      console.log(`✅ Scrape.do success: ${statusCode} (${responseTime}ms, ${html.length} chars)`);
      console.log(`📄 Scrape.do HTML content (first 2000 chars):`);
      console.log(`==========================================`);
      console.log(html.substring(0, 2000));
      console.log(`==========================================`);

      return {
        success: true,
        html,
        statusCode,
        responseTime
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.error(`⏰ Scrape.do timeout after ${timeout}ms`);
          return {
            success: false,
            error: 'Request timeout',
            responseTime
          };
        }
        
        console.error(`❌ Scrape.do error:`, error.message);
        return {
          success: false,
          error: error.message,
          responseTime
        };
      }

      return {
        success: false,
        error: 'Unknown error',
        responseTime
      };
    }
  }

  /**
   * Скрапит страницу с повторными попытками и разными стратегиями
   */
  static async scrapePageWithRetry(
    url: string, 
    options: ScrapeDoOptions = {}
  ): Promise<ScrapeDoResponse> {
    let lastError: string | undefined;

    // Стратегии для обхода блокировок
    const strategies = [
      { name: 'default', options: { ...options } },
      { name: 'different_headers', options: { 
        ...options, 
        headers: { 
          ...options.headers,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      }},
      { name: 'mobile_user_agent', options: { 
        ...options, 
        headers: { 
          ...options.headers,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'
        }
      }}
    ];

    for (let attempt = 1; attempt <= this.RETRY_ATTEMPTS; attempt++) {
      const strategy = strategies[Math.min(attempt - 1, strategies.length - 1)];
      if (!strategy) {
        console.error(`❌ No strategy available for attempt ${attempt}`);
        break;
      }
      
      console.log(`🔄 Scrape.do attempt ${attempt}/${this.RETRY_ATTEMPTS} for ${url} (strategy: ${strategy.name})`);
      
      const result = await this.scrapePage(url, strategy.options);
      
      if (result.success) {
        if (attempt > 1) {
          console.log(`✅ Scrape.do succeeded on attempt ${attempt} with strategy: ${strategy.name}`);
        }
        return result;
      }

      lastError = result.error;
      
      // Если получили 403, пробуем другую стратегию
      if (result.statusCode === 403) {
        console.log(`🚫 Got 403 with strategy: ${strategy.name}, trying next strategy...`);
      }
      
      if (attempt < this.RETRY_ATTEMPTS) {
        const delay = attempt * 3000; // 3s, 6s, 9s...
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.error(`❌ Scrape.do failed after ${this.RETRY_ATTEMPTS} attempts with all strategies: ${lastError}`);
    return {
      success: false,
      error: `Failed after ${this.RETRY_ATTEMPTS} attempts: ${lastError}`
    };
  }

  /**
   * Извлекает ссылки из HTML (аналогично Puppeteer)
   */
  static extractLinksFromHtml(html: string, targetDomain: string, url?: string): {
    found: boolean;
    linkType: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found';
    fullATag?: string;
  } {
    try {
      // Нормализуем target domain для поиска
      const normalizedTarget = targetDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
      
      // Ищем все ссылки в HTML - улучшенный regex
      const linkRegex = /<a[^>]*href\s*=\s*["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
      let match;
      const foundLinks: Array<{ href: string; fullTag: string }> = [];

      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const fullTag = match[0];
        
        console.log(`🔍 Found link in HTML: ${href}`);
        
        // Проверяем, содержит ли href наш target domain
        if (href && href.toLowerCase().includes(normalizedTarget)) {
          console.log(`✅ Link matches target domain: ${href}`);
          foundLinks.push({ href, fullTag });
        }
      }

      // Если не нашли в <a> тегах, ищем в тексте (например, в описаниях)
      if (foundLinks.length === 0) {
        console.log(`🔍 No links in <a> tags, searching in text content...`);
        
        // Ищем URL в тексте (например, https://studibucht.de/)
        const textUrlRegex = new RegExp(`(https?://[^\\s<>"']*${normalizedTarget}[^\\s<>"']*)`, 'gi');
        let textMatch;
        
        while ((textMatch = textUrlRegex.exec(html)) !== null) {
          const foundUrl = textMatch[1];
          console.log(`🔍 Found URL in text: ${foundUrl}`);
          
          // Проверяем, что это не часть другого URL
          if (foundUrl && foundUrl.toLowerCase().includes(normalizedTarget)) {
            console.log(`✅ URL in text matches target domain: ${foundUrl}`);
            foundLinks.push({ 
              href: foundUrl, 
              fullTag: `<!-- Found in text content --> ${foundUrl}` 
            });
          }
        }
        
        // Если все еще не нашли, ищем в meta тегах
        if (foundLinks.length === 0) {
          console.log(`🔍 Still no links found, searching in meta tags...`);
          
          // Ищем в meta тегах (og:url, twitter:url, etc.)
          const metaRegex = /<meta[^>]*(?:property|name)\s*=\s*["']([^"']*)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi;
          let metaMatch;
          
          while ((metaMatch = metaRegex.exec(html)) !== null) {
            const metaProperty = metaMatch[1];
            const metaContent = metaMatch[2];
            
            if (metaContent && metaContent.toLowerCase().includes(normalizedTarget)) {
              console.log(`🔍 Found target domain in meta ${metaProperty}: ${metaContent}`);
              foundLinks.push({ 
                href: metaContent, 
                fullTag: `<!-- Found in meta ${metaProperty} --> ${metaContent}` 
              });
            }
          }
        }
      }

      // Если не нашли ссылки в обычных <a> тегах, ищем в data-атрибутах и JSON
      if (foundLinks.length === 0) {
        console.log(`🔍 No links in <a> tags, searching in data attributes and JSON...`);
        
        // Ищем в data-атрибутах (например, data-turbo-mount-investor-profile--index-props-value)
        const dataAttributeRegex = /data-[^=]*="([^"]*)"[^>]*>/gi;
        let dataMatch;
        
        while ((dataMatch = dataAttributeRegex.exec(html)) !== null) {
          const dataValue = dataMatch[1];
          if (!dataValue) continue;
          
          // Декодируем HTML entities
          const decodedValue = dataValue
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          
          console.log(`🔍 Found data attribute: ${dataValue.substring(0, 100)}...`);
          
          // Ищем наш домен в декодированном значении
          if (decodedValue.toLowerCase().includes(normalizedTarget)) {
            console.log(`✅ Found target domain in data attribute!`);
            
            // Извлекаем URL из JSON
            const urlMatch = decodedValue.match(new RegExp(`"([^"]*${normalizedTarget}[^"]*)"`, 'i'));
            if (urlMatch && urlMatch[1]) {
              const foundUrl = urlMatch[1];
              console.log(`🎯 Extracted URL from data attribute: ${foundUrl}`);
              
              foundLinks.push({ 
                href: foundUrl, 
                fullTag: `<!-- Found in data attribute --> ${dataValue.substring(0, 200)}...` 
              });
            }
          }
        }
        
        // Если все еще не нашли, ищем в script тегах и JSON-LD
        if (foundLinks.length === 0) {
          console.log(`🔍 Still no links found, searching in script tags and JSON-LD...`);
          
          // Ищем в script тегах
          const scriptRegex = /<script[^>]*>(.*?)<\/script>/gis;
          let scriptMatch;
          
          while ((scriptMatch = scriptRegex.exec(html)) !== null) {
            const scriptContent = scriptMatch[1];
            if (!scriptContent) continue;
            
            if (scriptContent.toLowerCase().includes(normalizedTarget)) {
              console.log(`🔍 Found target domain in script tag`);
              
              // Ищем URL в script контенте
              const urlMatch = scriptContent.match(new RegExp(`"([^"]*${normalizedTarget}[^"]*)"`, 'i'));
              if (urlMatch && urlMatch[1]) {
                const foundUrl = urlMatch[1];
                console.log(`🎯 Extracted URL from script: ${foundUrl}`);
                
                foundLinks.push({ 
                  href: foundUrl, 
                  fullTag: `<!-- Found in script tag --> ${scriptContent.substring(0, 200)}...` 
                });
              }
            }
          }
          
          // Ищем в JSON-LD
          const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
          let jsonLdMatch;
          
          while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
            const jsonContent = jsonLdMatch[1];
            if (!jsonContent) continue;
            
            if (jsonContent.toLowerCase().includes(normalizedTarget)) {
              console.log(`🔍 Found target domain in JSON-LD`);
              
              // Ищем URL в JSON-LD
              const urlMatch = jsonContent.match(new RegExp(`"([^"]*${normalizedTarget}[^"]*)"`, 'i'));
              if (urlMatch && urlMatch[1]) {
                const foundUrl = urlMatch[1];
                console.log(`🎯 Extracted URL from JSON-LD: ${foundUrl}`);
                
                foundLinks.push({ 
                  href: foundUrl, 
                  fullTag: `<!-- Found in JSON-LD --> ${jsonContent.substring(0, 200)}...` 
                });
              }
            }
          }
        }
      }

      if (foundLinks.length === 0) {
        console.log(`❌ Scrape.do: No links found for target domain: ${normalizedTarget}`);
        console.log(`🔍 Looking for domain: "${normalizedTarget}" in HTML content`);
        
        // Дополнительная диагностика - ищем все ссылки в HTML
        const allLinksRegex = /<a[^>]*href\s*=\s*["']([^"']*)["'][^>]*>/gi;
        let allMatch;
        const allLinks: string[] = [];
        
        while ((allMatch = allLinksRegex.exec(html)) !== null) {
          if (allMatch[1]) {
            allLinks.push(allMatch[1]);
          }
        }
        
        console.log(`📋 All links found in HTML (${allLinks.length} total):`);
        allLinks.slice(0, 10).forEach((link, index) => {
          console.log(`  ${index + 1}. ${link}`);
        });
        
        if (allLinks.length > 10) {
          console.log(`  ... and ${allLinks.length - 10} more links`);
        }
        
        // Сохраняем HTML в файл для анализа
        this.saveHtmlToFile(html, url || 'unknown_url', targetDomain);
        
        return {
          found: false,
          linkType: 'not_found'
        };
      }

      // Берем первую найденную ссылку
      const firstLink = foundLinks[0];
      if (!firstLink) {
        return {
          found: false,
          linkType: 'not_found'
        };
      }

      const fullATag = firstLink.fullTag;

      // Определяем тип ссылки по rel атрибуту
      const relMatch = fullATag.match(/rel\s*=\s*["']([^"']*)["']/i);
      const relValue = relMatch?.[1]?.toLowerCase() || '';

      let linkType: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found';

      if (relValue.includes('nofollow')) {
        linkType = 'nofollow';
      } else if (relValue.includes('sponsored')) {
        linkType = 'sponsored';
      } else if (relValue.includes('ugc')) {
        linkType = 'ugc';
      } else {
        linkType = 'dofollow';
      }

      console.log(`🔗 Scrape.do found link: ${firstLink.href} (${linkType})`);
      console.log(`🏷️ Full <a> tag: ${fullATag}`);

      return {
        found: true,
        linkType,
        fullATag
      };

    } catch (error) {
      console.error('❌ Error extracting links from HTML:', error);
      return {
        found: false,
        linkType: 'not_found'
      };
    }
  }

  /**
   * Извлекает canonical URL из HTML
   */
  static extractCanonicalUrl(html: string): string | null {
    try {
      const canonicalMatch = html.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i);
      return canonicalMatch?.[1] || null;
    } catch (error) {
      console.error('❌ Error extracting canonical URL:', error);
      return null;
    }
  }

  /**
   * Проверяет индексабельность страницы по HTML
   */
  static checkIndexabilityFromHtml(html: string): {
    indexable: boolean;
    reason?: string;
  } {
    try {
      // Проверяем meta robots
      const metaRobotsMatch = html.match(/<meta[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["']([^"']*)["']/i);
      if (metaRobotsMatch?.[1]) {
        const content = metaRobotsMatch[1].toLowerCase();
        if (content.includes('noindex')) {
          return {
            indexable: false,
            reason: 'Meta robots: noindex'
          };
        }
        if (content.includes('nofollow')) {
          return {
            indexable: true, // nofollow не влияет на индексабельность
            reason: 'Meta robots: nofollow'
          };
        }
      }

      return {
        indexable: true
      };

    } catch (error) {
      console.error('❌ Error checking indexability:', error);
      return {
        indexable: true // По умолчанию считаем индексабельной
      };
    }
  }

  /**
   * Сохраняет HTML в файл для анализа
   */
  static saveHtmlToFile(html: string, url: string, targetDomain: string): void {
    try {
      // Создаем папку для сохранения HTML файлов
      const htmlDir = path.join(process.cwd(), 'scraped_html');
      if (!fs.existsSync(htmlDir)) {
        fs.mkdirSync(htmlDir, { recursive: true });
      }

      // Создаем безопасное имя файла
      const urlSafe = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
      const domainSafe = targetDomain.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      const filename = `scrape_do_${domainSafe}_${urlSafe}_${timestamp}.html`;
      const filepath = path.join(htmlDir, filename);

      // Сохраняем HTML
      fs.writeFileSync(filepath, html, 'utf8');
      
      console.log(`💾 HTML saved to file: ${filepath}`);
      console.log(`📁 File size: ${(html.length / 1024).toFixed(2)} KB`);
      
    } catch (error) {
      console.error('❌ Error saving HTML to file:', error);
    }
  }
}
