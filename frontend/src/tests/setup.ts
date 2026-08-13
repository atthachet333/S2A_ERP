import '@testing-library/jest-dom/vitest';

// jsdom ไม่มี matchMedia — ใส่ mock ให้ ThemeProvider ทำงานในเทสต์ (ค่าเริ่มต้น: ไม่ใช่ dark)
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true, configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}
