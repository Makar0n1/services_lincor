import fs from 'fs';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';

export interface ImportedLink {
  url: string;
  target_domain: string;
}

export class FileProcessor {
  static async processCSV(filePath: string): Promise<ImportedLink[]> {
    return new Promise((resolve, reject) => {
      const results: ImportedLink[] = [];
      
      // Сначала попробуем обработать как CSV без заголовков (более надежно)
      fs.createReadStream(filePath)
        .pipe(csv({ 
          headers: false
        }))
        .on('data', (data) => {
          console.log('CSV raw row data:', data); // Debug log
          
          // data[0] = первая колонка (URL), data[1] = вторая колонка (Target Domain)
          const url = data['0'];
          const targetDomain = data['1'];
          
          console.log('CSV extracted:', { url, targetDomain }); // Debug log
          
          // Проверяем, что оба поля не пустые и не undefined
          if (url && targetDomain && url.trim() !== '' && targetDomain.trim() !== '') {
            results.push({
              url: url.trim(),
              target_domain: targetDomain.trim()
            });
            console.log('CSV added link:', { url: url.trim(), target_domain: targetDomain.trim() }); // Debug log
          } else {
            console.log('CSV skipped row - missing or empty data:', { url, targetDomain }); // Debug log
          }
        })
        .on('end', () => {
          console.log(`CSV processing completed. Found ${results.length} links.`); // Debug log
          console.log('CSV final results:', results); // Debug log
          
          // Если не нашли ссылки без заголовков, попробуем с заголовками
          if (results.length === 0) {
            console.log('No links found without headers, trying with headers...'); // Debug log
            this.processCSVWithHeaders(filePath).then(resolve).catch(reject);
          } else {
            resolve(results);
          }
        })
        .on('error', (error) => {
          console.error('CSV processing error:', error); // Debug log
          reject(error);
        });
    });
  }

  // Метод для CSV с заголовками
  static async processCSVWithHeaders(filePath: string): Promise<ImportedLink[]> {
    return new Promise((resolve, reject) => {
      const results: ImportedLink[] = [];
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          console.log('CSV with headers raw data:', data); // Debug log
          
          // Поддерживаем разные форматы колонок
          const url = data.URL || data.url || data['URL'] || data['url'] || data['A'] || data['Column A'];
          const targetDomain = data['Target Domain'] || data['target_domain'] || data['TargetDomain'] || data['targetDomain'] || data['B'] || data['Column B'];
          
          console.log('CSV with headers extracted:', { url, targetDomain }); // Debug log
          
          if (url && targetDomain && url.trim() !== '' && targetDomain.trim() !== '') {
            results.push({
              url: url.trim(),
              target_domain: targetDomain.trim()
            });
            console.log('CSV with headers added link:', { url: url.trim(), target_domain: targetDomain.trim() }); // Debug log
          } else {
            console.log('CSV with headers skipped row:', { url, targetDomain }); // Debug log
          }
        })
        .on('end', () => {
          console.log(`CSV with headers processing completed. Found ${results.length} links.`); // Debug log
          console.log('CSV with headers final results:', results); // Debug log
          resolve(results);
        })
        .on('error', (error) => {
          console.error('CSV with headers processing error:', error); // Debug log
          reject(error);
        });
    });
  }

  static async processExcel(filePath: string): Promise<ImportedLink[]> {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        throw new Error('No sheets found in Excel file');
      }
      
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        throw new Error('Worksheet not found in Excel file');
      }
      
      // Конвертируем в JSON (без заголовков, чтобы получить A, B, C...)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log('Excel raw data:', jsonData); // Debug log
      
      const results: ImportedLink[] = [];
      
      for (const row of jsonData as any[]) {
        // row[0] = столбец A (URL), row[1] = столбец B (Target Domain)
        const url = row[0];
        const targetDomain = row[1];
        
        console.log('Excel row:', { url, targetDomain }); // Debug log
        
        if (url && targetDomain) {
          results.push({
            url: url.toString().trim(),
            target_domain: targetDomain.toString().trim()
          });
        }
      }
      
      console.log(`Excel processing completed. Found ${results.length} links.`); // Debug log
      return results;
    } catch (error) {
      console.error('Excel processing error:', error); // Debug log
      throw new Error(`Failed to process Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async processFile(filePath: string, mimeType: string): Promise<ImportedLink[]> {
    try {
      if (mimeType === 'text/csv') {
        try {
          return await this.processCSV(filePath);
        } catch (error) {
          console.log('CSV parser failed, trying manual parsing...', error);
          return await this.processCSVManually(filePath);
        }
      } else if (mimeType === 'application/vnd.ms-excel' || 
                 mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        return await this.processExcel(filePath);
      } else {
        throw new Error('Unsupported file type');
      }
    } catch (error) {
      throw new Error(`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Ручная обработка CSV файла
  static async processCSVManually(filePath: string): Promise<ImportedLink[]> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim() !== '');
      
      console.log(`Manual CSV processing: ${lines.length} lines found`);
      
      const results: ImportedLink[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;
        
        console.log(`Processing line ${i + 1}: "${line}"`);
        
        // Разделяем по запятой
        const parts = line.split(',').map(part => part.trim());
        
        if (parts.length >= 2) {
          const url = parts[0];
          const targetDomain = parts[1];
          
          console.log(`Manual CSV extracted: url="${url}", targetDomain="${targetDomain}"`);
          
          if (url && targetDomain && url !== '' && targetDomain !== '') {
            results.push({
              url: url,
              target_domain: targetDomain
            });
            console.log(`Manual CSV added link: ${url} -> ${targetDomain}`);
          } else {
            console.log(`Manual CSV skipped line ${i + 1}: empty data`);
          }
        } else {
          console.log(`Manual CSV skipped line ${i + 1}: insufficient columns (${parts.length})`);
        }
      }
      
      console.log(`Manual CSV processing completed. Found ${results.length} links.`);
      return results;
      
    } catch (error) {
      console.error('Manual CSV processing error:', error);
      throw error;
    }
  }

  static async cleanupFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Failed to cleanup file:', error);
    }
  }

  static validateImportedLinks(links: ImportedLink[]): { valid: ImportedLink[]; invalid: string[] } {
    const valid: ImportedLink[] = [];
    const invalid: string[] = [];

    for (const link of links) {
      try {
        // Базовая валидация URL
        new URL(link.url);
        
        // Проверка на пустые значения
        if (link.url.trim() && link.target_domain.trim()) {
          valid.push(link);
        } else {
          invalid.push(`${link.url} - Empty URL or target domain`);
        }
      } catch (error) {
        invalid.push(`${link.url} - Invalid URL format`);
      }
    }

    return { valid, invalid };
  }
}
