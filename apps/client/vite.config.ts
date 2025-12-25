import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    strictPort: false, // Allow fallback to next available port if occupied
    host: true, // Listen on all addresses
    allowedHosts: [
      'localhost',
      '.di4.dev',  // Allow all *.di4.dev subdomains
      '.di4.ru',   // Allow all *.di4.ru subdomains
    ],
  }
})
