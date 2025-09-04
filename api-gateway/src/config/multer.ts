import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config({ path: '../../../.env' });

// Конфигурация multer для загрузки файлов
export const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: parseInt(process.env['MAX_FILE_SIZE'] || '10485760') // 10MB по умолчанию
  },
  fileFilter: (_req, file, cb) => {
    // Разрешаем только CSV и Excel файлы
    if (file.mimetype === 'text/csv' || 
        file.mimetype === 'application/vnd.ms-excel' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});
