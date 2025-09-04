import { query } from '../config/database';
import bcrypt from 'bcryptjs';
// import { v4 as uuidv4 } from 'uuid'; // Не используется

export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  subscription_plan: 'free' | 'starter' | 'pro' | 'enterprise';
  subscription_expires?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserData {
  email: string;
  username: string;
  password: string;
}

export interface UpdateUserData {
  email?: string;
  username?: string;
  password?: string;
  subscription_plan?: 'free' | 'starter' | 'pro' | 'enterprise';
  subscription_expires?: Date;
}

export class UserModel {
  // Создание нового пользователя
  static async create(userData: CreateUserData): Promise<User> {
    const { email, username, password } = userData;
    
    // Хеширование пароля
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    const result = await query(
      `INSERT INTO users (email, username, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [email, username, password_hash]
    );
    
    return result.rows[0];
  }

  // Поиск пользователя по ID
  static async findById(id: string): Promise<User | null> {
    const result = await query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  }

  // Поиск пользователя по email
  static async findByEmail(email: string): Promise<User | null> {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    return result.rows[0] || null;
  }

  // Поиск пользователя по username
  static async findByUsername(username: string): Promise<User | null> {
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    return result.rows[0] || null;
  }

  // Обновление пользователя
  static async update(id: string, updateData: UpdateUserData): Promise<User | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Динамическое построение запроса
    if (updateData.email !== undefined) {
      fields.push(`email = $${paramCount}`);
      values.push(updateData.email);
      paramCount++;
    }

    if (updateData.username !== undefined) {
      fields.push(`username = $${paramCount}`);
      values.push(updateData.username);
      paramCount++;
    }

    if (updateData.password !== undefined) {
      const password_hash = await bcrypt.hash(updateData.password, 12);
      fields.push(`password_hash = $${paramCount}`);
      values.push(password_hash);
      paramCount++;
    }

    if (updateData.subscription_plan !== undefined) {
      fields.push(`subscription_plan = $${paramCount}`);
      values.push(updateData.subscription_plan);
      paramCount++;
    }

    if (updateData.subscription_expires !== undefined) {
      fields.push(`subscription_expires = $${paramCount}`);
      values.push(updateData.subscription_expires);
      paramCount++;
    }

    // Добавляем updated_at
    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  // Удаление пользователя
  static async delete(id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Проверка пароля
  static async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }

  // Получение всех пользователей (с пагинацией)
  static async findAll(limit: number = 10, offset: number = 0): Promise<User[]> {
    const result = await query(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    
    return result.rows;
  }

  // Подсчет общего количества пользователей
  static async count(): Promise<number> {
    const result = await query('SELECT COUNT(*) FROM users');
    return parseInt(result.rows[0].count);
  }

  // Получение пользователей по плану подписки
  static async findBySubscriptionPlan(plan: string): Promise<User[]> {
    const result = await query(
      'SELECT * FROM users WHERE subscription_plan = $1',
      [plan]
    );
    
    return result.rows;
  }

  // Получение пользователей с истекшей подпиской
  static async findExpiredSubscriptions(): Promise<User[]> {
    const result = await query(
      `SELECT * FROM users 
       WHERE subscription_plan != 'free' 
       AND subscription_expires < CURRENT_TIMESTAMP`
    );
    
    return result.rows;
  }

  // Обновление подписки
  static async updateSubscription(
    userId: string, 
    plan: 'free' | 'starter' | 'pro' | 'enterprise',
    expiresAt?: Date
  ): Promise<User | null> {
    const updateData: UpdateUserData = {
      subscription_plan: plan,
      ...(expiresAt && { subscription_expires: expiresAt })
    };
    
    return this.update(userId, updateData);
  }

  // Проверка лимитов плана
  static getPlanLimits(plan: string) {
    const limits = {
      free: {
        linksPerMonth: 100,
        projects: 1,
        priority: 4
      },
      starter: {
        linksPerMonth: 1000,
        projects: 5,
        priority: 3
      },
      pro: {
        linksPerMonth: 10000,
        projects: 20,
        priority: 2
      },
      enterprise: {
        linksPerMonth: -1, // безлимит
        projects: -1, // безлимит
        priority: 1
      }
    };

    return limits[plan as keyof typeof limits] || limits.free;
  }

  // Проверка, может ли пользователь создать проект
  static async canCreateProject(userId: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    const limits = this.getPlanLimits(user.subscription_plan);
    if (limits.projects === -1) return true; // безлимит

    // Подсчет существующих проектов
    const result = await query(
      'SELECT COUNT(*) FROM projects WHERE user_id = $1',
      [userId]
    );
    
    const projectCount = parseInt(result.rows[0].count);
    return projectCount < limits.projects;
  }

  // Проверка, может ли пользователь добавить ссылки
  static async canAddLinks(userId: string, linkCount: number): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    const limits = this.getPlanLimits(user.subscription_plan);
    if (limits.linksPerMonth === -1) return true; // безлимит

    // Подсчет ссылок за текущий месяц
    const result = await query(
      `SELECT COUNT(*) FROM manual_links ml
       JOIN projects p ON ml.project_id = p.id
       WHERE p.user_id = $1 
       AND ml.created_at >= date_trunc('month', CURRENT_DATE)`,
      [userId]
    );
    
    const currentMonthLinks = parseInt(result.rows[0].count);
    return (currentMonthLinks + linkCount) <= limits.linksPerMonth;
  }

  // Получение статистики пользователя
  static async getUserStats(userId: string) {
    const user = await this.findById(userId);
    if (!user) return null;

    const limits = this.getPlanLimits(user.subscription_plan);

    // Подсчет проектов
    const projectsResult = await query(
      'SELECT COUNT(*) FROM projects WHERE user_id = $1',
      [userId]
    );
    const projectCount = parseInt(projectsResult.rows[0].count);

    // Подсчет ссылок за текущий месяц
    const linksResult = await query(
      `SELECT COUNT(*) FROM manual_links ml
       JOIN projects p ON ml.project_id = p.id
       WHERE p.user_id = $1 
       AND ml.created_at >= date_trunc('month', CURRENT_DATE)`,
      [userId]
    );
    const linksThisMonth = parseInt(linksResult.rows[0].count);

    // Подсчет активных Google Sheets
    const sheetsResult = await query(
      `SELECT COUNT(*) FROM google_sheets gs
       JOIN projects p ON gs.project_id = p.id
       WHERE p.user_id = $1 AND gs.status = 'active'`,
      [userId]
    );
    const activeSheets = parseInt(sheetsResult.rows[0].count);

    return {
      user,
      limits,
      stats: {
        projects: projectCount,
        linksThisMonth,
        activeSheets,
        canCreateProject: limits.projects === -1 || projectCount < limits.projects,
        canAddLinks: limits.linksPerMonth === -1 || linksThisMonth < limits.linksPerMonth
      }
    };
  }
}
