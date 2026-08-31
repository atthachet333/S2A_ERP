import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractionStatusLabel, matchLabel } from '@/lib/document-extraction';

describe('Phase 23 extraction review contract', () => {
  const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
  const review = read('../components/receiving/DocumentExtractionReview.tsx');
  const original = read('../components/receiving/OriginalDocument.tsx');
  const css = read('../styles/operations.css');

  it('communicates matched, ambiguous, and unresolved states with labels', () => {
    expect(matchLabel.MATCHED).toContain('ตรง');
    expect(matchLabel.AMBIGUOUS).toContain('เลือก');
    expect(matchLabel.UNMATCHED).toContain('ยังไม่พบ');
    expect(review).toContain('matchLabel[line.matchStatus]');
  });

  it('never presents extraction as automatic confirmation', () => {
    expect(review).toContain('จะไม่ยืนยันรับเข้าสินค้าอัตโนมัติ');
    expect(review).toContain('เอกสารจะยังคงเป็น <b>DRAFT</b>');
    expect(review).toContain('จะยังไม่เพิ่มสต็อก');
    expect(review).not.toContain('/confirm');
  });

  it('keeps the original document link and lets the user select one attachment per run', () => {
    expect(original).toContain('DocumentExtractionReview');
    expect(review).toContain('attachments.map');
    expect(review).toContain('ดูไฟล์ต้นฉบับ');
  });

  it('covers processing, ready, failure, review, and applied states', () => {
    expect(Object.keys(extractionStatusLabel).sort()).toEqual(['APPLIED', 'FAILED', 'PENDING', 'PROCESSING', 'READY', 'REVIEW_REQUIRED'].sort());
    expect(review).toContain('กำลังอ่าน…');
    expect(review).toContain("active?.status === 'FAILED'");
  });

  it('requires explicit replacement confirmation and preserves normal manual editing', () => {
    expect(review).toContain('รายการเดิมหรือการแก้ไขด้วยมือในร่างอาจถูกแทนที่');
    expect(review).toContain('replaceLinesConfirmed: true');
  });

  it('has responsive rules and non-color labels for 375/768/1440 layouts and themes', () => {
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('.match-label');
    expect(css).toContain('var(--surface');
    expect(css).not.toContain('#fff');
  });
});
