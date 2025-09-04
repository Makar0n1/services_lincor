import { initDatabase } from '../config/database';
import { UserModel } from '../models/User';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

async function testLogin() {
  try {
    // Инициализация базы данных
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully');

    // Тестовые данные
    const email = 'admin@linkchecker.com';
    const password = 'admin123';

    console.log('\n=== TESTING LOGIN ===');
    console.log('Email:', email);
    console.log('Password:', password);

    // Поиск пользователя
    console.log('\n1. Finding user by email...');
    const user = await UserModel.findByEmail(email);
    
    if (!user) {
      console.error('❌ User not found!');
      return;
    }

    console.log('✅ User found:');
    console.log('   ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Username:', user.username);
    console.log('   Plan:', user.subscription_plan);
    console.log('   Password hash:', user.password_hash);

    // Проверка пароля
    console.log('\n2. Verifying password...');
    const isPasswordValid = await UserModel.verifyPassword(user, password);
    
    if (isPasswordValid) {
      console.log('✅ Password is valid!');
    } else {
      console.log('❌ Password is invalid!');
      
      // Попробуем разные варианты пароля
      console.log('\n3. Testing alternative passwords...');
      const alternatives = ['admin123', 'Admin123', 'ADMIN123', 'admin', 'password'];
      
      for (const alt of alternatives) {
        const altValid = await UserModel.verifyPassword(user, alt);
        console.log(`   "${alt}": ${altValid ? '✅ Valid' : '❌ Invalid'}`);
      }
    }

  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    process.exit(0);
  }
}

// Запуск теста
testLogin();
