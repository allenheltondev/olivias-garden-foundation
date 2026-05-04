import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: Boolean(process.env.VITE_STORE_CLOUDWATCH_RUM_APP_MONITOR_ID),
  },
  server: {
    port: 5177,
    host: true,
  },
  preview: {
    port: 4177,
    host: true,
  },
});
