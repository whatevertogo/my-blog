/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./docs/**/*.md",
    "./docs/.vitepress/**/*.{js,ts,vue,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#f9f6f0', // Anthropic-like warm paper
          alt: '#f0ece1',     // Slightly darker paper for hover/active
          dark: '#e6dfcd',    // Borders or inactive elements
        },
        ink: {
          DEFAULT: '#222222', // Off-black for better readability
          light: '#55554f',   // Dark gray for secondary text
          faint: '#8f8a84',   // Light gray for tertiary text
        },
        brand: {
          DEFAULT: '#d4a373', // Claude-ish accent color
        }
      },
      fontFamily: {
        serif: ['ui-serif', 'Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
