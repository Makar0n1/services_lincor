import { google } from 'googleapis';
import { GoogleSheetModel } from '../models/GoogleSheet';
import { ManualLinkModel } from '../models/ManualLink';
import { LinkAnalyzer } from './linkAnalyzer';
import { QueueService } from './queueService';
import { SocketService } from './socketService';

export interface SheetData {
  urls: string[];
  targets: string[];
  hasExistingData: boolean;
  totalRows: number;
  uniqueUrls: number;
}

export class GoogleSheetsService {
  private static auth: any = null;
  private static sheets: any = null;

  // Инициализация Google Sheets API
  static async initialize(): Promise<void> {
    try {
      // Загружаем service account credentials
      const credentials = require('../../service-account.json');
      
      this.auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log('✅ Google Sheets API initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets API:', error);
      throw error;
    }
  }

  // Чтение данных из Google Sheets
  static async readSheetData(
    spreadsheetId: string, 
    gid: string,
    urlColumn: string,
    targetColumn: string,
    resultRangeStart: string,
    resultRangeEnd: string,
    defaultTargetDomain: string
  ): Promise<SheetData> {
    try {
      if (!this.sheets) {
        await this.initialize();
      }

      // Получаем информацию о листах, чтобы найти имя листа по GID
      const spreadsheetInfo = await this.sheets.spreadsheets.get({
        spreadsheetId
      });

      // Находим имя листа по GID
      let sheetName = 'Sheet1'; // По умолчанию
      const targetSheet = spreadsheetInfo.data.sheets?.find((sheet: any) => 
        sheet.properties?.sheetId?.toString() === gid
      );
      
      if (targetSheet?.properties?.title) {
        sheetName = targetSheet.properties.title;
      }

      console.log(`Using sheet: "${sheetName}" (GID: ${gid})`);

      // Читаем данные из столбца URL с указанием конкретного листа
      const urlRange = `'${sheetName}'!${urlColumn}:${urlColumn}`;
      const urlResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: urlRange,
        majorDimension: 'COLUMNS'
      });

      // Читаем данные из столбца Target с указанием конкретного листа
      const targetRange = `'${sheetName}'!${targetColumn}:${targetColumn}`;
      const targetResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: targetRange,
        majorDimension: 'COLUMNS'
      });

      // Читаем диапазон результатов для проверки на существующие данные с указанием конкретного листа
      const resultRange = `'${sheetName}'!${resultRangeStart}:${resultRangeEnd}`;
      const resultResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: resultRange,
        majorDimension: 'ROWS'
      });

      const urls = urlResponse.data.values?.[0] || [];
      const targets = targetResponse.data.values?.[0] || [];
      const resultData = resultResponse.data.values || [];

      // Пропускаем заголовок (первую строку)
      const dataUrls = urls.slice(1);
      const dataTargets = targets.slice(1);

      // Проверяем наличие существующих данных в диапазоне результатов
      const hasExistingData = resultData.length > 1 && 
        resultData.some((row: any[]) => 
          row.some(cell => cell && cell.toString().trim() !== '')
        );

      // Подготавливаем данные для анализа
      const processedUrls: string[] = [];
      const processedTargets: string[] = [];

      for (let i = 0; i < dataUrls.length; i++) {
        const url = dataUrls[i]?.toString().trim();
        if (url && this.isValidUrl(url)) {
          processedUrls.push(url);
          
          // Используем target из ячейки или defaultTargetDomain
          const target = dataTargets[i]?.toString().trim() || defaultTargetDomain;
          processedTargets.push(target);
        }
      }

      // Подсчитываем уникальные URL
      const uniqueUrls = new Set(processedUrls).size;

      return {
        urls: processedUrls,
        targets: processedTargets,
        hasExistingData,
        totalRows: processedUrls.length,
        uniqueUrls
      };

    } catch (error) {
      console.error('Error reading Google Sheet data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to read Google Sheet: ${errorMessage}`);
    }
  }

  // Запись результатов анализа в Google Sheets
  static async writeAnalysisResults(
    spreadsheetId: string,
    gid: string,
    resultRangeStart: string,
    resultRangeEnd: string,
    results: Array<{
      status: string;
      responseCode: number;
      indexable: boolean;
      nonIndexableReason?: string;
      linkFound: boolean;
      linkFoundTime?: Date;
    }>
  ): Promise<void> {
    try {
      if (!this.sheets) {
        await this.initialize();
      }

      // Получаем информацию о листах, чтобы найти имя листа по GID
      const spreadsheetInfo = await this.sheets.spreadsheets.get({
        spreadsheetId
      });

      // Находим имя листа по GID
      let sheetName = 'Sheet1'; // По умолчанию
      const targetSheet = spreadsheetInfo.data.sheets?.find((sheet: any) => 
        sheet.properties?.sheetId?.toString() === gid
      );
      
      if (targetSheet?.properties?.title) {
        sheetName = targetSheet.properties.title;
      }

      console.log(`Writing results to sheet: "${sheetName}" (GID: ${gid})`);

      // Подготавливаем данные для записи
      const headers = ['Status', 'Response Code', 'Indexable', 'Non-indexable Reason', 'Link Found'];
      const dataRows = results.map(result => [
        result.status,
        result.responseCode.toString(),
        result.indexable ? 'Yes' : 'No',
        result.nonIndexableReason || '',
        result.linkFound ? 
          `True (${result.linkFoundTime?.toLocaleString() || new Date().toLocaleString()})` : 
          `False (${new Date().toLocaleString()})`
      ]);
      
      // Объединяем заголовки и данные
      const values = [headers, ...dataRows];

      // Записываем данные в диапазон с указанием конкретного листа
      const range = `'${sheetName}'!${resultRangeStart}:${resultRangeEnd}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values
        }
      });

      // Применяем форматирование
      await this.formatResults(spreadsheetId, sheetName, resultRangeStart, resultRangeEnd, results);

      console.log(`✅ Successfully wrote ${dataRows.length} analysis results with headers to Google Sheet`);

    } catch (error) {
      console.error('Error writing analysis results to Google Sheet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to write results to Google Sheet: ${errorMessage}`);
    }
  }

  // Применяем форматирование к результатам
  private static async formatResults(
    spreadsheetId: string,
    sheetName: string,
    _resultRangeStart: string,
    _resultRangeEnd: string,
    results: Array<{
      status: string;
      responseCode: number;
      indexable: boolean;
      nonIndexableReason?: string;
      linkFound: boolean;
      linkFoundTime?: Date;
    }>
  ): Promise<void> {
    try {
      if (!this.sheets) {
        await this.initialize();
      }

      // Получаем информацию о листах, чтобы найти sheetId по имени листа
      const spreadsheetInfo = await this.sheets.spreadsheets.get({
        spreadsheetId
      });

      // Находим sheetId по имени листа
      let targetSheetId = 0; // По умолчанию
      const targetSheet = spreadsheetInfo.data.sheets?.find((sheet: any) => 
        sheet.properties?.title === sheetName
      );
      
      if (targetSheet?.properties?.sheetId !== undefined) {
        targetSheetId = targetSheet.properties.sheetId;
      }

      console.log(`Formatting results on sheet: "${sheetName}" (SheetId: ${targetSheetId})`);

      // Конвертируем буквы столбцов в индексы
      const startColumnIndex = this.columnToIndex(_resultRangeStart);
      const endColumnIndex = this.columnToIndex(_resultRangeEnd) + 1; // +1 потому что endColumnIndex не включительно

      console.log(`Formatting range: ${_resultRangeStart}:${_resultRangeEnd} (columns ${startColumnIndex}:${endColumnIndex})`);

      const requests = [];

      // Форматирование заголовков (первая строка)
      requests.push({
        repeatCell: {
          range: {
            sheetId: targetSheetId,
            startRowIndex: 0, // Первая строка (заголовки)
            endRowIndex: 1,
            startColumnIndex: startColumnIndex,
            endColumnIndex: endColumnIndex
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }, // Светло-серый для заголовков
              textFormat: {
                bold: true,
                fontSize: 12
              }
            }
          },
          fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat'
        }
      });

      // Форматирование для каждой строки данных
      for (let i = 0; i < results.length; i++) {
        const rowIndex = i + 2; // +2 потому что первая строка - заголовок, и индексация с 1
        const result = results[i];

        if (!result) continue; // Пропускаем undefined элементы

        // Цветовая схема для статуса
        let backgroundColor = { red: 1, green: 1, blue: 1 }; // Белый по умолчанию
        
        if (result.status === 'OK') {
          // Проверяем, есть ли причина "Canonicalized" для желтого цвета
          if (result.nonIndexableReason === 'Canonicalized') {
            backgroundColor = { red: 1, green: 1, blue: 0.8 }; // Светло-желтый
          } else {
            backgroundColor = { red: 0.8, green: 1, blue: 0.8 }; // Светло-зеленый
          }
        } else if (result.status === 'Problem') {
          backgroundColor = { red: 1, green: 0.8, blue: 0.8 }; // Светло-красный
        }

        // Запрос на форматирование строки
        requests.push({
          repeatCell: {
            range: {
              sheetId: targetSheetId, // Используем правильный sheetId
              startRowIndex: rowIndex - 1,
              endRowIndex: rowIndex,
              startColumnIndex: startColumnIndex,
              endColumnIndex: endColumnIndex
            },
            cell: {
              userEnteredFormat: {
                backgroundColor
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        });
      }

      if (requests.length > 0) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests
          }
        });
      }

    } catch (error) {
      console.error('Error formatting Google Sheet results:', error);
      // Не выбрасываем ошибку, так как форматирование не критично
    }
  }

  // Проверка валидности URL
  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Анализ Google Sheet
  static async analyzeGoogleSheet(sheetId: string): Promise<void> {
    try {
      console.log(`🔍 Starting analysis for Google Sheet ${sheetId}`);

      // Получаем данные о Google Sheet
      const sheet = await GoogleSheetModel.findById(sheetId);
      if (!sheet) {
        throw new Error('Google Sheet not found');
      }

      // Получаем user_id из проекта если его нет в sheet
      let userId = sheet.user_id;
      if (!userId) {
        const { ProjectModel } = await import('../models/Project');
        const project = await ProjectModel.findById(sheet.project_id);
        if (project) {
          userId = project.user_id;
        }
      }

      // Парсим URL для получения ID и GID
      const urlData = GoogleSheetModel.parseSpreadsheetUrl(sheet.spreadsheet_url);
      if (!urlData) {
        throw new Error('Invalid Google Sheets URL');
      }

      // Обновляем статус на "analyzing"
      await GoogleSheetModel.update(sheetId, { status: 'analyzing' });

      // Читаем данные из таблицы
      const sheetData = await this.readSheetData(
        urlData.spreadsheetId,
        urlData.gid,
        sheet.url_column,
        sheet.target_column,
        sheet.result_range_start,
        sheet.result_range_end,
        sheet.target_domain
      );

      console.log(`📊 Sheet data: ${sheetData.totalRows} total links, ${sheetData.uniqueUrls} unique URLs`);

      if (sheetData.hasExistingData) {
        console.log('⚠️  Warning: Existing data found in result range. It will be overwritten.');
      }

      // Сбрасываем статистику - удаляем старые записи для этого Google Sheet
      await ManualLinkModel.deleteByProjectIdAndType(sheet.project_id, 'google_sheets');
      console.log('🗑️ Cleared previous Google Sheets analysis data');

      // Создаем записи в manual_links для анализа
      const linksToCreate = sheetData.urls.map((url, index) => ({
        project_id: sheet.project_id,
        url,
        target_domain: sheet.target_domain, // Нормализованный домен
        original_target_domain: sheetData.targets[index] || sheet.target_domain, // Оригинальный target или fallback
        type: 'google_sheets' as const
      }));

      // Создаем ссылки в базе данных
      const createdLinks = await ManualLinkModel.createMany(linksToCreate);
      console.log(`✅ Created ${createdLinks.length} links for analysis`);

      // Добавляем все ссылки в очередь анализа
      for (const link of createdLinks) {
        if (!link) continue;
        
        await QueueService.addToQueue(
          'google_sheets',
          userId || '', // Используем полученный user_id
          sheet.project_id,
          link.url,
          link.target_domain,
          link.id,
          sheetId
        );
      }

      console.log(`📥 Added ${createdLinks.length} links to analysis queue`);

      // Отправляем событие о начале анализа
      SocketService.emitToProject(sheet.project_id, 'sheets_analysis_started', {
        projectId: sheet.project_id,
        sheetId,
        total: createdLinks.length,
        processed: 0
      });

      // Анализируем каждую ссылку
      const analysisResults = [];
      for (let i = 0; i < createdLinks.length; i++) {
        const link = createdLinks[i];
        if (!link) continue; // Пропускаем если ссылка undefined
        
        try {
          console.log(`🔍 Analyzing: ${link.url}`);
          
          // Обновляем статус на "checking"
          await ManualLinkModel.update(link.id, {
            status: 'checking'
          });

          // Отправляем обновление статуса
          SocketService.emitToProject(sheet.project_id, 'sheets_link_updated', {
            projectId: sheet.project_id,
            sheetId,
            linkId: link.id,
            status: 'checking',
            response_code: 'checking...',
            indexable: 'checking...',
            link_type: 'checking...',
            canonical_url: 'checking...',
            load_time: 'checking...',
            full_a_tag: 'checking...',
            checked_at: new Date()
          });
          
          const result = await LinkAnalyzer.analyzeLink(link.url, link.target_domain);
          
          // Обновляем ссылку в базе данных
          const updateData: any = {
            status: result.status,
            response_code: result.responseCode,
            indexable: result.indexable,
            link_type: result.linkType,
            load_time: result.loadTime,
            checked_at: new Date()
          };

          // Добавляем опциональные поля только если они есть
          if (result.canonicalUrl) {
            updateData.canonical_url = result.canonicalUrl;
          }
          if (result.fullATag) {
            updateData.full_a_tag = result.fullATag;
          }
          if (result.nonIndexableReason) {
            updateData.non_indexable_reason = result.nonIndexableReason;
          }

          await ManualLinkModel.update(link.id, updateData);

          // Отправляем финальный результат
          SocketService.emitToProject(sheet.project_id, 'sheets_link_updated', {
            projectId: sheet.project_id,
            sheetId,
            linkId: link.id,
            status: result.status,
            response_code: result.responseCode,
            indexable: result.indexable ? 'Yes' : 'No',
            link_type: result.linkType,
            canonical_url: result.canonicalUrl || 'Not found',
            load_time: result.loadTime,
            full_a_tag: result.fullATag || 'Not found',
            non_indexable_reason: result.nonIndexableReason || 'Not analyzed yet',
            checked_at: new Date()
          });

          // Отправляем прогресс
          SocketService.emitToProject(sheet.project_id, 'sheets_analysis_progress', {
            projectId: sheet.project_id,
            sheetId,
            processed: i + 1,
            total: createdLinks.length,
            percentage: Math.round(((i + 1) / createdLinks.length) * 100)
          });

          // Подготавливаем результат для записи в Google Sheets
          const analysisResult: any = {
            status: result.status,
            responseCode: result.responseCode,
            indexable: result.indexable,
            linkFound: result.linkType !== 'not_found'
          };

          // Добавляем опциональные поля только если они есть
          if (result.nonIndexableReason) {
            analysisResult.nonIndexableReason = result.nonIndexableReason;
          }
          if (result.linkType !== 'not_found') {
            analysisResult.linkFoundTime = new Date();
          }

          analysisResults.push(analysisResult);

          console.log(`✅ Analyzed: ${link.url} - ${result.status}`);

          // Небольшая задержка для плавности
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          console.error(`❌ Error analyzing ${link.url}:`, error);
          
          // Обновляем ссылку с ошибкой
          await ManualLinkModel.update(link.id, {
            status: 'Problem',
            response_code: 0,
            indexable: false,
            link_type: 'not_found',
            canonical_url: 'Error',
            load_time: 0,
            full_a_tag: 'Error',
            checked_at: new Date()
          });

          // Отправляем ошибку
          SocketService.emitToProject(sheet.project_id, 'sheets_link_updated', {
            projectId: sheet.project_id,
            sheetId,
            linkId: link.id,
            status: 'Problem',
            response_code: 0,
            indexable: 'No',
            link_type: 'not_found',
            canonical_url: 'Error',
            load_time: 0,
            full_a_tag: 'Error',
            checked_at: new Date()
          });

          // Добавляем результат с ошибкой
          analysisResults.push({
            status: 'Problem',
            responseCode: 0,
            indexable: false,
            nonIndexableReason: 'Analysis failed',
            linkFound: false
          });
        }
      }

      // Записываем результаты в Google Sheets
      await this.writeAnalysisResults(
        urlData.spreadsheetId,
        urlData.gid,
        sheet.result_range_start,
        sheet.result_range_end,
        analysisResults
      );

      // Обновляем статус и информацию о скане
      await GoogleSheetModel.updateScanInfo(sheetId, 'checked', sheet.scan_count + 1, sheet.schedule_interval);

      // Отправляем событие о завершении анализа
      SocketService.emitToProject(sheet.project_id, 'sheets_analysis_completed', {
        projectId: sheet.project_id,
        sheetId,
        total: createdLinks.length,
        processed: createdLinks.length
      });

      console.log(`✅ Google Sheet analysis completed: ${sheetId}`);

    } catch (error) {
      console.error(`❌ Error analyzing Google Sheet ${sheetId}:`, error);
      
      // Обновляем статус на error
      await GoogleSheetModel.update(sheetId, { status: 'error' });
      
      // Отправляем событие об ошибке
      const sheet = await GoogleSheetModel.findById(sheetId);
      if (sheet) {
        SocketService.emitToProject(sheet.project_id, 'sheets_analysis_error', {
          projectId: sheet.project_id,
          sheetId,
          error: 'Analysis failed'
        });
      }
      
      throw error;
    }
  }

  // Конвертация буквы столбца в индекс (A=0, B=1, ..., Z=25, AA=26, etc.)
  private static columnToIndex(column: string): number {
    let result = 0;
    for (let i = 0; i < column.length; i++) {
      result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return result - 1; // A должен быть 0, а не 1
  }
}
