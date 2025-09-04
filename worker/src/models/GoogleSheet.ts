import { query } from '../config/database';

export interface GoogleSheet {
  id: string;
  project_id: string;
  user_id: string; // Добавляем user_id для получения приоритета
  spreadsheet_url: string;
  target_domain: string;
  url_column: string;
  target_column: string;
  result_range_start: string;
  result_range_end: string;
  schedule_interval: string;
  status: 'not_started' | 'analyzing' | 'checked' | 'inactive' | 'error';
  last_scan: Date | string; // "not started yet" если null
  next_scan: Date | string; // "not scheduled" если null
  scan_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateGoogleSheetData {
  project_id: string;
  user_id: string; // Добавляем user_id
  spreadsheet_url: string;
  target_domain: string;
  url_column: string;
  target_column: string;
  result_range_start: string;
  result_range_end: string;
  schedule_interval: string;
}

export interface UpdateGoogleSheetData {
  target_domain?: string;
  url_column?: string;
  target_column?: string;
  result_range_start?: string;
  result_range_end?: string;
  schedule_interval?: string;
  status?: 'not_started' | 'analyzing' | 'checked' | 'inactive' | 'error';
  last_scan?: Date;
  next_scan?: Date;
  scan_count?: number;
}

export interface GoogleSheetWithStats extends GoogleSheet {
  stats: {
    totalLinks: number;
    uniqueDomains: number;
    pendingLinks: number;
    analyzedLinks: number;
  };
}

export class GoogleSheetModel {
  // Создание новой Google Sheet записи
  static async create(sheetData: CreateGoogleSheetData): Promise<GoogleSheet> {
    const {
      project_id,
      user_id,
      spreadsheet_url,
      target_domain,
      url_column,
      target_column,
      result_range_start,
      result_range_end,
      schedule_interval
    } = sheetData;

    const result = await query(
      `INSERT INTO google_sheets (
        project_id, user_id, spreadsheet_url, target_domain, url_column, target_column,
        result_range_start, result_range_end, schedule_interval, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'not_started')
      RETURNING *`,
      [
        project_id, user_id, spreadsheet_url, target_domain, url_column, target_column,
        result_range_start, result_range_end, schedule_interval
      ]
    );

    return result.rows[0];
  }

  // Получение Google Sheet по ID
  static async findById(id: string): Promise<GoogleSheet | null> {
    const result = await query(
      `SELECT 
        *,
        COALESCE(last_scan::text, 'not started yet') as last_scan,
        COALESCE(next_scan::text, 'not scheduled') as next_scan
      FROM google_sheets WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  // Получение Google Sheet по ID и владельцу проекта
  static async findByIdAndOwner(id: string, user_id: string): Promise<GoogleSheet | null> {
    const result = await query(
      `SELECT 
        gs.*,
        COALESCE(gs.last_scan::text, 'not started yet') as last_scan,
        COALESCE(gs.next_scan::text, 'not scheduled') as next_scan
      FROM google_sheets gs
      JOIN projects p ON gs.project_id = p.id
      WHERE gs.id = $1 AND p.user_id = $2`,
      [id, user_id]
    );

    return result.rows[0] || null;
  }

  // Получение всех Google Sheets проекта
  static async findByProjectId(projectId: string): Promise<GoogleSheet[]> {
    const result = await query(
      `SELECT 
        *,
        COALESCE(last_scan::text, 'not started yet') as last_scan,
        COALESCE(next_scan::text, 'not scheduled') as next_scan
      FROM google_sheets 
      WHERE project_id = $1 
      ORDER BY created_at DESC`,
      [projectId]
    );

    return result.rows;
  }

  // Получение Google Sheets проекта со статистикой
  static async findByProjectIdWithStats(projectId: string): Promise<GoogleSheetWithStats[]> {
    const result = await query(
      `SELECT 
        gs.*,
        COALESCE(gs.last_scan::text, 'not started yet') as last_scan,
        COALESCE(gs.next_scan::text, 'not scheduled') as next_scan,
        COALESCE(link_stats.total_links, 0) as total_links,
        COALESCE(link_stats.unique_domains, 0) as unique_domains,
        COALESCE(link_stats.pending_links, 0) as pending_links,
        COALESCE(link_stats.analyzed_links, 0) as analyzed_links
      FROM google_sheets gs
      LEFT JOIN (
        SELECT 
          project_id,
          COUNT(*) as total_links,
          COUNT(DISTINCT url) as unique_domains,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_links,
          COUNT(CASE WHEN status IN ('OK', 'Problem') THEN 1 END) as analyzed_links
        FROM manual_links
        WHERE type = 'google_sheets'
        GROUP BY project_id
      ) link_stats ON gs.project_id = link_stats.project_id
      WHERE gs.project_id = $1 
      ORDER BY gs.created_at DESC`,
      [projectId]
    );

    return result.rows.map(row => ({
      id: row.id,
      project_id: row.project_id,
      user_id: row.user_id,
      spreadsheet_url: row.spreadsheet_url,
      target_domain: row.target_domain,
      url_column: row.url_column,
      target_column: row.target_column,
      result_range_start: row.result_range_start,
      result_range_end: row.result_range_end,
      schedule_interval: row.schedule_interval,
      status: row.status,
      last_scan: row.last_scan,
      next_scan: row.next_scan,
      scan_count: row.scan_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        totalLinks: parseInt(row.total_links),
        uniqueDomains: parseInt(row.unique_domains),
        pendingLinks: parseInt(row.pending_links),
        analyzedLinks: parseInt(row.analyzed_links)
      }
    }));
  }

  // Обновление Google Sheet
  static async update(id: string, updateData: UpdateGoogleSheetData): Promise<GoogleSheet | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      return await this.findById(id);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await query(
      `UPDATE google_sheets SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  // Удаление Google Sheet
  static async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM google_sheets WHERE id = $1 RETURNING id',
      [id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Получение статистики Google Sheet
  static async getSheetStats(sheetId: string): Promise<any> {
    const result = await query(
      `SELECT 
        gs.*,
        COALESCE(gs.last_scan::text, 'not started yet') as last_scan,
        COALESCE(gs.next_scan::text, 'not scheduled') as next_scan,
        COALESCE(link_stats.total_links, 0) as total_links,
        COALESCE(link_stats.unique_domains, 0) as unique_domains,
        COALESCE(link_stats.pending_links, 0) as pending_links,
        COALESCE(link_stats.analyzed_links, 0) as analyzed_links,
        COALESCE(link_stats.ok_links, 0) as ok_links,
        COALESCE(link_stats.problem_links, 0) as problem_links
      FROM google_sheets gs
      LEFT JOIN (
        SELECT 
          project_id,
          COUNT(*) as total_links,
          COUNT(DISTINCT url) as unique_domains,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_links,
          COUNT(CASE WHEN status IN ('OK', 'Problem') THEN 1 END) as analyzed_links,
          COUNT(CASE WHEN status = 'OK' THEN 1 END) as ok_links,
          COUNT(CASE WHEN status = 'Problem' THEN 1 END) as problem_links
        FROM manual_links
        WHERE type = 'google_sheets'
        GROUP BY project_id
      ) link_stats ON gs.project_id = link_stats.project_id
      WHERE gs.id = $1`,
      [sheetId]
    );

    const sheet = result.rows[0];
    if (!sheet) return null;

    return {
      sheet: {
        id: sheet.id,
        project_id: sheet.project_id,
        spreadsheet_url: sheet.spreadsheet_url,
        target_domain: sheet.target_domain,
        url_column: sheet.url_column,
        target_column: sheet.target_column,
        result_range_start: sheet.result_range_start,
        result_range_end: sheet.result_range_end,
        schedule_interval: sheet.schedule_interval,
        status: sheet.status,
        last_scan: sheet.last_scan,
        next_scan: sheet.next_scan,
        scan_count: sheet.scan_count,
        created_at: sheet.created_at,
        updated_at: sheet.updated_at
      },
      stats: {
        totalLinks: parseInt(sheet.total_links),
        uniqueDomains: parseInt(sheet.unique_domains),
        pendingLinks: parseInt(sheet.pending_links),
        analyzedLinks: parseInt(sheet.analyzed_links),
        okLinks: parseInt(sheet.ok_links),
        problemLinks: parseInt(sheet.problem_links)
      }
    };
  }

    // Получение активных Google Sheets для планировщика
  static async getActiveSheets(): Promise<GoogleSheet[]> {
    const result = await query(
      `SELECT 
        id, project_id, user_id, spreadsheet_url, target_domain, 
        url_column, target_column, result_range_start, result_range_end,
        schedule_interval, status, scan_count, created_at, updated_at,
        last_scan,
        next_scan
      FROM google_sheets 
      WHERE status IN ('not_started', 'checked') 
      AND schedule_interval != 'manual'
      ORDER BY google_sheets.next_scan ASC NULLS FIRST`,
      []
    );
    
    return result.rows;
  }

  // Обновление статуса и времени следующего скана
  static async updateScanInfo(id: string, status: string, scanCount?: number, interval?: string): Promise<void> {
    const nextScan = this.calculateNextScan(status, interval);
    
    await query(
      `UPDATE google_sheets 
       SET status = $1, 
           last_scan = CURRENT_TIMESTAMP,
           next_scan = $2,
           scan_count = COALESCE($3, scan_count + 1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, nextScan, scanCount, id]
    );
  }

  // Вычисление времени следующего скана
  private static calculateNextScan(status: string, interval?: string): Date | null {
    if (status === 'analyzing') {
      return null; // Не планируем следующий скан во время анализа
    }

    if (status === 'checked' && interval && interval !== 'manual') {
      // Вычисляем время следующего скана на основе интервала
      return this.calculateNextRunTime(interval);
    }

    return null;
  }

  // Вычисление времени следующего запуска на основе интервала
  private static calculateNextRunTime(interval: string): Date {
    const now = new Date();
    
    switch (interval) {
      case '5m':
        return new Date(now.getTime() + 5 * 60 * 1000);
      case '30m':
        return new Date(now.getTime() + 30 * 60 * 1000);
      case '1h':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case '4h':
        return new Date(now.getTime() + 4 * 60 * 60 * 1000);
      case '8h':
        return new Date(now.getTime() + 8 * 60 * 60 * 1000);
      case '12h':
        return new Date(now.getTime() + 12 * 60 * 60 * 1000);
      case '1d':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '3d':
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case '1w':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '1M':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 60 * 60 * 1000); // По умолчанию 1 час
    }
  }

  // Парсинг URL Google Sheets для извлечения ID и GID
  static parseSpreadsheetUrl(url: string): { spreadsheetId: string; gid: string } | null {
    try {
      // Примеры URL: 
      // https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
      // https://docs.google.com/spreadsheets/d/1C6kvl6hL7aKmysvK9dahLmQIrIoI1uEdv2W3GBVIqs4/edit?gid=1119158008#gid=1119158008
      const urlObj = new URL(url);
      
      if (!urlObj.hostname.includes('docs.google.com')) {
        return null;
      }

      const pathParts = urlObj.pathname.split('/');
      const spreadsheetIndex = pathParts.indexOf('d');
      
      if (spreadsheetIndex === -1 || spreadsheetIndex + 1 >= pathParts.length) {
        return null;
      }

      const spreadsheetId = pathParts[spreadsheetIndex + 1];
      
      // Проверяем, что spreadsheetId существует
      if (!spreadsheetId) {
        return null;
      }
      
      // Извлекаем GID из hash или query параметров
      let gid = '0'; // По умолчанию
      
      // Сначала проверяем query параметры (?gid=1119158008)
      if (urlObj.searchParams.has('gid')) {
        gid = urlObj.searchParams.get('gid') || '0';
      }
      // Затем проверяем hash (#gid=1119158008)
      else if (urlObj.hash.includes('gid=')) {
        const gidMatch = urlObj.hash.match(/gid=(\d+)/);
        if (gidMatch && gidMatch[1]) {
          gid = gidMatch[1];
        }
      }

      return { spreadsheetId, gid };
    } catch (error) {
      return null;
    }
  }

  // Валидация диапазона результатов (должен быть ровно 5 столбцов)
  static validateResultRange(startCol: string, endCol: string): boolean {
    const startIndex = this.columnToIndex(startCol);
    const endIndex = this.columnToIndex(endCol);
    
    return (endIndex - startIndex + 1) === 5;
  }

  // Конвертация буквы столбца в индекс (A=0, B=1, ..., Z=25, AA=26, ...)
  private static columnToIndex(column: string): number {
    let result = 0;
    for (let i = 0; i < column.length; i++) {
      result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return result - 1;
  }
}
