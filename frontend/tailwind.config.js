/** @type {import('tailwindcss').Config} */
// สี/รัศมีทั้งหมดอ้าง design token จาก src/styles/tokens.css (source เดียว)
// หมายเหตุ: เดิม map เป็น hsl(var(--x)) ซึ่งใช้ไม่ได้เพราะ token เก็บเป็น HEX
// ทำให้ utility อย่าง bg-primary / border-border ถูกทิ้งเงียบ ๆ
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input-border)',
        ring: 'var(--input-focus)',
        background: 'var(--bg)',
        foreground: 'var(--text)',
        primary: {
          DEFAULT: 'var(--blue)',
          foreground: 'var(--text-inverse)',
        },
        muted: {
          DEFAULT: 'var(--surface-2)',
          foreground: 'var(--text-muted)',
        },
        card: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--text)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-field)',
        lg: 'var(--radius-card)',
      },
      spacing: {
        'control': 'var(--control-h)',
      },
      fontFamily: {
        sans: ['Noto Sans Thai', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
