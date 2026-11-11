import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { include: ['@supabase/supabase-js', 'ag-grid-community', 'ag-grid-react', 'jspdf'] },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
});
