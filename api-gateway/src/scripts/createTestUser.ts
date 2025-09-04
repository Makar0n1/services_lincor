import { initDatabase } from '../config/database';
import { UserModel } from '../models/User';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

async function createTestUser() {
  try {
    // Инициализация базы данных
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully');

    // Данные тестового пользователя
    const testUserData = {
      email: 'admin@linkchecker.com',
      username: 'admin',
      password: 'admin123',
      subscriptionPlan: 'enterprise' as const
    };

    // Проверка существования пользователя
    const existingUser = await UserModel.findByEmail(testUserData.email);
    if (existingUser) {
      console.log('Test user already exists');
      console.log('Email:', existingUser.email);
      console.log('Username:', existingUser.username);
      console.log('Plan:', existingUser.subscription_plan);
      return;
    }

    // Создание пользователя
    console.log('Creating test user...');
    const user = await UserModel.create({
      email: testUserData.email,
      username: testUserData.username,
      password: testUserData.password
    });

    // Обновление плана на Enterprise
    const updatedUser = await UserModel.updateSubscription(
      user.id,
      testUserData.subscriptionPlan,
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 год
    );

    if (updatedUser) {
      console.log('✅ Test user created successfully!');
      console.log('📧 Email:', updatedUser.email);
      console.log('👤 Username:', updatedUser.username);
      console.log('💳 Plan:', updatedUser.subscription_plan);
      console.log('📅 Expires:', updatedUser.subscription_expires);
      console.log('');
      console.log('🔑 Login credentials:');
      console.log('   Email: admin@linkchecker.com');
      console.log('   Password: admin123');
      console.log('');
      console.log('🚀 You can now test all features with unlimited access!');
    } else {
      console.error('❌ Failed to update user subscription');
    }

  } catch (error) {
    console.error('❌ Error creating test user:', error);
  } finally {
    process.exit(0);
  }
}

// Запуск скрипта
createTestUser();
