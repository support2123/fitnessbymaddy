// CORE 01 · "Two Kilograms" — 1080×1920 · 30fps · 3490f (116.33s)
// DECODE EP 03.
// Act 1 (0-33s): the bare 15-vertebra column alone on stage — it buckles under 2 kg,
//   gets sheathed in gold, then gets its pressure cylinder.
// Act 2 (33s-end): the camera pulls back, the column shrinks into anatomical place and
//   the HUMAN materialises around it — the same translucent écorché shell the BREATH and
//   STRENGTH films use, filling the frame, with the spine glowing inside it.
// Copy sits bottom-left (the approved STRENGTH position, clear of Instagram's username row).
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/SpaceMono";
import { loadFont as loadCorm } from "@remotion/google-fonts/CormorantGaramond";
import { useSpine, useBody, BodyShell, SpineColumn, PressureCanister, Multifidus } from "./CoreSpine";

const anton = loadAnton(), dm = loadDM(), mono = loadMono(), corm = loadCorm();
const F = { anton: anton.fontFamily, dm: dm.fontFamily, mono: mono.fontFamily, corm: corm.fontFamily };
const INK = "#EDE6D6", GOLD = "#E8BC6A", GOLD2 = "#D4A148", RED = "#FF3B30", TEAL = "#3FB5C4", CYAN = "#7FE3EC", DIM = "#6B6F73";
const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ip = (t: number, a: number[], b: number[]) => interpolate(t, a, b, cl);

const B = {
  cover: [0, 0.85], hook: [0.85, 13.45], cyl: [13.35, 32.95], crunch: [32.90, 44.95],
  situp: [44.90, 64.20], multi: [64.15, 83.35], comp: [83.30, 93.35], gen: [93.30, 104.75], cta: [104.70, 116.33],
};
const win = (t: number, w: number[], fade = 0.4) => ip(t, [w[0], w[0] + fade, w[1] - 0.35, w[1]], [0, 1, 1, 0]);

// ============================== 3D ==============================
const Rig: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const cam = useThree((s) => s.camera);
  const K = [0, 5, 9.6, 13.4, 20, 28, 32.9, 35.5, 45, 50, 54, 64, 70, 77, 83, 93, 100, 105, 116.4];
  const z = [6.5, 5.9, 5.6, 5.9, 6.7, 6.7, 7.0, 6.2, 6.0, 4.8, 4.4, 4.7, 3.4, 3.9, 5.6, 5.3, 5.1, 5.6, 5.4];
  const ly = [1.70, 1.62, 1.35, 1.50, 1.50, 1.58, 1.55, 0.35, 0.20, 0.42, 0.44, 0.46, 0.46, 0.44, 0.35, 0.18, 0.18, 0.20, 0.15];
  const yaw = [-0.14, -0.06, 0.06, 0.12, 0.50, 1.10, 1.15, 0.30, 0.16, -0.05, -0.12, -0.18, -0.30, -0.16, 0.22, 0.30, 0.30, 0.08, -0.08];
  const Z = ip(t, K, z), L = ip(t, K, ly), A = ip(t, K, yaw);
  const ang = A + 0.045 * Math.sin(t * 0.31);
  cam.position.set(Math.sin(ang) * Z, L + 0.20, Math.cos(ang) * Z);
  cam.lookAt(0, L, 0); (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
  return null;
};

const Lights: React.FC<{ gold: number; back: number; heat: number }> = ({ gold, back, heat }) => (
  <>
    <ambientLight intensity={0.32 + 0.10 * gold} />
    <directionalLight position={[4.5, 4.5, 3.2]} intensity={1.40 + 0.5 * gold} color={heat > 0.4 ? "#ffd9cc" : "#fff1dc"} />
    <directionalLight position={[-4.5, 2.5, -3]} intensity={0.95 + 1.3 * back} color={heat > 0.4 ? "#e8927f" : "#8fd8e6"} />
    <spotLight position={[-3.2, 4.5, 3]} angle={0.5} penumbra={1} intensity={0.62} color="#dff6ff" />
    <pointLight position={[0, 0.6, 3.4]} intensity={0.14 + 0.24 * gold} color="#aef0ff" />
  </>
);

const Stage: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const buckle = ip(t, [5.9, 9.2, 9.9, 11.2], [0, 1, 1, 0]);
  const gold = ip(t, [10.2, 12.8], [0, 1]);
  const p = ip(t, [14.3, 24.2, 31.4, 33.2], [0, 1, 1, 0]);
  const roof = ip(t, [20.4, 21.6], [0, 1]);
  const floor = ip(t, [22.0, 23.2], [0, 1]);
  const press = Math.max(ip(t, [26.4, 27.0, 27.9, 28.4], [0, 1, 1, 0]), ip(t, [29.6, 30.1, 31.0, 31.5], [0, 1, 1, 0]));
  const crush = ip(t, [47.8, 52.6, 53.6, 55.0], [0, 1, 1, 0]);
  const mShow = ip(t, [64.8, 66.2, 82.4, 83.2], [0, 1, 1, 0]);
  const mWaste = ip(t, [67.6, 70.4], [0, 1]);

  // ACT 1 → ACT 2: the column shrinks into anatomical place, the body arrives around it
  const fit = ip(t, [32.4, 34.5], [0, 1]);
  const fs = 1 - 0.717 * fit;                 // 3.0-unit hero column → 0.85-unit in-body column
  const shell = ip(t,
    [0, 33.2, 35.0, 44.6, 45.6, 55.4, 56.2, 63.8, 64.6, 83.0, 84.0, 93.0, 93.8, 104.2, 105.4, 116.4],
    [0, 0, 0.17, 0.17, 0.26, 0.26, 0.15, 0.15, 0.24, 0.24, 0.22, 0.22, 0.30, 0.30, 0.36, 0.36]);
  const op = ip(t,
    [0, 32.6, 34.0, 44.4, 45.4, 55.5, 56.2, 63.6, 64.4, 83.0, 84.0, 93.0, 93.8, 104.2, 105.2, 116.4],
    [1, 1, 0.30, 0.30, 0.95, 0.95, 0.34, 0.34, 0.95, 0.95, 0.55, 0.55, 0.22, 0.22, 0.85, 0.85]);
  const back = ip(t, [83.4, 85.0, 92.4, 93.2], [0, 1, 1, 0]);
  const heat = Math.max(crush * 0.8, ip(t, [66.8, 70.4, 82.0, 83.2], [0, 0.38, 0.38, 0]));
  const ctaGold = ip(t, [105.2, 108.2], [0, 1]);
  const goldNow = Math.max(gold * (1 - 0.5 * crush), 0.18 * back, 0.9 * ctaGold);

  return (
    <>
      <Lights gold={goldNow} back={back} heat={heat} />
      <BodyShell shell={shell} heat={heat} gold={ctaGold} />
      <group scale={fs} position={[0, 0.36 * fit, -0.06 * fit]}>
        <SpineColumn buckle={buckle} gold={goldNow} crush={crush} opacity={op} />
        {p > 0.01 && <PressureCanister p={p} press={press} showRoof={roof} showFloor={floor} />}
        {mShow > 0.01 && <Multifidus show={mShow} waste={mWaste} />}
      </group>
    </>
  );
};

// ============================== 2D KIT ==============================
const TypeOn: React.FC<{ t: number; from: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, from, dur = 0.85, children, style }) => {
  const p = ip(t, [from, from + dur], [0, 1]);
  return <div style={{ ...style, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, opacity: p > 0 ? 1 : 0 }}>{children}</div>;
};

// bottom-left editorial headline — the approved STRENGTH / BREATH position
const Head: React.FC<{ big: string; it?: string; itc?: string }> = ({ big, it, itc = GOLD }) => (
  <div style={{ position: "absolute", left: 56, right: 90, bottom: 400 }}>
    <div style={{ fontFamily: F.anton, color: INK, fontSize: 100, lineHeight: 0.95, textShadow: "0 3px 28px rgba(0,0,0,0.9)" }}>{big}</div>
    <div style={{ height: 4, width: 120, background: GOLD2, margin: "14px 0 10px", boxShadow: `0 0 12px ${GOLD2}` }} />
    {it && <div style={{ fontFamily: F.corm, fontStyle: "italic", color: itc, fontSize: 40, opacity: 0.95, textShadow: "0 2px 18px rgba(0,0,0,0.85)" }}>{it}</div>}
  </div>
);

const Cite: React.FC<{ txt: string }> = ({ txt }) => (
  <div style={{ position: "absolute", bottom: 330, left: 56, right: 120 }}>
    <div style={{ display: "inline-block", borderLeft: `3px solid ${GOLD2}`, background: "rgba(10,11,14,0.55)", padding: "8px 14px 8px 12px", borderRadius: "0 8px 8px 0" }}>
      <span style={{ fontFamily: F.mono, color: INK, fontSize: 17.5, opacity: 0.72, letterSpacing: "0.08em" }}>{txt}</span>
    </div>
  </div>
);

const Chapter: React.FC<{ t: number }> = ({ t }) => {
  const tags: Array<[number[], string]> = [
    [B.hook, "01 · THE COLLAPSE"], [B.cyl, "02 · THE CYLINDER"], [B.crunch, "03 · MISTAKE ONE"],
    [B.situp, "04 · MISTAKE TWO"], [B.multi, "05 · THE SHUTDOWN"], [B.comp, "06 · THE GAP"], [B.gen, "07 · THE ANATOMY"]];
  const cur = tags.find(([w]) => t >= w[0] && t < w[1]);
  if (!cur) return null;
  return (
    <div style={{ position: "absolute", top: 46, left: 56, opacity: win(t, cur[0], 0.3) * 0.95 }}>
      <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 22, letterSpacing: "0.3em" }}>{cur[1]}</div>
      <div style={{ height: 2, width: 54, background: GOLD2, marginTop: 8, opacity: 0.7 }} />
    </div>
  );
};

const AbBlocks: React.FC<{ n: number; label: string; pct: string; hero?: boolean }> = ({ n, label, pct, hero }) => (
  <div style={{ textAlign: "center", opacity: hero ? 1 : 0.8 }}>
    <svg viewBox="0 0 120 200" style={{ width: 164 }}>
      <rect x="18" y="14" width="84" height="174" rx="16" fill="rgba(10,11,14,0.55)" stroke={hero ? GOLD : "#7D8892"} strokeWidth={3} />
      {Array.from({ length: n }).map((_, i) => (
        <rect key={i} x={i % 2 ? 62 : 24} y={20 + Math.floor(i / 2) * (168 / Math.ceil(n / 2))}
          width="34" height={168 / Math.ceil(n / 2) - 9} rx="7" fill={hero ? GOLD2 : "#59636D"} opacity={hero ? 0.94 : 0.85} />
      ))}
    </svg>
    <div style={{ fontFamily: F.anton, color: hero ? GOLD : INK, fontSize: 50, marginTop: 8 }}>{label}</div>
    <div style={{ fontFamily: F.mono, color: hero ? GOLD : INK, fontSize: 20, opacity: hero ? 0.9 : 0.7, marginTop: 4 }}>{pct}</div>
  </div>
);

// ============================== OVERLAY ==============================
const Overlay: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Chapter t={t} />

      {/* COVER */}
      {t < B.cover[1] + 0.45 && (() => {
        const und = ip(t, [0.08, 0.6], [0, 1]); const o = ip(t, [B.cover[1], B.cover[1] + 0.4], [1, 0]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", top: 46, left: 56, fontFamily: F.mono, color: GOLD, fontSize: 25, letterSpacing: "0.3em" }}>DECODE · EP 03</div>
            <div style={{ position: "absolute", left: 0, right: 0, top: "46%", transform: "translateY(-50%)", textAlign: "center" }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 250, lineHeight: 0.9 }}>CORE</div>
              <div style={{ height: 5, background: GOLD2, width: `${und * 44}%`, margin: "22px auto 0", boxShadow: `0 0 16px ${GOLD2}` }} />
            </div>
          </div>
        );
      })()}

      {/* credential lower-third */}
      {t > 1.6 && t < 5.4 && (() => {
        const o = ip(t, [1.6, 2.1, 4.9, 5.4], [0, 1, 1, 0]);
        return (
          <div style={{ position: "absolute", left: 56, top: 250, opacity: o }}>
            <div style={{ borderLeft: `4px solid ${GOLD2}`, paddingLeft: 16 }}>
              <div style={{ fontFamily: F.anton, fontStyle: "italic", color: INK, fontSize: 52, lineHeight: 1 }}>MADDY</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 20, letterSpacing: "0.16em", marginTop: 7 }}>NASM-CPT · SPORTS NUTRITION</div>
            </div>
          </div>
        );
      })()}

      {/* ---------- HOOK ---------- */}
      {t >= B.hook[0] && t < B.hook[1] + 0.3 && (() => {
        const o = win(t, B.hook);
        const kg = ip(t, [1.0, 2.0], [0, 1]);
        const drop = ip(t, [5.7, 6.4], [0, 1]);
        const fail = ip(t, [6.5, 7.4], [0, 1]);
        const save = ip(t, [10.4, 11.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: "50%", top: 300 + 140 * drop, transform: "translateX(-50%)", opacity: kg * (1 - save) }}>
              <div style={{ width: 210, height: 96, borderRadius: 12, border: `4px solid ${drop > 0.5 ? RED : INK}`, background: "rgba(10,11,14,0.78)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontFamily: F.anton, color: drop > 0.5 ? RED : INK, fontSize: 60 }}>2 KG</span>
              </div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 19, opacity: 0.62, textAlign: "center", marginTop: 10, letterSpacing: "0.12em" }}>A TWO LITRE BOTTLE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: fail * (1 - save) }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 82, textShadow: "0 0 32px rgba(10,11,14,0.98)" }}>THE COLUMN FAILS</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, opacity: 0.72, marginTop: 12, letterSpacing: "0.14em" }}>LIGAMENTS ONLY · NO MUSCLE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: save }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 82, textShadow: "0 0 32px rgba(10,11,14,0.98)" }}>ONE SYSTEM HOLDS IT</div>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 22, opacity: 0.82, marginTop: 12, letterSpacing: "0.14em" }}>AND MOST TRAINING MISSES IT</div>
            </div>
            <Head big={"TWO\nKILOGRAMS."} it="that is the whole margin" />
            <Cite txt="LUCAS & BRESLER 1961 · UC BIOMECHANICS LAB · BARE LIGAMENTOUS SPINE BUCKLES ≈20 N" />
          </div>
        );
      })()}

      {/* ---------- CYLINDER ---------- */}
      {t >= B.cyl[0] && t < B.cyl[1] + 0.3 && (() => {
        const o = win(t, B.cyl);
        const n29 = Math.round(ip(t, [15.4, 18.6], [1, 29]));
        const roofL = ip(t, [20.6, 21.4], [0, 1]);
        const floorL = ip(t, [22.2, 23.0], [0, 1]);
        const fire = ip(t, [29.4, 30.0], [0, 1]);
        const ms = Math.round(ip(t, [29.7, 30.9], [0, 30]));
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", right: 62, top: 300, textAlign: "right" }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 132, lineHeight: 0.9, textShadow: `0 0 30px ${GOLD2}` }}>{n29}</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78 }}>PAIRS OF MUSCLES<br />NOT ONE SIX PACK</div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 470, opacity: roofL }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 25, letterSpacing: "0.16em" }}>◤ ROOF</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 46 }}>DIAPHRAGM</div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 1010, opacity: floorL }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 25, letterSpacing: "0.16em" }}>◣ BASE</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 46 }}>PELVIC FLOOR</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1160, textAlign: "center", opacity: fire }}>
              <div style={{ display: "inline-block", background: "rgba(10,11,14,0.88)", border: `2px solid ${GOLD2}`, borderRadius: 12, padding: "16px 30px" }}>
                <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 70, lineHeight: 1 }}>{ms} MILLISECONDS EARLY</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, opacity: 0.8, marginTop: 10, letterSpacing: "0.12em" }}>THE BRACE HAPPENS BEFORE THE MOVE</div>
              </div>
            </div>
            <Head big={"A PRESSURE\nCYLINDER."} it="pressure alone stiffens the spine 8 to 31 percent" itc={CYAN} />
            <Cite txt="AKUTHOTA & NADLER 2004 · HODGES 2005 J BIOMECH (IAP) · HODGES & RICHARDSON 1996 SPINE" />
          </div>
        );
      })()}

      {/* ---------- MISTAKE ONE ---------- */}
      {t >= B.crunch[0] && t < B.crunch[1] + 0.3 && (() => {
        const o = win(t, B.crunch);
        const reps = Math.round(ip(t, [34.5, 38.4], [0, 4200]) / 10) * 10;
        const zero = ip(t, [38.8, 39.6], [0, 1]);
        const split = ip(t, [40.8, 41.8], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center" }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 176, lineHeight: 0.9, textShadow: "0 0 30px rgba(10,11,14,0.95)" }}>{reps.toLocaleString()}</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 24, letterSpacing: "0.14em", marginTop: 8 }}>AB REPS · 6 WEEKS · 5 DAYS A WEEK</div>
            </div>
            <div style={{ position: "absolute", left: 120, right: 120, top: 640, opacity: zero }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.7 }}><span>BODY FAT %</span><span>WAIST</span><span>SKINFOLD</span></div>
              <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ flex: 1, height: 22, borderRadius: 11, background: "#232d34" }}>
                    <div style={{ height: "100%", width: "100%", background: DIM, borderRadius: 11 }} />
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 96, textAlign: "center", marginTop: 26, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>NO CHANGE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: split }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 54 }}>LOADING BUILDS IT.</div>
              <div style={{ fontFamily: F.anton, color: CYAN, fontSize: 54, marginTop: 6 }}>A DEFICIT UNCOVERS IT.</div>
            </div>
            <Head big={"MISTAKE\nONE."} it="the reps were never the problem" itc={RED} />
            <Cite txt="VISPUTE ET AL. 2011, J STRENGTH COND RES · n=24 · 7 EXERCISES · DIET HELD CONSTANT" />
          </div>
        );
      })()}

      {/* ---------- MISTAKE TWO ---------- */}
      {t >= B.situp[0] && t < B.situp[1] + 0.3 && (() => {
        const o = win(t, B.situp);
        const n = Math.round(ip(t, [48.0, 51.4], [0, 3400]) / 50) * 50;
        const limit = ip(t, [51.8, 52.8], [0, 1]);
        const army = ip(t, [55.6, 56.6], [0, 1]);
        const pct = Math.round(ip(t, [57.4, 60.0], [0, 56]));
        const stamp = ip(t, [61.6, 62.2], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300, opacity: 1 - army }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 120, lineHeight: 0.9, textShadow: `0 0 28px rgba(255,59,48,0.45)` }}>{n.toLocaleString()}</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78 }}>NEWTONS THROUGH YOUR<br />LOWER SPINE · ONE REP</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1030, opacity: limit * (1 - army) }}>
              <div style={{ height: 3, background: RED, boxShadow: `0 0 16px ${RED}` }} />
              <div style={{ display: "inline-block", background: "rgba(10,11,14,0.88)", padding: "12px 20px", borderRadius: 8, marginTop: 12 }}>
                <div style={{ fontFamily: F.anton, color: "#FF6A5C", fontSize: 42 }}>WORKPLACE SAFETY ACTION LIMIT</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.82, marginTop: 8, letterSpacing: "0.06em" }}>THE POINT WHERE EMPLOYERS MUST STEP IN</div>
              </div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center", opacity: army }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 24, letterSpacing: "0.2em" }}>1,500 SOLDIERS TRACKED</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 200, lineHeight: 0.92, marginTop: 14, textShadow: "0 0 32px rgba(10,11,14,0.95)" }}>{pct}%</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 24, letterSpacing: "0.12em", marginTop: 4 }}>OF FITNESS TEST INJURIES<br />TRACED TO THE SIT UP</div>
            </div>
            {stamp > 0 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 1090, textAlign: "center", transform: `scale(${2 - stamp})`, opacity: stamp }}>
                <span style={{ fontFamily: F.anton, color: RED, fontSize: 56, border: `6px solid ${RED}`, padding: "10px 26px", transform: "rotate(-5deg)", display: "inline-block", background: "rgba(10,11,14,0.7)" }}>NOT IN THE TEST ANY MORE</span>
              </div>
            )}
            <Head big={"MISTAKE\nTWO."} it="one rep, at the industrial limit" itc={RED} />
            <Cite txt="McGILL, CLIN BIOMECH (SIT-UP ≈3,300–3,500 N) · NIOSH ACTION LIMIT · EVANS ET AL. 2005, MILITARY MEDICINE" />
          </div>
        );
      })()}

      {/* ---------- THE SHUTDOWN ---------- */}
      {t >= B.multi[0] && t < B.multi[1] + 0.3 && (() => {
        const o = win(t, B.multi);
        const name = ip(t, [66.0, 67.0], [0, 1]);
        const gone = ip(t, [69.6, 70.6], [0, 1]);
        const bars = ip(t, [72.2, 75.4], [0, 1]);
        const honest = ip(t, [77.6, 78.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 290, opacity: name * (1 - bars) }}>
              <div style={{ fontFamily: F.mono, color: "#E8907F", fontSize: 22, letterSpacing: "0.18em" }}>DEEP STABILISER</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 72, lineHeight: 1, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>MULTIFIDUS</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.7, marginTop: 8 }}>SPANS 1 TO 3 VERTEBRAE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1060, opacity: gone * (1 - bars) }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 70, textShadow: "0 0 28px rgba(10,11,14,0.96)" }}>IT WASTES. AND STAYS OFF.</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, opacity: 0.74, marginTop: 10, letterSpacing: "0.1em" }}>EVEN AFTER THE PAIN IS GONE</div>
            </div>
            <div style={{ position: "absolute", left: 110, right: 110, top: 300, opacity: bars }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 430 }}>
                {[["NO TRAINING", 84, RED], ["TRAINED", 30, GOLD]].map(([lab, v, c], i) => (
                  <div key={i} style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: F.anton, color: c as string, fontSize: 68 }}>{Math.round((v as number) * bars)}%</div>
                    <div style={{ width: 132, height: (v as number) * 3.2 * bars, background: c as string, borderRadius: 10, marginTop: 10, boxShadow: `0 0 22px ${c}` }} />
                    <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, marginTop: 12, opacity: 0.8, letterSpacing: "0.08em" }}>{lab as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, textAlign: "center", opacity: 0.7, letterSpacing: "0.1em" }}>ONE YEAR RECURRENCE RATE</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1060, textAlign: "center", opacity: honest }}>
              <div style={{ display: "inline-block", border: `2px solid ${CYAN}`, borderRadius: 10, padding: "14px 26px", background: "rgba(10,11,14,0.72)" }}>
                <div style={{ fontFamily: F.anton, color: CYAN, fontSize: 48 }}>39 PEOPLE. ONE TRIAL.</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, opacity: 0.82, marginTop: 8, letterSpacing: "0.08em" }}>A SIGNAL, NOT A PROMISE</div>
              </div>
            </div>
            <Head big={"THE\nSHUTDOWN."} it="the muscle you never see is the one that quits" itc="#E8907F" />
            <Cite txt="HIDES, RICHARDSON & JULL, SPINE 1996 (ATROPHY) · HIDES, JULL & RICHARDSON, SPINE 2001 (RCT, n=39)" />
          </div>
        );
      })()}

      {/* ---------- THE GAP ---------- */}
      {t >= B.comp[0] && t < B.comp[1] + 0.3 && (() => {
        const o = win(t, B.comp);
        const bars = ip(t, [87.4, 90.0], [0, 1]);
        const flat = ip(t, [90.6, 91.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <svg viewBox="0 0 1080 620" style={{ position: "absolute", left: 0, top: 290, opacity: bars > 0 ? 1 : 0 }}>
              <line x1="120" y1="500" x2="960" y2="500" stroke="#3a3f45" strokeWidth={2} />
              <line x1="120" y1={500 - 350} x2="960" y2={500 - 350} stroke={DIM} strokeWidth={2} strokeDasharray="10 10" />
              <text x="960" y={500 - 362} textAnchor="end" fontFamily={F.mono} fontSize={24} fill={DIM}>100% OF MAXIMUM</text>
              <rect x="220" y={500 - 405 * bars} width="190" height={405 * bars} fill={CYAN} opacity={0.92} rx={9} />
              <text x="315" y="546" textAnchor="middle" fontFamily={F.mono} fontSize={26} fill={CYAN}>SPINAL ERECTORS</text>
              <rect x="672" y={500 - 78 * bars} width="190" height={78 * bars} fill={DIM} rx={9} />
              <text x="767" y="546" textAnchor="middle" fontFamily={F.mono} fontSize={26} fill={INK} opacity={0.75}>FRONT ABS</text>
            </svg>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1060, opacity: flat }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 56, lineHeight: 1.04, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>MORE WEIGHT DOES<br />NOT CHANGE THAT.</div>
            </div>
            <Head big={"THE GAP."} it="your compounds only cover the back half" itc={CYAN} />
            <Cite txt="HAMLYN, BEHM & YOUNG 2007 JSCR (SQUAT/DEADLIFT @80% 1RM) · NUZZO ET AL. 2008 JSCR" />
          </div>
        );
      })()}

      {/* ---------- THE ANATOMY ---------- */}
      {t >= B.gen[0] && t < B.gen[1] + 0.3 && (() => {
        const o = win(t, B.gen);
        const set = ip(t, [95.6, 96.6], [0, 1]);
        const rule = ip(t, [100.4, 101.4], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 60, right: 60, top: 560, display: "flex", justifyContent: "space-between", opacity: set }}>
              <AbBlocks n={4} label="FOUR" pct="THE REST" />
              <AbBlocks n={6} label="SIX" pct="6 IN 10 PEOPLE" hero />
              <AbBlocks n={8} label="EIGHT" pct="2 IN 10 PEOPLE" />
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1020, opacity: rule }}>
              <div style={{ borderTop: `1px solid ${DIM}`, borderBottom: `1px solid ${DIM}`, padding: "18px 0", background: "rgba(10,11,14,0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27 }}>
                  <span style={{ color: INK, opacity: 0.82 }}>HOW MANY</span><span style={{ color: DIM }}>BORN WITH IT</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27, marginTop: 14 }}>
                  <span style={{ color: GOLD }}>HOW THICK</span><span style={{ color: GOLD }}>TRAINING</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27, marginTop: 14 }}>
                  <span style={{ color: CYAN }}>WHETHER THEY SHOW</span><span style={{ color: CYAN }}>BODY FAT</span>
                </div>
              </div>
            </div>
            <Head big={"THE\nANATOMY."} it="count is inherited, thickness is earned" />
            <Cite txt="ANSON & McVAY CADAVER SERIES · TENDINOUS INTERSECTIONS: ~60% THREE · ~22% FOUR · ~15% TWO" />
          </div>
        );
      })()}

      {/* ---------- CTA ---------- */}
      {t >= B.cta[0] && (() => {
        const o = ip(t, [B.cta[0], B.cta[0] + 0.7], [0, 1]);
        const ask = ip(t, [110.8, 111.8], [0, 1]);
        const bio = ip(t, [112.4, 113.4], [0, 1]);
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,11,14,0.28) 0%, rgba(10,11,14,0.05) 24%, rgba(10,11,14,0.52) 58%, rgba(10,11,14,0.95) 84%)" }} />
            <div style={{ position: "absolute", left: 56, right: 80, bottom: 400 }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 86, lineHeight: 0.98 }}>TRAIN IT LIKE<br />A MUSCLE.</div>
              <div style={{ fontFamily: F.corm, fontStyle: "italic", color: GOLD, fontSize: 42, marginTop: 16 }}>load it. add weight. respect the only spine you get</div>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 66, marginTop: 30, textShadow: `0 0 26px ${GOLD2}`, opacity: ask }}>COMMENT 4, 6 OR 8 ⬇</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 26, opacity: bio }}>
                <div style={{ background: GOLD2, color: "#0A0B0E", fontFamily: F.anton, fontSize: 36, padding: "13px 28px", borderRadius: 12 }}>YOUR BODY SCAN — FREE</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, letterSpacing: "0.08em", opacity: 0.88 }}>LINK IN BIO ⬆</div>
              </div>
              <div style={{ marginTop: 22, fontFamily: F.mono, color: GOLD, fontSize: 20, letterSpacing: "0.12em", opacity: 0.9 * bio }}>MADDY · NASM-CPT · SPORTS NUTRITION</div>
            </div>
          </AbsoluteFill>
        );
      })()}
    </AbsoluteFill>
  );
};

// ============================== FILM ==============================
export const Core01: React.FC<{ mix?: string }> = ({ mix }) => {
  const spineReady = useSpine();
  const bodyReady = useBody();
  return (
    <AbsoluteFill style={{ background: "#0A0B0E" }}>
      {mix && <Audio src={staticFile(mix)} />}
      <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 1.9, 6.5], fov: 42 }}>
        <Rig />
        {spineReady && bodyReady && <Stage />}
        <EffectComposer disableNormalPass>
          <Bloom intensity={0.86} luminanceThreshold={0.40} luminanceSmoothing={0.3} mipmapBlur radius={0.72} />
          <Vignette darkness={0.64} offset={0.28} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 94% 84% at 50% 44%, transparent 50%, rgba(0,0,0,.70) 100%)", pointerEvents: "none" }} />
      <Overlay />
    </AbsoluteFill>
  );
};
export const calcCore01 = () => ({ durationInFrames: 3490, fps: 30, width: 1080, height: 1920 });

