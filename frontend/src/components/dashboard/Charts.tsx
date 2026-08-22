import { barPercent, barsAreEmpty, donutArcs, hasDistribution, sliceTotal, type DocBar, type Slice } from '@/lib/dashboard-charts';

/**
 * PHASE 14 — กราฟเล็กบนแดชบอร์ด เขียนเป็น SVG ตรง ๆ
 * ไม่เพิ่ม dependency กราฟ และไม่ hardcode สี (ใช้ token ผ่าน CSS class)
 * ทุกชิ้นมีทั้งตัวเลขและป้ายข้อความกำกับ จึงอ่านได้โดยไม่ต้องพึ่งสี
 */

/** โดนัทแสดงองค์ประกอบ + legend ที่มีตัวเลขจริงกำกับทุกบรรทัด */
export function DonutChart({ slices, centerValue, centerLabel }: {
  slices: Slice[]; centerValue: string; centerLabel: string;
}) {
  const total = sliceTotal(slices);
  if (total <= 0) return null;

  /* ข้อมูลยังไม่มีการกระจายตัว (เหลือกลุ่มเดียว) → บอกเป็นข้อความพร้อมจำนวนจริง
     ดีกว่าวาดวงกลม 100% ที่ทำให้เข้าใจผิดว่ามีการเปรียบเทียบ */
  if (!hasDistribution(slices)) {
    const only = slices[0];
    return (
      <p className="dash-lowdata">
        <span className={`lg-dot tone-${only.tone}`} aria-hidden />
        ทั้งหมด <b className="num">{only.value}</b> {centerLabel} อยู่ในกลุ่ม “{only.label}”
        <small>ยังไม่มีข้อมูลเพียงพอสำหรับการเปรียบเทียบ</small>
      </p>
    );
  }

  const arcs = donutArcs(slices);

  return (
    <div className="dash-donut">
      <svg viewBox="0 0 108 108" role="img" aria-label={`${centerLabel} ${centerValue}`}>
        {arcs.map((a) => (
          <path key={a.key} d={a.path} className={`donut-slice tone-${a.tone}`}>
            <title>{`${a.label} ${a.value} (${a.percent}%)`}</title>
          </path>
        ))}
        <text x="54" y="50" className="donut-value" textAnchor="middle">{centerValue}</text>
        <text x="54" y="63" className="donut-label" textAnchor="middle">{centerLabel}</text>
      </svg>
      <ul className="dash-legend">
        {arcs.map((a) => (
          <li key={a.key}>
            <span className={`lg-dot tone-${a.tone}`} aria-hidden />
            <span className="lg-name">{a.label}</span>
            <b className="num">{a.value}</b>
            <small className="num">{a.percent}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** แท่งแนวนอนของเอกสารแต่ละชนิด แยกร่าง/ยืนยันแล้ว */
export function DocBarChart({ bars }: { bars: DocBar[] }) {
  /* ยังไม่มีเอกสารสักใบ → ไม่ต้องวาดแท่งเปล่าสามแท่ง */
  if (barsAreEmpty(bars)) {
    return <p className="dash-lowdata">ยังไม่มีเอกสารปฏิบัติการในระบบ<small>เมื่อเริ่มรับของหรือเบิกของ ตัวเลขจะขึ้นที่นี่</small></p>;
  }
  const max = Math.max(...bars.map((b) => b.total), 0);
  return (
    <ul className="dash-bars">
      {bars.map((b) => (
        <li key={b.key}>
          <span className="bar-name">{b.label}</span>
          <span className="bar-track" aria-hidden>
            <i className="bar-fill tone-ok" style={{ width: `${barPercent(b.confirmed, max)}%` }} />
            <i className="bar-fill tone-warn" style={{ width: `${barPercent(b.draft, max)}%` }} />
          </span>
          <span className="bar-figures">
            <b className="num">{b.total}</b>
            <small>{b.draft > 0 ? `ร่าง ${b.draft}` : 'ไม่มีร่าง'}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
