import { copyFile, constants } from 'node:fs/promises';
try {
  await copyFile(new URL('../apps/web-antd/.env.example', import.meta.url), new URL('../apps/web-antd/.env', import.meta.url), constants.COPYFILE_EXCL);
} catch (error) { if (error.code !== 'EEXIST') throw error; }
