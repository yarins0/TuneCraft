import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configures Vite for single page application routing with React.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Allow Vite's dev server to serve files outside client/ (e.g. shared/)
    fs: { allow: ['..'] },
  }
})