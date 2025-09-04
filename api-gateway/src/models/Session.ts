import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface Session {
  id: string;
  user_id: string;
  session_token: string;
  refresh_token: string;
  device_info: any;
  ip_address: string;
  is_active: boolean;
  expires_at: Date;
  created_at: Date;
  last_activity: Date;
}

export interface CreateSessionData {
  user_id: string;
  device_info?: any;
  ip_address: string;
  remember_me?: boolean;
}

export interface DeviceInfo {
  userAgent: string;
  browser: string;
  os: string;
  device: string;
  ip: string;
}

export class SessionModel {
  // Создание новой сессии
  static async create(sessionData: CreateSessionData): Promise<Session> {
    const { user_id, device_info, ip_address, remember_me = false } = sessionData;
    
    // Генерация токенов
    const session_token = uuidv4();
    const refresh_token = uuidv4();
    
    // Определение времени истечения
    const expires_at = new Date();
    if (remember_me) {
      expires_at.setDate(expires_at.getDate() + 90); // 90 дней для "запомнить меня"
    } else {
      expires_at.setDate(expires_at.getDate() + 7); // 7 дней по умолчанию
    }
    
    const result = await query(
      `INSERT INTO user_sessions 
       (user_id, session_token, refresh_token, device_info, ip_address, expires_at) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [user_id, session_token, refresh_token, JSON.stringify(device_info), ip_address, expires_at]
    );
    
    return result.rows[0];
  }

  // Поиск сессии по токену
  static async findBySessionToken(session_token: string): Promise<Session | null> {
    const result = await query(
      'SELECT * FROM user_sessions WHERE session_token = $1 AND is_active = true',
      [session_token]
    );
    
    return result.rows[0] || null;
  }

  // Поиск сессии по refresh токену
  static async findByRefreshToken(refresh_token: string): Promise<Session | null> {
    const result = await query(
      'SELECT * FROM user_sessions WHERE refresh_token = $1 AND is_active = true',
      [refresh_token]
    );
    
    return result.rows[0] || null;
  }

  // Поиск сессии по ID
  static async findById(id: string): Promise<Session | null> {
    const result = await query(
      'SELECT * FROM user_sessions WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  }

  // Получение всех активных сессий пользователя
  static async findByUserId(user_id: string): Promise<Session[]> {
    const result = await query(
      'SELECT * FROM user_sessions WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC',
      [user_id]
    );
    
    return result.rows;
  }

  // Обновление времени последней активности
  static async updateLastActivity(session_id: string): Promise<void> {
    await query(
      'UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = $1',
      [session_id]
    );
  }

  // Деактивация сессии
  static async deactivate(session_id: string): Promise<boolean> {
    const result = await query(
      'UPDATE user_sessions SET is_active = false WHERE id = $1 RETURNING id',
      [session_id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Деактивация всех сессий пользователя
  static async deactivateAllUserSessions(user_id: string): Promise<number> {
    const result = await query(
      'UPDATE user_sessions SET is_active = false WHERE user_id = $1',
      [user_id]
    );
    
    return result.rowCount || 0;
  }

  // Удаление сессии
  static async delete(session_id: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM user_sessions WHERE id = $1 RETURNING id',
      [session_id]
    );
    
    return (result.rowCount || 0) > 0;
  }

  // Проверка, истекла ли сессия
  static isExpired(session: Session): boolean {
    return new Date() > new Date(session.expires_at);
  }

  // Проверка, активна ли сессия
  static isActive(session: Session): boolean {
    return session.is_active && !this.isExpired(session);
  }

  // Получение количества активных сессий пользователя
  static async getActiveSessionCount(user_id: string): Promise<number> {
    const result = await query(
      'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND is_active = true',
      [user_id]
    );
    
    return parseInt(result.rows[0].count);
  }

  // Удаление старых сессий пользователя (оставляем только 5 самых новых)
  static async cleanupOldSessions(user_id: string, maxSessions: number = 5): Promise<number> {
    const result = await query(
      `DELETE FROM user_sessions 
       WHERE user_id = $1 
       AND id NOT IN (
         SELECT id FROM user_sessions 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2
       )`,
      [user_id, maxSessions]
    );
    
    return result.rowCount || 0;
  }

  // Удаление истекших сессий
  static async cleanupExpiredSessions(): Promise<number> {
    const result = await query(
      'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP',
      []
    );
    
    return result.rowCount || 0;
  }

  // Удаление неактивных сессий (старше 30 дней)
  static async cleanupInactiveSessions(): Promise<number> {
    const result = await query(
      'DELETE FROM user_sessions WHERE last_activity < CURRENT_TIMESTAMP - INTERVAL \'30 days\'',
      []
    );
    
    return result.rowCount || 0;
  }

  // Обновление refresh токена
  static async updateRefreshToken(session_id: string): Promise<string> {
    const new_refresh_token = uuidv4();
    
    await query(
      'UPDATE user_sessions SET refresh_token = $1 WHERE id = $2',
      [new_refresh_token, session_id]
    );
    
    return new_refresh_token;
  }

  // Парсинг информации об устройстве из User-Agent
  static parseDeviceInfo(userAgent: string, ip: string): DeviceInfo {
    // Простой парсинг User-Agent (можно использовать более продвинутые библиотеки)
    const browser = userAgent.includes('Chrome') ? 'Chrome' :
                   userAgent.includes('Firefox') ? 'Firefox' :
                   userAgent.includes('Safari') ? 'Safari' :
                   userAgent.includes('Edge') ? 'Edge' : 'Unknown';
    
    const os = userAgent.includes('Windows') ? 'Windows' :
              userAgent.includes('Mac') ? 'macOS' :
              userAgent.includes('Linux') ? 'Linux' :
              userAgent.includes('Android') ? 'Android' :
              userAgent.includes('iOS') ? 'iOS' : 'Unknown';
    
    const device = userAgent.includes('Mobile') ? 'Mobile' :
                  userAgent.includes('Tablet') ? 'Tablet' : 'Desktop';
    
    return {
      userAgent,
      browser,
      os,
      device,
      ip
    };
  }

  // Создание сессии с автоматической очисткой старых
  static async createWithCleanup(sessionData: CreateSessionData): Promise<Session> {
    const { user_id } = sessionData;
    
    // Проверяем количество активных сессий
    const activeCount = await this.getActiveSessionCount(user_id);
    const maxSessions = 5;
    
    // Если превышен лимит, удаляем старые сессии
    if (activeCount >= maxSessions) {
      await this.cleanupOldSessions(user_id, maxSessions - 1);
    }
    
    // Создаем новую сессию
    return this.create(sessionData);
  }

  // Получение статистики сессий
  static async getSessionStats(user_id: string) {
    const activeSessions = await this.findByUserId(user_id);
    const totalSessions = await query(
      'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1',
      [user_id]
    );
    
    const expiredSessions = activeSessions.filter(session => this.isExpired(session));
    const validSessions = activeSessions.filter(session => this.isActive(session));
    
    return {
      total: parseInt(totalSessions.rows[0].count),
      active: validSessions.length,
      expired: expiredSessions.length,
      sessions: validSessions
    };
  }
}
