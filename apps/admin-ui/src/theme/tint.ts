/**
 * S1 shared color math (plan rev.5 test (c)): ONE tint-composition +
 * WCAG-ratio implementation shared by the pack mapper (opaque `*-bg` tokens)
 * and the contrast lock (theme/__tests__/packs.test.ts). The prototype's
 * contrast harness computes the same composition inline (×3) — this is the
 * port; the packs.test asserts the contract's ≥4.5:1 pairs against it.
 */

/** '#RRGGBB' | 'rgba(r,g,b,a)' → [r,g,b,a?]. Throws on junk (contract-owned). */
export function parseColor(input: string): { r: number; g: number; b: number; a?: number } {
  const t = input.trim();
  const hex = /^#([0-9a-fA-F]{6})$/;
  if (hex.test(t)) {
    const n = parseInt(t.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/;
  const m = rgba.exec(t);
  if (!m) throw new Error(`unparseable color: ${input}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? undefined : Number(m[4]),
  };
}

/** Opaque composite of a (possibly translucent) tint OVER a base color. */
export function compositeTintOver(tint: string, base: string): string {
  const t = parseColor(tint);
  const b = parseColor(base);
  const a = t.a ?? 1;
  const mix = (tc: number, bc: number): number => Math.round(tc * a + bc * (1 - a));
  const to2 = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${to2(mix(t.r, b.r))}${to2(mix(t.g, b.g))}${to2(mix(t.b, b.b))}`;
}

/** WCAG 2.x contrast ratio (1..21). */
export function wcagRatio(fg: string, bg: string): number {
  const lum = (c: string): number => {
    const { r, g, b } = parseColor(c);
    const lin = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
