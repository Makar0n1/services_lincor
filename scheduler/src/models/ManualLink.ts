import { query } from '../config/database';

export interface ManualLink {
  id: string;
  project_id: string;
  url: string;
  target_domain: string; // Нормализованный домен для поиска
  original_target_domain?: string; // Оригинальный домен от пользователя
  type: 'manual' | 'google_sheets'; // Тип ссылки для различения источника
  status: 'pending' | 'checking' | 'OK' | 'Problem';
  response_code?: number | string; // Может быть числом или "Not analyzed yet"
  indexable?: boolean | string; // Может быть boolean или "Not analyzed yet"
  link_type?: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found' | string; // Может быть типом или "Not analyzed yet"
  canonical_url?: string;
  load_time?: number | string; // Может быть числом или "Not analyzed yet"
  full_a_tag?: string; // Полный HTML тег <a> где найдена ссылка
  non_indexable_reason?: string; // Причина неиндексабельности
  created_at: Date;
  checked_at?: Date;
}

export interface CreateManualLinkData {
  project_id: string;
  url: string;
  target_domain: string; // Нормализованный домен для поиска
  original_target_domain?: string; // Оригинальный домен от пользователя
  type?: 'manual' | 'google_sheets'; // Тип ссылки (по умолчанию 'manual')
}

export interface UpdateManualLinkData {
  status?: 'pending' | 'checking' | 'OK' | 'Problem';
  response_code?: number;
  indexable?: boolean;
  link_type?: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found';
  canonical_url?: string;
  load_time?: number;
  full_a_tag?: string; // Полный HTML тег <a> где найдена ссылка
  non_indexable_reason?: string; // Причина неиндексабельности
  checked_at?: Date;
}

export interface LinkAnalysisResult {
  status: 'OK' | 'Problem';
  responseCode: number;
  indexable: boolean;
  linkType: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc' | 'not_found';
  canonicalUrl?: string;
  loadTime: number;
  fullATag?: string; // Полный HTML тег <a> где найдена ссылка
  nonIndexableReason?: string; // Причина неиндексабельности (например, "Meta robots: noindex", "Canonicalized")
  error?: string;
}

export class ManualLinkModel {
  // Создание новой ссылки
  static async create(linkData: CreateManualLinkData): Promise<ManualLink> {
    const { project_id, url, target_domain, original_target_domain, type = 'manual' } = linkData;
    
    const result = await query(
      `INSERT INTO manual_links (project_id, url, target_domain, original_target_domain, type) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [project_id, url, target_domain, original_target_domain, type]
    );
    
    return result.rows[0];
  }

  // Создание нескольких ссылок
  static async createMany(linksData: CreateManualLinkData[]): Promise<ManualLink[]> {
    if (linksData.length === 0) return [];

    const values = linksData.map((_, index) => {
      const baseIndex = index * 5;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`;
    }).join(', ');

    const params = linksData.flatMap(link => [
      link.project_id, 
      link.url, 
      link.target_domain, 
      link.original_target_domain,
      link.type || 'manual'
    ]);

    const result = await query(
      `INSERT INTO manual_links (project_id, url, target_domain, original_target_domain, type) 
       VALUES ${values} 
       RETURNING *`,
      params
    );
    
    return result.rows;
  }

  // Поиск ссылки по ID
  static async findById(id: string): Promise<ManualLink | null> {
    const result = await query(
      'SELECT * FROM manual_links WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  }

  // Получение всех ссылок проекта
  static async findByProjectId(projectId: string): Promise<ManualLink[]> {
    const result = await query(
      `SELECT 
        id, project_id, url, 
        COALESCE(original_target_domain, target_domain) as target_domain,
        original_target_domain,
        type,
        status, 
        COALESCE(response_code::text, 'Not analyzed yet') as response_code,
        COALESCE(
          CASE 
            WHEN indexable IS NULL THEN 'Not analyzed yet'
            WHEN indexable = true THEN 'Yes'
            ELSE 'No'
          END, 'Not analyzed yet'
        ) as indexable,
        COALESCE(link_type, 'Not analyzed yet') as link_type,
        COALESCE(canonical_url, 'Not analyzed yet') as canonical_url,
        COALESCE(load_time::text, 'Not analyzed yet') as load_time,
        COALESCE(full_a_tag, 'Not analyzed yet') as full_a_tag,
        created_at, 
        COALESCE(checked_at::text, 'Not analyzed yet') as checked_at
       FROM manual_links 
       WHERE project_id = $1 
       ORDER BY created_at DESC`,
      [projectId]
    );
    
    return result.rows;
  }

  // Получение ссылок проекта с пагинацией
  static async findByProjectIdPaginated(
    projectId: string,
    page: number = 1,
    limit: number = 50,
    filters?: {
      status?: string;
      linkType?: string;
      responseCode?: number;
    }
  ): Promise<{ links: ManualLink[]; total: number; pages: number }> {
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE project_id = $1';
    let params = [projectId];
    let paramIndex = 2;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters?.linkType) {
      whereClause += ` AND link_type = $${paramIndex}`;
      params.push(filters.linkType);
      paramIndex++;
    }

    if (filters?.responseCode) {
      whereClause += ` AND response_code = $${paramIndex}`;
      params.push(filters.responseCode.toString());
      paramIndex++;
    }

    // Получение общего количества
    const countResult = await query(
      `SELECT COUNT(*) FROM manual_links ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Получение ссылок с пагинацией
    const linksResult = await query(
      `SELECT 
        id, project_id, url, 
        COALESCE(original_target_domain, target_domain) as target_domain,
        original_target_domain,
        type,
        status, 
        COALESCE(response_code::text, 'Not analyzed yet') as response_code,
        COALESCE(
          CASE 
            WHEN indexable IS NULL THEN 'Not analyzed yet'
            WHEN indexable = true THEN 'Yes'
            ELSE 'No'
          END, 'Not analyzed yet'
        ) as indexable,
        COALESCE(link_type, 'Not analyzed yet') as link_type,
        COALESCE(canonical_url, 'Not analyzed yet') as canonical_url,
        COALESCE(load_time::text, 'Not analyzed yet') as load_time,
        COALESCE(full_a_tag, 'Not analyzed yet') as full_a_tag,
        created_at, 
        COALESCE(checked_at::text, 'Not analyzed yet') as checked_at
       FROM manual_links 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      links: linksResult.rows,
      total,
      pages: Math.ceil(total / limit)
    };
  }

  // Обновление ссылки
  static async update(id: string, updateData: UpdateManualLinkData): Promise<ManualLink | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Динамическое построение запроса
    if (updateData.status !== undefined) {
      fields.push(`status = $${paramCount}`);
      values.push(updateData.status);
      paramCount++;
    }

    if (updateData.response_code !== undefined) {
      fields.push(`response_code = $${paramCount}`);
      values.push(updateData.response_code);
      paramCount++;
    }

    if (updateData.indexable !== undefined) {
      fields.push(`indexable = $${paramCount}`);
      values.push(updateData.indexable);
      paramCount++;
    }

    if (updateData.link_type !== undefined) {
      fields.push(`link_type = $${paramCount}`);
      values.push(updateData.link_type);
      paramCount++;
    }

    if (updateData.canonical_url !== undefined) {
      fields.push(`canonical_url = $${paramCount}`);
      values.push(updateData.canonical_url);
      paramCount++;
    }

    if (updateData.load_time !== undefined) {
      fields.push(`load_time = $${paramCount}`);
      values.push(updateData.load_time);
      paramCount++;
    }

    if (updateData.checked_at !== undefined) {
      fields.push(`checked_at = $${paramCount}`);
      values.push(updateData.checked_at);
      paramCount++;
    } else if (fields.length > 0) {
      // Автоматически устанавливаем checked_at при обновлении
      fields.push(`checked_at = CURRENT_TIMESTAMP`);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await query(
      `UPDATE manual_links SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  // Удаление ссылки
  static async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM manual_links WHERE id = $1 RETURNING id',
      [id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Удаление всех ссылок проекта
  static async deleteByProjectId(projectId: string): Promise<number> {
    const result = await query(
      'DELETE FROM manual_links WHERE project_id = $1',
      [projectId]
    );
    
    return result.rowCount || 0;
  }

  // Получение ссылок для анализа
  static async getPendingLinks(limit: number = 10): Promise<ManualLink[]> {
    const result = await query(
      `SELECT * FROM manual_links 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT $1`,
      [limit]
    );
    
    return result.rows;
  }

  // Обновление статуса на "checking"
  static async markAsChecking(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    
    await query(
      `UPDATE manual_links 
       SET status = 'checking' 
       WHERE id IN (${placeholders})`,
      ids
    );
  }

  // Получение статистики ссылок проекта
  static async getProjectLinkStats(projectId: string): Promise<any> {
    const result = await query(
      `SELECT 
        COUNT(*) as total_links,
        COUNT(DISTINCT url) as unique_domains,
        COUNT(CASE WHEN status = 'OK' THEN 1 END) as ok_links,
        COUNT(CASE WHEN status = 'Problem' THEN 1 END) as problem_links,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_links,
        COUNT(CASE WHEN status = 'checking' THEN 1 END) as checking_links,
        COUNT(CASE WHEN link_type = 'dofollow' THEN 1 END) as dofollow_links,
        COUNT(CASE WHEN link_type = 'nofollow' THEN 1 END) as nofollow_links,
        COUNT(CASE WHEN link_type = 'sponsored' THEN 1 END) as sponsored_links,
        COUNT(CASE WHEN link_type = 'ugc' THEN 1 END) as ugc_links,
        COUNT(CASE WHEN indexable = true THEN 1 END) as indexable_links,
        COUNT(CASE WHEN indexable = false THEN 1 END) as non_indexable_links,
        AVG(load_time) as avg_load_time,
        MAX(checked_at) as last_check
       FROM manual_links 
       WHERE project_id = $1`,
      [projectId]
    );
    
    const stats = result.rows[0];
    
    return {
      total: parseInt(stats.total_links),
      uniqueDomains: parseInt(stats.unique_domains), // Количество уникальных анализируемых URL
      status: {
        ok: parseInt(stats.ok_links),
        problem: parseInt(stats.problem_links),
        pending: parseInt(stats.pending_links),
        checking: parseInt(stats.checking_links)
      },
      linkTypes: {
        dofollow: parseInt(stats.dofollow_links),
        nofollow: parseInt(stats.nofollow_links),
        sponsored: parseInt(stats.sponsored_links),
        ugc: parseInt(stats.ugc_links)
      },
      indexability: {
        indexable: parseInt(stats.indexable_links),
        nonIndexable: parseInt(stats.non_indexable_links)
      },
      avgLoadTime: stats.avg_load_time ? Math.round(stats.avg_load_time) : 0,
      lastCheck: stats.last_check
    };
  }

  // Экспорт ссылок в CSV
  static async exportToCSV(projectId: string): Promise<string> {
    const result = await query(
      `SELECT 
        url,
        COALESCE(original_target_domain, target_domain) as target_domain,
        status,
        response_code,
        indexable,
        link_type,
        canonical_url,
        load_time,
        full_a_tag,
        created_at,
        checked_at
       FROM manual_links 
       WHERE project_id = $1 
       ORDER BY created_at DESC`,
      [projectId]
    );
    
    const headers = [
      'URL',
      'Target Domain',
      'Status',
      'Response Code',
      'Indexable',
      'Link Type',
      'Canonical URL',
      'Load Time (ms)',
      'Full A Tag',
      'Created At',
      'Checked At'
    ];
    
    const csvRows = [headers.join(',')];
    
    result.rows.forEach(row => {
      const values = [
        `"${row.url}"`,
        `"${row.target_domain}"`,
        row.status || '',
        row.response_code || '',
        row.indexable ? 'Yes' : 'No',
        row.link_type || '',
        `"${row.canonical_url || ''}"`,
        row.load_time || '',
        `"${(row.full_a_tag || '').replace(/"/g, '""')}"`, // Экранируем кавычки в HTML
        row.created_at,
        row.checked_at || ''
      ];
      csvRows.push(values.join(','));
    });
    
    return csvRows.join('\n');
  }

  // Импорт ссылок из CSV
  static async importFromCSV(projectId: string, csvData: string): Promise<number> {
    const lines = csvData.trim().split('\n');
    const links: CreateManualLinkData[] = [];
    
    // Пропускаем заголовок
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const columns = line.split(',').map(col => col.replace(/"/g, '').trim());
      
      if (columns.length >= 2 && columns[0] && columns[1]) {
        links.push({
          project_id: projectId,
          url: columns[0],
          target_domain: columns[1]
        });
      }
    }
    
    if (links.length > 0) {
      await this.createMany(links);
    }
    
    return links.length;
  }

  // Поиск дубликатов ссылок в проекте
  static async findDuplicates(projectId: string): Promise<ManualLink[]> {
    const result = await query(
      `SELECT * FROM manual_links 
       WHERE project_id = $1 
       AND url IN (
         SELECT url 
         FROM manual_links 
         WHERE project_id = $1 
         GROUP BY url 
         HAVING COUNT(*) > 1
       )
       ORDER BY url, created_at`,
      [projectId]
    );
    
    return result.rows;
  }

  // Удаление дубликатов ссылок
  static async removeDuplicates(projectId: string): Promise<number> {
    const result = await query(
      `DELETE FROM manual_links 
       WHERE id NOT IN (
         SELECT MIN(id) 
         FROM manual_links 
         WHERE project_id = $1 
         GROUP BY url
       ) 
       AND project_id = $1`,
      [projectId]
    );
    
    return result.rowCount || 0;
  }

  /**
   * Удаление ссылок по проекту и типу
   */
  static async deleteByProjectIdAndType(projectId: string, type: 'manual' | 'google_sheets'): Promise<number> {
    try {
      const result = await query(
        'DELETE FROM manual_links WHERE project_id = $1 AND type = $2',
        [projectId, type]
      );
      
      console.log(`🗑️ Deleted ${result.rowCount || 0} ${type} links from project ${projectId}`);
      return result.rowCount || 0;
    } catch (error) {
      console.error('Error deleting links by project and type:', error);
      throw error;
    }
  }

  /**
   * Сброс статуса анализа для ссылок проекта
   */
  static async resetAnalysisStatus(projectId: string, type: 'manual' | 'google_sheets'): Promise<number> {
    try {
      const result = await query(
        `UPDATE manual_links 
         SET status = 'pending', 
             response_code = NULL, 
             indexable = NULL, 
             link_type = NULL, 
             canonical_url = NULL, 
             load_time = NULL, 
             full_a_tag = NULL, 
             non_indexable_reason = NULL, 
             checked_at = NULL
         WHERE project_id = $1 AND type = $2`,
        [projectId, type]
      );
      
      console.log(`🔄 Reset analysis status for ${result.rowCount || 0} ${type} links in project ${projectId}`);
      return result.rowCount || 0;
    } catch (error) {
      console.error('Error resetting analysis status:', error);
      throw error;
    }
  }

  /**
   * Поиск ссылок по проекту и типу
   */
  static async findByProjectIdAndType(projectId: string, type: 'manual' | 'google_sheets'): Promise<ManualLink[]> {
    try {
      const result = await query(
        'SELECT * FROM manual_links WHERE project_id = $1 AND type = $2 ORDER BY created_at DESC',
        [projectId, type]
      );
      
      return result.rows.map((row: any) => this.mapRowToManualLink(row));
    } catch (error) {
      console.error('Error finding links by project and type:', error);
      throw error;
    }
  }

  /**
   * Маппинг строки базы данных в объект ManualLink
   */
  private static mapRowToManualLink(row: any): ManualLink {
    return {
      id: row.id,
      project_id: row.project_id,
      url: row.url,
      target_domain: row.target_domain,
      original_target_domain: row.original_target_domain,
      type: row.type,
      status: row.status,
      response_code: row.response_code,
      indexable: row.indexable,
      link_type: row.link_type,
      canonical_url: row.canonical_url,
      load_time: row.load_time,
      full_a_tag: row.full_a_tag,
      non_indexable_reason: row.non_indexable_reason,
      created_at: row.created_at,
      checked_at: row.checked_at
    };
  }
}
