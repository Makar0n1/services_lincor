import { query } from '../config/database';
import { LinkAnalyzer } from '../services/linkAnalyzer';

async function normalizeTargetDomains() {
  try {
    console.log('Starting target domain normalization...');
    
    // Получаем все записи с target_domain
    const result = await query('SELECT id, target_domain FROM manual_links');
    
    if (!result.rows || result.rows.length === 0) {
      console.log('No links found to normalize');
      return;
    }
    
    console.log(`Found ${result.rows.length} links to process`);
    
    let updated = 0;
    let unchanged = 0;
    
    for (const row of result.rows) {
      const { id, target_domain } = row;
      const normalizedDomain = LinkAnalyzer.normalizeTargetDomain(target_domain);
      
      if (normalizedDomain !== target_domain) {
        await query('UPDATE manual_links SET target_domain = $1 WHERE id = $2', [normalizedDomain, id]);
        console.log(`Updated link ${id}: "${target_domain}" -> "${normalizedDomain}"`);
        updated++;
      } else {
        console.log(`Link ${id} already normalized: "${target_domain}"`);
        unchanged++;
      }
    }
    
    console.log(`\nNormalization completed:`);
    console.log(`- Updated: ${updated} links`);
    console.log(`- Unchanged: ${unchanged} links`);
    console.log(`- Total processed: ${result.rows.length} links`);
    
  } catch (error) {
    console.error('Error normalizing target domains:', error);
  } finally {
    process.exit(0);
  }
}

// Запуск скрипта
normalizeTargetDomains();
