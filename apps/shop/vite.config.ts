import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One build serves every variant: the server injects SHOP_VERSION into index.html per request.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
