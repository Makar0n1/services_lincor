import { initDatabase, query } from '../config/database';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

async function fixPassword() {
  try {
    // Инициализация базы данных
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully');

    const email = 'admin@linkchecker.com';
    const newPassword = 'admin123';

    console.log('\n=== FIXING PASSWORD ===');
    console.log('Email:', email);
    console.log('New Password:', newPassword);

    // Создание нового хеша пароля
    console.log('\n1. Generating new password hash...');
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    console.log('New hash:', newPasswordHash);

    // Обновление пароля в базе данных
    console.log('\n2. Updating password in database...');
    const result = await query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email, username',
      [newPasswordHash, email]
    );

    if (result.rows.length > 0) {
      console.log('✅ Password updated successfully!');
      console.log('Updated user:', result.rows[0]);
    } else {
      console.log('❌ User not found!');
      return;
    }

    // Проверка нового пароля
    console.log('\n3. Verifying new password...');
    const userResult = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];
    
    if (user) {
      const isValid = await bcrypt.compare(newPassword, user.password_hash);
      if (isValid) {
        console.log('✅ New password verification successful!');
        console.log('\n🎉 Login should work now with:');
        console.log('   Email: admin@linkchecker.com');
        console.log('   Password: admin123');
      } else {
        console.log('❌ New password verification failed!');
      }
    }

  } catch (error) {
    console.error('❌ Error fixing password:', error);
  } finally {
    process.exit(0);
  }
}

// Запуск исправления
fixPassword();
