/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/sidepanel.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Google Sans', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
