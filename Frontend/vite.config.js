import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    cssMinify: "esbuild",
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        changeOrigin: true,
        target: "http://localhost:3000",
      },
    },
  },
})
