import { defineConfig } from 'vite';
// En producción Vercel atiende /api. API_PORT solo se usa para desarrollo local.
const apiPort = process.env.API_PORT || '8766';
export default defineConfig({server:{proxy:{'/api':`http://127.0.0.1:${apiPort}`}}});
