import zlib from 'node:zlib';

/**
 * PHASE 14B — ย่อรูป PNG ด้วย Node ล้วน (ใช้แค่ node:zlib ที่มีมากับ Node)
 *
 * เหตุผล: PDFKit ฝังไฟล์ภาพ "ทั้งไฟล์" ลงใน PDF ตามขนาดไบต์จริง
 * โลโก้ 1536×1024 (1.3 MB) จึงทำให้ใบสลิปครึ่ง A4 มีขนาดเกือบ 2 MB
 * ทั้งที่วาดจริงแค่ ~30pt สเปคห้ามเพิ่ม dependency ประมวลผลภาพหนัก ๆ
 * จึงเขียนตัวถอด/ย่อ/เข้ารหัส PNG เท่าที่จำเป็นเอง
 *
 * รองรับเฉพาะกรณีที่โลโก้ใช้จริง: bitDepth 8, non-interlaced, colorType 6 (RGBA) / 2 (RGB)
 * รูปแบบอื่น (16-bit, palette, interlaced) จะคืน null เพื่อให้ผู้เรียกใช้ไฟล์เดิมต่อ
 * ไม่ตัดสินใจแทนและไม่ทำให้เอกสารพัง
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------- CRC32 สำหรับเขียน chunk ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface RgbaImage { width: number; height: number; data: Buffer }

/** ถอด PNG เป็น RGBA ตรง ๆ — ไม่รองรับก็คืน null */
export function decodePng(file: Buffer): RgbaImage | null {
  if (file.length < 8 || !file.subarray(0, 8).equals(PNG_MAGIC)) return null;

  let offset = 8;
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; let interlace = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels || !idat.length) return null;

  let raw: Buffer;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  /* ถอด filter ของแต่ละ scanline ตามสเปค PNG */
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]; pos += 1;
    raw.copy(line, 0, pos, pos + stride); pos += stride;

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = value & 0xff;
    }
    line.copy(prev);

    for (let x = 0; x < width; x += 1) {
      const s = x * channels; const d = (y * width + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }
  return { width, height, data: out };
}

/** เข้ารหัส RGBA กลับเป็น PNG (filter 0 ทุกแถว — ง่ายและปลอดภัย) */
export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colorType RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * ย่อภาพแบบเฉลี่ยพื้นที่ (box filter)
 * คูณ alpha เข้าไปก่อนเฉลี่ยแล้วหารกลับ เพื่อไม่ให้ขอบโปร่งใสเกิดคราบขาว/ดำ
 */
export function resizeRgba(img: RgbaImage, targetW: number, targetH: number): RgbaImage {
  const out = Buffer.alloc(targetW * targetH * 4);
  const xRatio = img.width / targetW;
  const yRatio = img.height / targetH;

  for (let y = 0; y < targetH; y += 1) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < targetW; x += 1) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;

      for (let sy = sy0; sy < sy1 && sy < img.height; sy += 1) {
        for (let sx = sx0; sx < sx1 && sx < img.width; sx += 1) {
          const i = (sy * img.width + sx) * 4;
          const alpha = img.data[i + 3];
          r += img.data[i] * alpha; g += img.data[i + 1] * alpha; b += img.data[i + 2] * alpha;
          a += alpha; n += 1;
        }
      }
      const d = (y * targetW + x) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a); out[d + 1] = Math.round(g / a); out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(a / n);
      } else {
        out[d] = 0; out[d + 1] = 0; out[d + 2] = 0; out[d + 3] = 0;
      }
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/**
 * ย่อไฟล์ PNG ให้กว้างไม่เกิน maxWidth
 * คืน null ถ้าไฟล์ไม่รองรับ หรือเล็กอยู่แล้ว (ผู้เรียกจะได้ใช้ไฟล์เดิม)
 */
export function shrinkPng(file: Buffer, maxWidth: number): Buffer | null {
  const img = decodePng(file);
  if (!img) return null;
  if (img.width <= maxWidth) return null;
  const targetW = maxWidth;
  const targetH = Math.max(1, Math.round((img.height / img.width) * maxWidth));
  return encodePng(resizeRgba(img, targetW, targetH));
}
