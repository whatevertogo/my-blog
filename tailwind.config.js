/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./docs/**/*.md",
    "./docs/.vitepress/**/*.{js,ts,vue,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // We will stick to standard Tailwind colors inside templates, 
        // e.g., bg-[#FDFBF7], text-stone-800.
      }
    },
  },
  plugins: [],
}
