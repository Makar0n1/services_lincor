import { query } from '../config/database';

async function addLinkTypeColumn() {
  try {
    console.log('Adding type column to manual_links table...');
    
    // Добавляем колонку type с дефолтным значением 'manual'
    await query(`
      ALTER TABLE manual_links 
      ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'manual'
    `);
    
    // Обновляем существующие записи, если они не имеют типа
    await query(`
      UPDATE manual_links 
      SET type = 'manual' 
      WHERE type IS NULL
    `);
    
    // Создаем индекс для оптимизации запросов по типу
    await query(`
      CREATE INDEX IF NOT EXISTS idx_manual_links_type 
      ON manual_links(type)
    `);
    
    console.log('✅ Successfully added type column to manual_links table');
    console.log('✅ All existing links marked as type="manual"');
    console.log('✅ Created index for type column');
    
  } catch (error) {
    console.error('❌ Error adding type column:', error);
  } finally {
    process.exit(0);
  }
}

// Запуск скрипта
addLinkTypeColumn();
