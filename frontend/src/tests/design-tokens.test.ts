import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ยาม (guard) ของ Design System — PHASE 1
 * ล็อกไว้ว่า token ต้องมี "source เดียว" คือ styles/tokens.css
 * และห้ามมี var(--x) ที่ไม่เคยประกาศ (เคยพังเงียบ ๆ มาแล้ว)
 */

const SRC = path.resolve(__dirname, '..');
const TOKENS_FILE = 'styles/tokens.css';

function cssFiles(dir = SRC, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const files = cssFiles();
const read = (f: string) => fs.readFileSync(f, 'utf8');

/** token ที่ตั้งค่าแบบ runtime ผ่าน style={{...}} ใน JSX — ไม่ต้องประกาศใน CSS */
const RUNTIME_TOKENS = new Set(['--px', '--py', '--mx', '--sbw', '--deg', '--step', '--node-delay', '--rb2-card', '--layout-accent']);

/** ประกาศ token เฉพาะที่อยู่ใน :root / :root.dark (ไม่นับ scoped ในคลาส) */
function themeTokenDecls(src: string): string[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' '); // ตัด comment ก่อน ไม่งั้น selector เพี้ยน
  const found: string[] = [];
  for (const m of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    // นับเฉพาะบล็อกที่ทุก selector เป็น :root หรือ :root.dark ล้วน ๆ
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length || !parts.every((s) => /^:root(\.[\w-]+)?$/.test(s))) continue;
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:/gi)) found.push(d[1]);
  }
  return found;
}

describe('design tokens — single source', () => {
  it('1 มีไฟล์ tokens.css และประกาศ token จำนวนมากพอที่จะเป็น source จริง', () => {
    const tokens = themeTokenDecls(read(path.join(SRC, TOKENS_FILE)));
    expect(tokens.length).toBeGreaterThan(80);
  });

  it('2 ไม่มีไฟล์ CSS อื่นประกาศ theme token ใน :root อีก', () => {
    const offenders = files
      .filter((f) => rel(f) !== TOKENS_FILE)
      .map((f) => ({ file: rel(f), tokens: themeTokenDecls(read(f)) }))
      .filter((x) => x.tokens.length > 0);
    expect(offenders).toEqual([]);
  });

  it('3 ทุก var(--x) ที่ใช้ ต้องมีการประกาศจริง (กัน token ตายเงียบ)', () => {
    const declared = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const undeclared = new Set<string>();
    for (const f of files) {
      for (const m of read(f).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const t = m[1];
        if (!declared.has(t) && !RUNTIME_TOKENS.has(t)) undeclared.add(`${t} (${rel(f)})`);
      }
    }
    expect([...undeclared]).toEqual([]);
  });
});

describe('design tokens — scales ที่ spec กำหนด', () => {
  const tokensCss = read(path.join(SRC, TOKENS_FILE));
  const valueOf = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokensCss)?.[1].trim() ?? '';

  it('4 ความสูงตัวควบคุมฟอร์มอยู่ในช่วง 44–46px ตาม spec', () => {
    expect(valueOf('--control-h')).toBe('44px');
    expect(valueOf('--control-h-lg')).toBe('46px');
  });

  it('5 การ์ดมี radius 14–18px และ padding 20–24px', () => {
    expect(parseInt(valueOf('--radius-card'), 10)).toBeGreaterThanOrEqual(14);
    expect(parseInt(valueOf('--radius-card'), 10)).toBeLessThanOrEqual(18);
    expect(parseInt(valueOf('--card-pad'), 10)).toBeGreaterThanOrEqual(20);
    expect(parseInt(valueOf('--card-pad'), 10)).toBeLessThanOrEqual(24);
  });

  it('6 dark mode มีชั้นความลึกที่ "ต่างกันจริง" ไม่ใช่สีเดียวกันหมด', () => {
    const dark = /:root\.dark\s*\{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? '';
    const layer = (n: string) => new RegExp(`${n}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(dark)?.[1].toLowerCase();
    const layers = ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-elevated'].map(layer);
    expect(layers.every(Boolean)).toBe(true);
    expect(new Set(layers).size).toBe(layers.length); // ทุกชั้นต้องไม่ซ้ำสีกัน
  });

  it('7 ไม่มี hex ของสีเตือนแบบ hardcode หลงเหลือใน CSS หน้าเพจ', () => {
    const leaked = files.filter((f) => rel(f) !== TOKENS_FILE).filter((f) => /#8a5a00|#f0c46a|#c58a14/i.test(read(f))).map(rel);
    expect(leaked).toEqual([]);
  });
});

/* ============================================================
   PHASE 2+3 — App shell / page pattern invariants
   ============================================================ */
describe('app shell', () => {
  const all = files.map((f) => ({ file: rel(f), css: read(f) }));
  const findRules = (selector: string) =>
    all.flatMap(({ file, css }) =>
      [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
        .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
        .map((m) => ({ file, body: m[2] })));

  it('8 หัวเว็บถูกประกาศชุดเดียว ไม่ถูกสกินทับซ้ำหลายไฟล์', () => {
    // เดิมมี .app-header 7 จุด สลับ sticky/fixed และ z-index 30/40/80 ทับกันไปมา
    const withBackground = findRules('.app-header').filter((r) => /background\s*:/.test(r.body));
    expect(withBackground.length).toBeLessThanOrEqual(1);
  });

  it('9 z-index ของ shell ใช้ token ไม่ใช่ตัวเลขดิบ', () => {
    const raw: string[] = [];
    for (const sel of ['.app-header', '.app-sidebar', '.notification-drawer', '.dialog-backdrop', '.toast-stack']) {
      for (const r of findRules(sel)) {
        const m = /z-index\s*:\s*([^;]+)/.exec(r.body);
        if (m && !m[1].includes('var(--z-')) raw.push(`${sel} in ${r.file} -> ${m[1].trim()}`);
      }
    }
    expect(raw).toEqual([]);
  });

  it('10 ลำดับชั้นถูกต้อง: sticky < header < dropdown < drawer < modal < toast', () => {
    const tokensCss = read(files.find((f) => rel(f) === TOKENS_FILE)!);
    const v = (n: string) => Number(new RegExp(`${n}\\s*:\\s*(\\d+)`).exec(tokensCss)?.[1]);
    const order = ['--z-sticky', '--z-header', '--z-dropdown', '--z-drawer', '--z-modal', '--z-toast'].map(v);
    expect(order.every((n) => Number.isFinite(n))).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('11 ความกว้างหน้าใช้ token ไม่ให้แต่ละหน้าตั้ง max-width เอง', () => {
    const legacy = ['.rb2', '.recipe-list-v2', '.inventory-page', '.reconcile', '.units-page', '.doc-detail'];
    const offenders: string[] = [];
    for (const sel of legacy) {
      for (const r of findRules(sel)) {
        const m = /max-width\s*:\s*([^;]+)/.exec(r.body);
        // 'none' อนุญาต: เป็นการปลดความกว้างตอนสั่งพิมพ์
        if (m && !m[1].includes('var(--page-') && m[1].trim() !== 'none') offenders.push(`${sel} (${r.file}) -> ${m[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('12 หน้า public ต้องมี burger + panel จริงใน markup ไม่ใช่มีแต่ CSS', () => {
    const home = fs.readFileSync(path.join(SRC, 'pages/HomePage.tsx'), 'utf8');
    expect(home).toContain('hp-burger');
    expect(home).toContain('aria-controls="hp-mobile-nav"');
    expect(home).toContain('id="hp-mobile-nav"');
  });

  it('13 ลิ้นชักแจ้งเตือน portal ออกนอก <header> ไม่ให้ติด stacking context', () => {
    const header = fs.readFileSync(path.join(SRC, 'components/layout/Header.tsx'), 'utf8');
    expect(header).toContain('createPortal');
    expect(header).toMatch(/createPortal\([\s\S]*document\.body\)/);
  });

  it('14 breadcrumb ไม่ซ้ำกับชื่อหน้าในหัวเว็บ', () => {
    const header = fs.readFileSync(path.join(SRC, 'components/layout/Header.tsx'), 'utf8');
    const bc = /<nav className="breadcrumb"[\s\S]*?<\/nav>/.exec(header)?.[0] ?? '';
    expect(bc).toContain('{group}');
    expect(bc).not.toContain('{title}');
  });
});
