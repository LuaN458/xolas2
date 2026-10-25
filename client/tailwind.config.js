/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#08090c',
          surface: '#0d0e13',
          card: '#12141a',
          hover: '#191b24',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-light': 'rgba(255, 255, 255, 0.15)',
          accent: {
            DEFAULT: '#6366f1',
            hover: '#4f46e5',
            glow: 'rgba(99, 102, 241, 0.25)',
          },
          emerald: {
            DEFAULT: '#10b981',
            glow: 'rgba(16, 185, 129, 0.25)',
          },
          rose: '#f43f5e',
          text: {
            primary: '#f9fafb',
            secondary: '#d1d5db',
            muted: '#6b7280',
          }
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
