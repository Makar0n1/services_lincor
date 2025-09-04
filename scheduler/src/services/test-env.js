require('dotenv').config({ path: '../../../.env' });

console.log('SCRAPE_DO_API_KEY:', process.env.SCRAPE_DO_API_KEY);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
