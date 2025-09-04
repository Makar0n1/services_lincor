import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../../../.env' });

const dbConfig: PoolConfig = {
  host: process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['DB_PORT'] || '5432'),
  database: process.env['DB_NAME'] || 'LinkChecker',
  user: process.env['DB_USER'] || 'postgres',
  password: process.env['DB_PASSWORD'] || 'Hdgzzptas2',
  max: 20, // максимальное количество клиентов в пуле
  idleTimeoutMillis: 30000, // время неактивности клиента
  connectionTimeoutMillis: 2000, // время ожидания подключения
  ssl: false
};

// Создаем пул подключений
const pool = new Pool(dbConfig);

// Обработка ошибок подключения
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Проверка подключения
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

export default pool;

// Утилиты для работы с БД
export const query = (text: string, params?: any[]) => pool.query(text, params);

// Инициализация таблиц
export const initDatabase = async () => {
  try {
    // Создание таблицы пользователей
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        subscription_plan VARCHAR(20) DEFAULT 'free',
        subscription_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы сессий
    await query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        refresh_token VARCHAR(255) UNIQUE NOT NULL,
        device_info JSONB,
        ip_address INET,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы проектов
    await query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы ручных ссылок
    await query(`
      CREATE TABLE IF NOT EXISTS manual_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        target_domain VARCHAR(255) NOT NULL,
        original_target_domain VARCHAR(255),
        type VARCHAR(20) DEFAULT 'manual',
        status VARCHAR(20) DEFAULT 'pending',
        response_code INTEGER,
        indexable BOOLEAN,
        link_type VARCHAR(20),
        canonical_url TEXT,
        load_time INTEGER,
        full_a_tag TEXT,
        non_indexable_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checked_at TIMESTAMP
      )
    `);

    // Создание таблицы Google Sheets интеграций
    await query(`
      CREATE TABLE IF NOT EXISTS google_sheets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        spreadsheet_url TEXT NOT NULL,
        target_domain VARCHAR(255) NOT NULL,
        url_column VARCHAR(10) NOT NULL,
        target_column VARCHAR(10) NOT NULL,
        result_range_start VARCHAR(10) NOT NULL,
        result_range_end VARCHAR(10) NOT NULL,
        schedule_interval VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'inactive',
        last_scan TIMESTAMP,
        next_scan TIMESTAMP,
        scan_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы платежных методов
    await query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        stripe_payment_method_id VARCHAR(255) UNIQUE NOT NULL,
        card_brand VARCHAR(20),
        card_last4 VARCHAR(4),
        card_exp_month INTEGER,
        card_exp_year INTEGER,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы счетов
    await query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255) UNIQUE NOT NULL,
        amount INTEGER NOT NULL,
        currency VARCHAR(3) DEFAULT 'usd',
        status VARCHAR(20) NOT NULL,
        subscription_plan VARCHAR(20),
        billing_period_start TIMESTAMP,
        billing_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание индексов для оптимизации
    await query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)');
    await query('CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_manual_links_project_id ON manual_links(project_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_manual_links_status ON manual_links(status)');
    await query('CREATE INDEX IF NOT EXISTS idx_manual_links_type ON manual_links(type)');
    await query('CREATE INDEX IF NOT EXISTS idx_google_sheets_project_id ON google_sheets(project_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_google_sheets_status ON google_sheets(status)');
    await query('CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id)');

    // Миграции для добавления новых полей
    try {
      await query('ALTER TABLE manual_links ADD COLUMN IF NOT EXISTS non_indexable_reason TEXT');
    } catch (error) {
      // Игнорируем ошибки, если колонка уже существует
      console.log('Column non_indexable_reason might already exist');
    }

    try {
      await query('ALTER TABLE google_sheets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE');
      
      // Обновляем существующие записи, заполняя user_id из projects
      await query(`
        UPDATE google_sheets 
        SET user_id = projects.user_id 
        FROM projects 
        WHERE google_sheets.project_id = projects.id 
        AND google_sheets.user_id IS NULL
      `);
      
      console.log('✅ Added user_id column to google_sheets and updated existing records');
      
      // Создаем индекс для новой колонки user_id
      await query('CREATE INDEX IF NOT EXISTS idx_google_sheets_user_id ON google_sheets(user_id)');
      console.log('✅ Created index for user_id column in google_sheets');
    } catch (error) {
      // Игнорируем ошибки, если колонка уже существует
      console.log('Column user_id might already exist in google_sheets');
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};
