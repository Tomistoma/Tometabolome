import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Some libraries (like Plotly) might expect `global` to be defined
    global: 'window', 
  },
})
