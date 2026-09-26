// FBM FILM KIT — the permanent component library for DECODE-series films.
// Every hard-won lesson from EP-01..03 is baked INTO these components, so a new
// episode cannot repeat an old mistake:
//   · RollCounter is invisible until its count starts (no premature "0" on screen)
//   · StatStamp lands measured constants at full value (never tweens 20→30 under a spoken "30")
//   · ItalicClaim carries its own scrim (never illegible over bright 3D)
//   · Kicker/Head/Cite live at the approved bottom-left positions, clear of IG UI
//   · CTABlock puts the comment ask visually ABOVE the funnel pill, with a question line
// Layout law: headline bottom:400 · citation bottom:330 · chapter top:46 · nothing
// critical below y≈1590. A translucent human body (CoreSpine → BodyShell) is
// MANDATORY in every film — an isolated organ/bone alone gets rejected.
import React from "react";
import { interpolate } from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/SpaceMono";
import { loadFont as loadCorm } from "@remotion/google-fonts/CormorantGaramond";

const anton = loadAnton(), dm = loadDM(), mono = loadMono(), corm = loadCorm();
export const F = { anton: anton.fontFamily, dm: dm.fontFamily, mono: mono.fontFamily, corm: corm.fontFamily };
export const C = {
  INK: "#EDE6D6", GOLD: "#E8BC6A", GOLD2: "#D4A148", RED: "#FF3B30",
  TEAL: "#3FB5C4", CYAN: "#7FE3EC", DIM: "#6B6F73", BG: "#0A0B0E",
};
export const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ip = (t: number, a: number[], b: number[]) => interpolate(t, a, b, cl);
export const win = (t: number, w: number[], fade = 0.4) =>
  ip(t, [w[0], w[0] + fade, w[1] - 0.35, w[1]], [0, 1, 1, 0]);

// Cold-open: play a flash of the film's best moment at t=0, then run normally.
// Usage in the film's Stage/Rig: const st = coldOpenT(t, 7.6, 0.8) — the first
// 0.8 s shows the moment at 7.6 s (e.g. the buckle), everything after runs as-is.
export const coldOpenT = (t: number, srcT: number, dur = 0.8) => (t < dur ? srcT + t : t);

const SHADOW = "0 0 30px rgba(10,11,14,0.96), 0 3px 18px rgba(10,11,14,0.92)";

// ---- layout-law components ------------------------------------------------
export const Head: React.FC<{ big: string; it?: string; itc?: string }> = ({ big, it, itc = C.GOLD }) => (
  <div style={{ position: "absolute", left: 56, right: 90, bottom: 400 }}>
    <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 100, lineHeight: 0.95, whiteSpace: "pre-line", textShadow: SHADOW }}>{big}</div>
    <div style={{ height: 4, width: 120, background: C.GOLD2, margin: "14px 0 10px", boxShadow: `0 0 12px ${C.GOLD2}` }} />
    {it && <div style={{ fontFamily: F.corm, fontStyle: "italic", color: itc, fontSize: 40, opacity: 0.95, textShadow: SHADOW }}>{it}</div>}
  </div>
);

export const Cite: React.FC<{ txt: string }> = ({ txt }) => (
  <div style={{ position: "absolute", bottom: 330, left: 56, right: 120 }}>
    <div style={{ display: "inline-block", borderLeft: `3px solid ${C.GOLD2}`, background: "rgba(10,11,14,0.62)", padding: "8px 14px 8px 12px", borderRadius: "0 8px 8px 0" }}>
      <span style={{ fontFamily: F.mono, color: C.INK, fontSize: 17.5, opacity: 0.74, letterSpacing: "0.08em" }}>{txt}</span>
    </div>
  </div>
);

export const Chapter: React.FC<{ t: number; tags: Array<[number[], string]> }> = ({ t, tags }) => {
  const cur = tags.find(([w]) => t >= w[0] && t < w[1]);
  if (!cur) return null;
  return (
    <div style={{ position: "absolute", top: 46, left: 56, opacity: win(t, cur[0], 0.3) * 0.95 }}>
      <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 22, letterSpacing: "0.3em" }}>{cur[1]}</div>
      <div style={{ height: 2, width: 54, background: C.GOLD2, marginTop: 8, opacity: 0.7 }} />
    </div>
  );
};

// Section kicker for mid-frame labels — ALWAYS gold-treated (the grey MULTIFIDUS
// kicker was flagged as the emptiest frame of EP-03; this component is the fix).
export const Kicker: React.FC<{ small: string; big: string; sub?: string; o?: number; right?: boolean }> = ({ small, big, sub, o = 1, right }) => (
  <div style={{ opacity: o, textAlign: right ? "right" : "left" }}>
    <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 22, letterSpacing: "0.18em" }}>{small}</div>
    <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 72, lineHeight: 1, textShadow: SHADOW }}>{big}</div>
    {sub && <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 20, opacity: 0.72, marginTop: 8 }}>{sub}</div>}
    <div style={{ height: 3, width: 92, background: C.GOLD2, marginTop: 10, boxShadow: `0 0 10px ${C.GOLD2}`, marginLeft: right ? "auto" : 0 }} />
  </div>
);

export const TypeOn: React.FC<{ t: number; from: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, from, dur = 0.85, children, style }) => {
  const p = ip(t, [from, from + dur], [0, 1]);
  return <div style={{ ...style, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, opacity: p > 0 ? 1 : 0 }}>{children}</div>;
};

// A key claim in italic — carries its own chip so it can NEVER sit illegible on
// bright 3D (the "8 to 31 percent over gold rings" failure).
export const ItalicClaim: React.FC<{ txt: string; col?: string }> = ({ txt, col = C.CYAN }) => (
  <div style={{ display: "inline-block", background: "rgba(10,11,14,0.72)", borderRadius: 8, padding: "6px 16px" }}>
    <span style={{ fontFamily: F.corm, fontStyle: "italic", color: col, fontSize: 40 }}>{txt}</span>
  </div>
);

// ---- numbers --------------------------------------------------------------
// RollCounter: for totals that ACCUMULATE (4,200 reps). Invisible before t0.
export const RollCounter: React.FC<{
  t: number; t0: number; t1: number; to: number; step?: number;
  label?: string; col?: string; size?: number; fmt?: (n: number) => string;
}> = ({ t, t0, t1, to, step = 10, label, col = C.INK, size = 170, fmt }) => {
  if (t < t0) return null;
  const v = Math.round(ip(t, [t0, t1], [0, to]) / step) * step;
  return (
    <div>
      <div style={{ fontFamily: F.anton, color: col, fontSize: size, lineHeight: 0.9, textShadow: SHADOW }}>{fmt ? fmt(v) : v.toLocaleString()}</div>
      {label && <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 23, letterSpacing: "0.12em", marginTop: 8 }}>{label}</div>}
    </div>
  );
};

// StatStamp: for MEASURED CONSTANTS (30 ms, 56%, 2 kg). Never counts up —
// lands at full value with a scale pop, timed to the spoken word.
export const StatStamp: React.FC<{ t: number; at: number; txt: string; label?: string; col?: string; size?: number }> = ({ t, at, txt, label, col = C.GOLD, size = 132 }) => {
  if (t < at) return null;
  const k = ip(t, [at, at + 0.28], [1.35, 1]);
  return (
    <div style={{ transform: `scale(${k})`, transformOrigin: "left bottom" }}>
      <div style={{ fontFamily: F.anton, color: col, fontSize: size, lineHeight: 0.9, textShadow: `0 0 30px ${col}55, ${SHADOW}` }}>{txt}</div>
      {label && <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78, marginTop: 6 }}>{label}</div>}
    </div>
  );
};

// ---- editorial devices ----------------------------------------------------
export const MythStrike: React.FC<{ t: number; at: number; txt: string; after?: string; size?: number }> = ({ t, at, txt, after, size = 84 }) => {
  const s = ip(t, [at, at + 0.6], [0, 1]);
  const a = ip(t, [at + 0.8, at + 1.5], [0, 1]);
  return (
    <div>
      <div style={{ display: "inline-block", position: "relative" }}>
        <div style={{ fontFamily: F.anton, color: s > 0.5 ? C.DIM : C.INK, fontSize: size, textShadow: SHADOW }}>{txt}</div>
        <div style={{ position: "absolute", top: "50%", left: 0, height: 8, width: `${s * 100}%`, background: C.RED, boxShadow: `0 0 18px ${C.RED}` }} />
      </div>
      {after && <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: size, opacity: a, textShadow: SHADOW }}>{after}</div>}
    </div>
  );
};

export const RubberStamp: React.FC<{ t: number; at: number; txt: string }> = ({ t, at, txt }) => {
  const s = ip(t, [at, at + 0.55], [0, 1]);
  if (s <= 0) return null;
  return (
    <div style={{ textAlign: "center", transform: `scale(${2 - s})`, opacity: s }}>
      <span style={{ fontFamily: F.anton, color: C.RED, fontSize: 56, border: `6px solid ${C.RED}`, padding: "10px 26px", transform: "rotate(-5deg)", display: "inline-block", background: "rgba(10,11,14,0.7)" }}>{txt}</span>
    </div>
  );
};

export const BarPair: React.FC<{ t: number; t0: number; a: [string, number, string]; b: [string, number, string]; unit: string }> = ({ t, t0, a, b, unit }) => {
  const p = ip(t, [t0, t0 + 3.2], [0, 1]);
  if (p <= 0) return null;
  return (
    <div style={{ opacity: Math.min(1, p * 3) }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 430 }}>
        {[a, b].map(([lab, v, c], i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.anton, color: c, fontSize: 68 }}>{Math.round(v * p)}%</div>
            <div style={{ width: 132, height: v * 3.2 * p, background: c, borderRadius: 10, marginTop: 10, boxShadow: `0 0 22px ${c}` }} />
            <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 20, marginTop: 12, opacity: 0.8, letterSpacing: "0.08em" }}>{lab}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, textAlign: "center", opacity: 0.7, letterSpacing: "0.1em" }}>{unit}</div>
    </div>
  );
};

// The honesty chip — "39 PEOPLE. ONE TRIAL. A SIGNAL, NOT A PROMISE."
// Flagged best-in-class by the EP-03 audit. Use one whenever the evidence is thin.
export const HonestyChip: React.FC<{ big: string; sub: string; o?: number }> = ({ big, sub, o = 1 }) => (
  <div style={{ textAlign: "center", opacity: o }}>
    <div style={{ display: "inline-block", border: `2px solid ${C.CYAN}`, borderRadius: 10, padding: "14px 26px", background: "rgba(10,11,14,0.72)" }}>
      <div style={{ fontFamily: F.anton, color: C.CYAN, fontSize: 48 }}>{big}</div>
      <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 22, opacity: 0.82, marginTop: 8, letterSpacing: "0.08em" }}>{sub}</div>
    </div>
  </div>
);

// ---- CTA ------------------------------------------------------------------
// Comment ask is the HERO (feeds the algorithm); the funnel pill is quiet
// secondary. The question line converts an instruction into identity bait.
export const CTABlock: React.FC<{ t: number; at: number; headline: string; italic: string; question: string; ask: string; pill: string }> = ({ t, at, headline, italic, question, ask, pill }) => {
  const o = ip(t, [at, at + 0.7], [0, 1]);
  const q = ip(t, [at + 4.6, at + 5.4], [0, 1]);
  const bio = ip(t, [at + 6.6, at + 7.4], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 56, right: 80, bottom: 400, opacity: o }}>
      <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 86, lineHeight: 0.98, whiteSpace: "pre-line" }}>{headline}</div>
      <div style={{ fontFamily: F.corm, fontStyle: "italic", color: C.GOLD, fontSize: 42, marginTop: 16 }}>{italic}</div>
      <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 27, letterSpacing: "0.12em", marginTop: 30, opacity: q }}>{question}</div>
      <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: 74, marginTop: 10, textShadow: `0 0 28px ${C.GOLD2}`, opacity: q }}>{ask}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 26, opacity: bio * 0.92 }}>
        <div style={{ background: "rgba(212,161,72,0.16)", border: `2px solid ${C.GOLD2}`, color: C.GOLD, fontFamily: F.anton, fontSize: 30, padding: "10px 24px", borderRadius: 12 }}>{pill}</div>
        <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.08em", opacity: 0.85 }}>LINK IN BIO ⬆</div>
      </div>
      <div style={{ marginTop: 22, fontFamily: F.mono, color: C.GOLD, fontSize: 20, letterSpacing: "0.12em", opacity: 0.9 * bio }}>MADDY · NASM-CPT · SPORTS NUTRITION</div>
    </div>
  );
};

// Credential lower-third. Reserve zone: x<650, y 230-360 — nothing else may
// enter it during the hold (the EP-03 "2 KG over NASM" collision rule).
export const CredThird: React.FC<{ t: number; from?: number; hold?: number }> = ({ t, from = 1.6, hold = 3.3 }) => {
  const o = ip(t, [from, from + 0.5, from + hold + 0.5, from + hold + 1.0], [0, 1, 1, 0]);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 56, top: 250, opacity: o }}>
      <div style={{ borderLeft: `4px solid ${C.GOLD2}`, paddingLeft: 16 }}>
        <div style={{ fontFamily: F.anton, fontStyle: "italic", color: C.INK, fontSize: 52, lineHeight: 1 }}>MADDY</div>
        <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 20, letterSpacing: "0.16em", marginTop: 7 }}>NASM-CPT · SPORTS NUTRITION</div>
      </div>
    </div>
  );
};

// Opening contents card — "WHAT WE COVER" value-menu (Maddy format, 2026-09-21).
// Sits over the cold-open backdrop for ~4s while the VO hook plays underneath,
// then dissolves into the first stat slam. Items cascade fast so it reads as
// momentum, not a static index.
export const ContentsCard: React.FC<{ t: number; until: number; ep: string; title: string; items: string[]; itemAts?: number[] }> = ({ t, until, ep, title, items, itemAts }) => {
  if (t > until + 0.1) return null;
  const o = ip(t, [until - 0.45, until], [1, 0]);
  return (
    <AbsoluteFillDiv style={{ opacity: o }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 120% 90% at 50% 40%, rgba(10,11,14,0.84) 0%, rgba(10,11,14,0.92) 100%)" }} />
      <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 24, letterSpacing: "0.32em", paddingLeft: "0.32em" }}>{ep}</div>
        <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 150, lineHeight: 0.92, marginTop: 18 }}>{title}</div>
        <div style={{ height: 4, width: 120, background: C.GOLD2, margin: "22px auto 0", boxShadow: `0 0 14px ${C.GOLD2}` }} />
      </div>
      <div style={{ position: "absolute", top: 560, left: 110, right: 90 }}>
        <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: 58, letterSpacing: "0.06em", marginBottom: 8, opacity: ip(t, [0.30, 0.55], [0, 1]), textShadow: "0 0 22px rgba(212,161,72,0.35)" }}>WHAT WE COVER</div>
        <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 21, letterSpacing: "0.26em", marginBottom: 26, opacity: ip(t, [0.40, 0.65], [0, 1]) }}>IN THIS VIDEO</div>
        {items.map((it, i) => {
          const a = itemAts ? itemAts[i] : 0.55 + i * 0.11;
          const p = ip(t, [a, a + 0.30], [0, 1]);
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 22, marginBottom: 26, opacity: p, transform: `translateX(${(1 - p) * -46}px)` }}>
              <span style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 26, width: 46 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontFamily: F.anton, color: C.INK, fontSize: 52, letterSpacing: "0.01em" }}>{it}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", bottom: 340, left: 0, right: 0, textAlign: "center", opacity: ip(t, [1.6, 2.1], [0, 1]) }}>
        <span style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.14em", opacity: 0.7 }}>MADDY · NASM-CPT · SPORTS NUTRITION</span>
      </div>
    </AbsoluteFillDiv>
  );
};
const AbsoluteFillDiv: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ position: "absolute", inset: 0, ...style }}>{children}</div>
);

