/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    safelist: [
    'translate-x-0',
    '-translate-x-full',
  ],
  darkMode: 'class', // Required for toggling dark mode via class
  theme: {
    extend: {},
  },
  plugins: [],
};