import { BadRequestException } from '@nestjs/common';
// Use the multer re-exported by @nestjs/platform-express to ensure
// version consistency with NestJS's built-in file interceptors.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
];

export const multerConfig = {
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        ),
        false,
      );
    }
  },
};
