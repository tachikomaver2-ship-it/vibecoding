import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['openai', '@anthropic-ai/sdk']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['openai', '@anthropic-ai/sdk']
      }
    }
  },
  renderer: {}
})
