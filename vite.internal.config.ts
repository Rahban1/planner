import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '#/server/runtime': fileURLToPath(
        new URL('./src/server/runtime.internal.ts', import.meta.url),
      ),
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
