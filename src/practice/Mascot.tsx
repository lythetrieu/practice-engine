// The mascot: the guide on the map (screens/Learn.tsx), the cheer in big moments (screens/Celebrate.tsx), the face on the
// lesson sheet (screens/Lesson.tsx) and the AI tutor's avatar (screens/TutorAsk.tsx). The engine's own drawing is a pigeon
// called Pip, in the pack's brand colors. A pack can replace it: pack.yaml `mascot.image` is an .svg file, which the pack
// loader checked (no scripts, no event handlers) and handed over as `pack.mascot`; it is drawn inline in the same box, so
// its size and look are the pack's. `mascot.name` is the name shown on every label ("Ask Pip", the tip, aria-labels).
import { pack, mascotName } from '../pack';
import './Mascot.css';

export { mascotName };

/** The pack's SVG, ready to sit inline: no XML header or comments, a viewBox (made from width and height when it has none),
    no fixed width or height (the box sets the size), and hidden from screen readers (the label is on the button). */
function inlineSvg(svg: string): string {
  const s = svg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const m = /<svg\b([^>]*)>/i.exec(s);
  if (!m) return '';
  let attrs = m[1].replace(/\/$/, '');
  const num = (n: string) => { const r = new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(attrs); return r ? parseFloat(r[1]) : 0; };
  const w = num('width'), h = num('height');
  if (!/\sviewBox\s*=/i.test(attrs) && w > 0 && h > 0) attrs += ` viewBox="0 0 ${w} ${h}"`;
  attrs = attrs.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  return s.replace(m[0], `<svg${attrs} aria-hidden="true" focusable="false">`);
}
const CUSTOM = pack.mascot ? inlineSvg(pack.mascot) : '';
/** True when the pack brings its own mascot drawing. */
export const customMascot = !!CUSTOM;

function Custom({ size }: { size: number }) {
  return <span className="mascot-img" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: CUSTOM }} />;
}

/** The mascot's head, for a small round avatar. */
export function MascotFace({ size = 36 }: { size?: number }) {
  if (CUSTOM) return <Custom size={size} />;
  return (
    <svg width={size} height={size} viewBox="32 6 42 42" aria-hidden="true">
      <ellipse cx="40" cy="52" rx="24" ry="20" fill="#9AA8A6" />
      <ellipse cx="46" cy="57" rx="13" ry="12" fill="#C9D2D0" />
      <path d="M22 48Q32 36 48 46Q40 60 22 48Z" fill="#7E8C8A" />
      <ellipse cx="49" cy="37" rx="12" ry="10" fill="var(--sage, #7FA38F)" />
      <circle cx="52" cy="26" r="12" fill="#8C9A98" />
      <circle cx="56" cy="24" r="3.4" fill="#FFFFFF" />
      <circle cx="57" cy="24" r="1.9" fill="#1D2320" />
      <path d="M63 26L72 29 63 32Z" fill="var(--accent, #E8704F)" />
      <path d="M40 15L52 9 64 15 52 21Z" fill="#1D2320" />
      <path d="M52 15L44 23" stroke="var(--accent, #E8704F)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The whole mascot, standing. `wings` lifts the wing (a cheer); `blink` makes the eyes blink now and then (the map's guide).
    Both are for the engine's bird; a pack's own drawing is shown as it is. */
export function MascotBody({ size = 80, wings = false, blink = false }: { size?: number; wings?: boolean; blink?: boolean }) {
  if (CUSTOM) return <Custom size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <ellipse cx="41" cy="77" rx="17" ry="3" fill="rgba(29,35,32,.12)" />
      <path d="M17 52L5 59 17 63Z" fill="#7E8C8A" />
      <ellipse cx="40" cy="52" rx="24" ry="20" fill="#9AA8A6" />
      <ellipse cx="46" cy="57" rx="13" ry="12" fill="#C9D2D0" />
      <path className={wings ? 'pip-wing up' : 'pip-wing'} d="M22 48Q32 36 48 46Q40 60 22 48Z" fill="#7E8C8A" />
      <ellipse cx="49" cy="37" rx="12" ry="10" fill="var(--sage, #7FA38F)" />
      <circle cx="52" cy="26" r="12" fill="#8C9A98" />
      <g className={blink ? 'ln-pip-eye' : undefined}>
        <circle cx="56" cy="24" r="3.4" fill="#FFFFFF" />
        <circle cx="57" cy="24" r="1.9" fill="#1D2320" />
      </g>
      <path d="M63 26L72 29 63 32Z" fill="var(--accent, #E8704F)" />
      <path d="M40 15L52 9 64 15 52 21Z" fill="#1D2320" />
      <path d="M52 15L44 23" stroke="var(--accent, #E8704F)" strokeWidth="2" strokeLinecap="round" />
      <path d="M34 71V77M46 71V77M31 77H37M43 77H49" stroke="var(--accent, #E8704F)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
