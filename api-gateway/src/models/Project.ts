import { query } from '../config/database';
import { UserModel } from './User';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectData {
  user_id: string;
  name: string;
}

export interface UpdateProjectData {
  name?: string;
}

export interface ProjectWithStats extends Project {
  stats: {
    totalLinks: number;
    uniqueDomains: number; // Количество уникальных анализируемых URL
    activeSheets: number;
    lastCheck: Date | null;
  };
}

export class ProjectModel {
  // Создание нового проекта
  static async create(projectData: CreateProjectData): Promise<Project> {
    const { user_id, name } = projectData;
    
    const result = await query(
      `INSERT INTO projects (user_id, name) 
       VALUES ($1, $2) 
       RETURNING *`,
      [user_id, name]
    );
    
    return result.rows[0];
  }

  // Поиск проекта по ID
  static async findById(id: string): Promise<Project | null> {
    const result = await query(
      'SELECT * FROM projects WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  }

  // Поиск проекта по ID с проверкой владельца
  static async findByIdAndOwner(id: string, user_id: string): Promise<Project | null> {
    const result = await query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );
    
    return result.rows[0] || null;
  }

  // Получение всех проектов пользователя
  static async findByUserId(user_id: string): Promise<Project[]> {
    const result = await query(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [user_id]
    );
    
    return result.rows;
  }

  // Получение проектов пользователя со статистикой
  static async findByUserIdWithStats(user_id: string): Promise<ProjectWithStats[]> {
    const result = await query(
      `SELECT 
        p.*,
        COALESCE(link_stats.total_links, 0) as total_links,
        COALESCE(link_stats.unique_domains, 0) as unique_domains,
        COALESCE(sheet_stats.active_sheets, 0) as active_sheets,
        link_stats.last_check
       FROM projects p
       LEFT JOIN (
         SELECT 
           project_id,
           COUNT(*) as total_links,
           COUNT(DISTINCT url) as unique_domains,
           MAX(checked_at) as last_check
         FROM manual_links
         GROUP BY project_id
       ) link_stats ON p.id = link_stats.project_id
       LEFT JOIN (
         SELECT 
           project_id,
           COUNT(*) as active_sheets
         FROM google_sheets
         WHERE status = 'active'
         GROUP BY project_id
       ) sheet_stats ON p.id = sheet_stats.project_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [user_id]
    );
    
    return result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        totalLinks: parseInt(row.total_links),
        uniqueDomains: parseInt(row.unique_domains),
        activeSheets: parseInt(row.active_sheets),
        lastCheck: row.last_check
      }
    }));
  }

  // Обновление проекта
  static async update(id: string, updateData: UpdateProjectData): Promise<Project | null> {
    const { name } = updateData;
    
    if (!name) {
      return this.findById(id);
    }

    const result = await query(
      `UPDATE projects 
       SET name = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [name, id]
    );

    return result.rows[0] || null;
  }

  // Удаление проекта
  static async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM projects WHERE id = $1 RETURNING id',
      [id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Получение статистики проекта
  static async getProjectStats(projectId: string): Promise<any> {
    // Статистика по ручным ссылкам
    const linksResult = await query(
      `SELECT 
        COUNT(*) as total_links,
        COUNT(DISTINCT url) as unique_domains,
        COUNT(CASE WHEN status = 'OK' THEN 1 END) as ok_links,
        COUNT(CASE WHEN status = 'Problem' THEN 1 END) as problem_links,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_links,
        AVG(load_time) as avg_load_time,
        MAX(checked_at) as last_check
       FROM manual_links 
       WHERE project_id = $1`,
      [projectId]
    );

    // Статистика по Google Sheets
    const sheetsResult = await query(
      `SELECT 
        COUNT(*) as total_sheets,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sheets,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as error_sheets,
        SUM(scan_count) as total_scans
       FROM google_sheets 
       WHERE project_id = $1`,
      [projectId]
    );

    // Статистика по статусам ссылок
    const statusStatsResult = await query(
      `SELECT 
        status,
        COUNT(*) as count
       FROM manual_links 
       WHERE project_id = $1 
       GROUP BY status`,
      [projectId]
    );

    // Статистика по типам ссылок
    const linkTypeStatsResult = await query(
      `SELECT 
        link_type,
        COUNT(*) as count
       FROM manual_links 
       WHERE project_id = $1 AND link_type IS NOT NULL
       GROUP BY link_type`,
      [projectId]
    );

    // Статистика по кодам ответа
    const responseCodeStatsResult = await query(
      `SELECT 
        response_code,
        COUNT(*) as count
       FROM manual_links 
       WHERE project_id = $1 AND response_code IS NOT NULL
       GROUP BY response_code`,
      [projectId]
    );

    const linksStats = linksResult.rows[0];
    const sheetsStats = sheetsResult.rows[0];

    return {
      links: {
        total: parseInt(linksStats.total_links),
        uniqueDomains: parseInt(linksStats.unique_domains),
        ok: parseInt(linksStats.ok_links),
        problem: parseInt(linksStats.problem_links),
        pending: parseInt(linksStats.pending_links),
        avgLoadTime: linksStats.avg_load_time ? Math.round(linksStats.avg_load_time) : 0,
        lastCheck: linksStats.last_check
      },
      sheets: {
        total: parseInt(sheetsStats.total_sheets),
        active: parseInt(sheetsStats.active_sheets),
        error: parseInt(sheetsStats.error_sheets),
        totalScans: parseInt(sheetsStats.total_scans)
      },
      statusDistribution: statusStatsResult.rows,
      linkTypeDistribution: linkTypeStatsResult.rows,
      responseCodeDistribution: responseCodeStatsResult.rows
    };
  }

  // Проверка лимитов проекта для пользователя
  static async checkProjectLimits(userId: string): Promise<{ canCreate: boolean; currentCount: number; limit: number }> {
    const user = await UserModel.findById(userId);
    if (!user) {
      return { canCreate: false, currentCount: 0, limit: 0 };
    }

    const limits = UserModel.getPlanLimits(user.subscription_plan);
    
    const result = await query(
      'SELECT COUNT(*) FROM projects WHERE user_id = $1',
      [userId]
    );
    
    const currentCount = parseInt(result.rows[0].count);
    const canCreate = limits.projects === -1 || currentCount < limits.projects;

    return {
      canCreate,
      currentCount,
      limit: limits.projects
    };
  }

  // Получение проектов с пагинацией
  static async findByUserIdPaginated(
    user_id: string, 
    page: number = 1, 
    limit: number = 10
  ): Promise<{ projects: ProjectWithStats[]; total: number; pages: number }> {
    const offset = (page - 1) * limit;

    // Получение общего количества
    const countResult = await query(
      'SELECT COUNT(*) FROM projects WHERE user_id = $1',
      [user_id]
    );
    const total = parseInt(countResult.rows[0].count);

    // Получение проектов с пагинацией
    const projectsResult = await query(
      `SELECT 
        p.*,
        COALESCE(link_stats.total_links, 0) as total_links,
        COALESCE(link_stats.unique_domains, 0) as unique_domains,
        COALESCE(sheet_stats.active_sheets, 0) as active_sheets,
        link_stats.last_check
       FROM projects p
       LEFT JOIN (
         SELECT 
           project_id,
           COUNT(*) as total_links,
           COUNT(DISTINCT url) as unique_domains,
           MAX(checked_at) as last_check
         FROM manual_links
         GROUP BY project_id
       ) link_stats ON p.id = link_stats.project_id
       LEFT JOIN (
         SELECT 
           project_id,
           COUNT(*) as active_sheets
         FROM google_sheets
         WHERE status = 'active'
         GROUP BY project_id
       ) sheet_stats ON p.id = sheet_stats.project_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );

    const projects = projectsResult.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        totalLinks: parseInt(row.total_links),
        uniqueDomains: parseInt(row.unique_domains),
        activeSheets: parseInt(row.active_sheets),
        lastCheck: row.last_check
      }
    }));

    return {
      projects,
      total,
      pages: Math.ceil(total / limit)
    };
  }

  // Поиск проектов по названию
  static async searchByUserId(user_id: string, searchTerm: string): Promise<Project[]> {
    const result = await query(
      `SELECT * FROM projects 
       WHERE user_id = $1 AND name ILIKE $2 
       ORDER BY created_at DESC`,
      [user_id, `%${searchTerm}%`]
    );
    
    return result.rows;
  }

  // Получение проектов с истекшими проверками (для планировщика)
  static async getProjectsWithExpiredChecks(): Promise<Project[]> {
    const result = await query(
      `SELECT DISTINCT p.* 
       FROM projects p
       JOIN google_sheets gs ON p.id = gs.project_id
       WHERE gs.status = 'active' 
       AND gs.next_scan <= CURRENT_TIMESTAMP`,
      []
    );
    
    return result.rows;
  }
}
