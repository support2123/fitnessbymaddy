// ENDURANCE 01 · "Ten and a Half Million" — 1080×1920 · 30fps · 3886f (129.54s)
// DECODE EP 04 — first full film BUILT BY THE ENGINE (kit components, VO toolchain,
// heartbeat bed all phase-locked to ONE clock: the heart rate, 70 → 50 bpm).
// Hero: translucent body + real BodyParts3D lungs + luminous heart-core.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { C, F, ip, win, coldOpenT, Head, Cite, Chapter, Kicker, StatStamp, RollCounter, MythStrike, HonestyChip, ItalicClaim, CTABlock, CredThird } from "../../kit/FbmFilmKit";
import { ContentsCard } from "../../kit/FbmFilmKit";
import { useBody, BodyShell } from "./CoreSpine";
import { useLungs, Lungs, HeartCore, beatPhaseVar, spike, ecgPath } from "./EnduranceHeart";

// ---- ONE clock: the heart rate across the film (bed uses the same keys) ----
const KT = [0, 8, 30, 55, 85, 108, 122.3, 129.54];
const KV = [70, 70, 64, 58, 54, 52, 50, 50];
const bpmAt = (t: number) => ip(t, KT, KV);

// ---- VO-led beat windows (timeline.json) ----
const B = {
  cover: [0, 0.0], hook: [0.0, 12.0], engine: [11.9, 28.5], study: [28.4, 43.1],
  grey: [43.0, 76.7], myth: [76.6, 99.1], lift: [99.0, 111.5], proto: [111.4, 118.0], cta: [117.9, 129.54],
};
const FLASH = 118.9;
const PRE = 8.401;                        // m00 "what we cover" + gap — sab purane times shifted-t me same rehte hain                       // cold-open source: the gold resolve

// ============================== 3D ==============================
const Rig: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t0 = f / fps;
  const t = coldOpenT(t0 - PRE, FLASH + PRE, 0.70);
  const cam = useThree((s) => s.camera);
  const K = [0.85, 6, 12, 16, 26, 28.5, 43, 47, 62, 76.7, 85, 99, 105, 111.5, 118, 129.6];
  const z = [4.9, 4.1, 3.4, 3.35, 3.4, 4.6, 4.8, 4.4, 4.6, 4.3, 4.6, 3.8, 4.1, 4.4, 4.4, 4.6];
  const ly = [0.80, 0.78, 0.76, 0.78, 0.76, 0.66, 0.62, 0.64, 0.62, 0.64, 0.62, 0.72, 0.72, 0.68, 0.70, 0.72];
  const yaw = [-0.12, -0.04, 0.10, 0.26, -0.14, -0.20, 0.14, 0.20, -0.10, 0.22, 0.30, -0.16, -0.24, 0.10, 0.02, -0.10];
  const Z = ip(t, K, z), L = ip(t, K, ly), A = ip(t, K, yaw) + 0.04 * Math.sin(t * 0.29);
  cam.position.set(Math.sin(A) * Z, L + 0.32, Math.cos(A) * Z);
  cam.lookAt(0, L, 0); (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
  return null;
};

const Stage: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t0 = f / fps;
  const t = coldOpenT(t0 - PRE, FLASH + PRE, 0.70);
  const s = spike(beatPhaseVar(t, KT, KV));
  const grow = ip(t, [15.6, 22.7], [0, 1]);                       // chambers stretch on m05
  const heat = ip(t, [46.6, 48.5, 59.0, 61.5], [0, 0.55, 0.55, 0]);   // grey-zone strain
  const gold = Math.max(ip(t, [104.9, 111.0], [0, 0.45]), ip(t, [117.9, 121.0], [0, 1]));
  const shell = ip(t, [0, 0.9, 28.4, 29.4, 42.9, 43.9, 76.5, 77.5, 98.9, 99.9, 117.8, 118.8, 129.6],
                      [0.17, 0.17, 0.17, 0.13, 0.13, 0.16, 0.16, 0.13, 0.13, 0.18, 0.18, 0.26, 0.26]);
  const organOp = ip(t, [0, 28.4, 29.4, 42.9, 43.9, 76.5, 77.5, 98.9, 99.9, 129.6],
                        [1, 1, 0.45, 0.45, 0.8, 0.8, 0.5, 0.5, 1, 1]);
  const breath = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 4.4);
  return (
    <>
      <ambientLight intensity={0.38 + 0.08 * gold} />
      <directionalLight position={[3.5, 4, 3]} intensity={1.35 + 0.4 * gold} color={heat > 0.3 ? "#ffd9cc" : "#fff0dd"} />
      <directionalLight position={[-3.5, 2, -2.5]} intensity={1.25} color="#8fd8e6" />
      <BodyShell shell={shell} heat={heat * 0.5} gold={gold} />
      <Lungs s={s} gold={gold} heat={heat * 0.4} opacity={0.40 * organOp} breathS={breath} breathAmp={0.04} />
      <HeartCore s={s} grow={grow} amp={0.06 + 0.05 * grow} gold={gold} heat={heat} opacity={organOp} scale={1.0} pos={[-0.04, 0.84, 0.18]} />
    </>
  );
};

// ============================== OVERLAY ==============================
const TAGS: Array<[number[], string]> = [
  [B.hook, "01 · THE SAVINGS"], [B.engine, "02 · THE ENGINE"], [B.study, "03 · THE PREDICTOR"],
  [B.grey, "04 · THE GREY ZONE"], [B.myth, "05 · THE MYTH"], [B.lift, "06 · FOR LIFTERS"], [B.proto, "07 · THE PROTOCOL"]];

const BpmWidget: React.FC<{ t: number }> = ({ t }) => {
  const bpm = Math.round(bpmAt(t));
  const s = spike(beatPhaseVar(t, KT, KV));
  const gold = t > 117.9;
  const col = gold ? C.GOLD : C.CYAN;
  return (
    <div style={{ position: "absolute", top: 44, right: 56, textAlign: "right" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "flex-end" }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: col, transform: `scale(${0.7 + 0.5 * s})`, boxShadow: `0 0 ${10 + 18 * s}px ${col}` }} />
        <span style={{ fontFamily: F.anton, color: C.INK, fontSize: 62, lineHeight: 1 }}>{bpm}</span>
        <span style={{ fontFamily: F.mono, color: col, fontSize: 22, letterSpacing: "0.1em" }}>BPM</span>
      </div>
      <svg viewBox="0 0 360 90" style={{ width: 360, marginTop: 6, opacity: 0.85 }}>
        <path d={ecgPath(beatPhaseVar(t, KT, KV), 6, 354, 62, 46, 3)} fill="none" stroke={col} strokeWidth={3} strokeLinecap="round" />
      </svg>
    </div>
  );
};

const Overlay: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps - PRE;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Chapter t={t} tags={TAGS} />
      <BpmWidget t={t} />
      <CredThird t={t} from={5.6} hold={3.0} />

      {/* series tag — small, after the hook has landed (no title-card open) */}
      {t > 900 && (
        <div style={{ position: "absolute", top: 110, left: 56, opacity: ip(t, [3.0, 3.6, 10.8, 11.5], [0, 0.8, 0.8, 0]) }}>
          <span style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 21, letterSpacing: "0.3em" }}>DECODE · EP 04</span>
        </div>
      )}

      {/* HOOK */}
      {t >= 0.62 && t < B.hook[1] + 0.3 && (() => {
        const o = win(t, B.hook);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 385 }}>
              <StatStamp t={t} at={0.95} txt="10.5 MILLION" label="HEARTBEATS SAVED · EVERY YEAR" col={C.GOLD} size={126} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 648, opacity: ip(t, [5.2, 6.0], [0, 1]) }}>
              <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 27, letterSpacing: "0.08em", background: "rgba(10,11,14,0.6)", display: "inline-block", padding: "8px 14px", borderRadius: 8 }}>
                70 → 50 RESTING · 28,800 FEWER / DAY
              </div>
            </div>
            <Head big={"TEN AND A HALF\nMILLION."} it="same life, less work" />
            <Cite txt="ARITHMETIC: 20 BPM × 1,440 MIN × 365 · RESTING-HR RANGES: FAGARD 2003, HEART" />
          </div>
        );
      })()}

      {/* ENGINE */}
      {t >= B.engine[0] && t < B.engine[1] + 0.3 && (() => {
        const o = win(t, B.engine);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300 }}>
              <StatStamp t={t} at={17.6} txt="+60–80%" label="CHAMBER VOLUME · ELITE ENDURANCE ATHLETES" col={C.GOLD} size={118} />
            </div>
            <div style={{ position: "absolute", right: 62, top: 620, textAlign: "right" }}>
              <StatStamp t={t} at={25.2} txt="30 BPM" label="ELITE CYCLISTS WAKE HERE" col={C.CYAN} size={96} />
            </div>
            <Head big={"YOUR HEART IS\nAN ENGINE."} it="almost nobody trains it on purpose" itc={C.CYAN} />
            <Cite txt="MORGANROTH 1975 ANNALS INT MED (181/160 vs 101 mL) · PELLICCIA 1999 · FAGARD 2003 · MUJIKA 2012" />
          </div>
        );
      })()}

      {/* STUDY */}
      {t >= B.study[0] && t < B.study[1] + 0.3 && (() => {
        const o = win(t, B.study);
        const n = Math.round(ip(t, [29.0, 32.2], [0, 122007]));
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300 }}>
              <RollCounter t={t} t0={29.0} t1={32.2} to={122007} step={1000} label="PEOPLE TESTED · CLEVELAND CLINIC" size={132} fmt={(v) => v.toLocaleString()} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 620, opacity: ip(t, [32.8, 33.8], [0, 1]) }}>
              <div style={{ fontFamily: F.anton, color: C.RED, fontSize: 66, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>UNFIT ≈ SMOKING</div>
              <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, opacity: 0.78, marginTop: 8, letterSpacing: "0.08em" }}>AS A PREDICTOR OF DEATH</div>
            </div>
            <div style={{ position: "absolute", right: 62, top: 860, textAlign: "right" }}>
              <StatStamp t={t} at={38.2} txt="1/5TH" label="THE RISK · FITTEST vs LEAST FIT" col={C.GOLD} size={104} />
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1130, textAlign: "center", opacity: ip(t, [40.6, 41.6], [0, 1]) }}>
              <HonestyChip big="NO CEILING IN THE DATA." sub="OBSERVATIONAL COHORT · 8.4 YEARS · IT PREDICTS, IT DOES NOT PROMISE" />
            </div>
            <Head big={"THE\nPREDICTOR."} it="one number, one hundred twenty thousand lives" itc={C.RED} />
            <Cite txt="MANDSAGER ET AL. 2018, JAMA NETWORK OPEN · n=122,007 · ADJUSTED HR 0.20 ELITE vs LOW" />
          </div>
        );
      })()}

      {/* GREY ZONE */}
      {t >= B.grey[0] && t < B.grey[1] + 0.3 && (() => {
        const o = win(t, B.grey);
        const drift = ip(t, [47.0, 53.5], [0, 1]);
        const fix = ip(t, [61.6, 62.6], [0, 1]);
        const zones = [["EASY", C.TEAL, 0.72], ["THE GREY MIDDLE", C.RED, 1], ["HARD", C.GOLD2, 0.72]] as const;
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            {t < 62.5 && (
              <div style={{ position: "absolute", left: 56, right: 66, top: 386, opacity: ip(t, [44.0, 45.0], [0, 1]) * (1 - fix) }}>
                {zones.map(([lab, col, op], i) => {
                  const hot = i === 1;
                  const dots = hot ? Math.round(2 + 8 * drift) : Math.round(6 - 4 * drift);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, opacity: op }}>
                      <div style={{ width: 210, fontFamily: F.mono, color: col, fontSize: 22, letterSpacing: "0.08em" }}>{lab}</div>
                      <div style={{ flex: 1, height: 54, border: `2px solid ${col}`, borderRadius: 10, background: hot ? `rgba(255,59,48,${0.10 + 0.16 * drift})` : "rgba(10,11,14,0.5)", display: "flex", alignItems: "center", paddingLeft: 12, gap: 10 }}>
                        {Array.from({ length: dots }).map((_, k) => (
                          <div key={k} style={{ width: 16, height: 16, borderRadius: 8, background: col, opacity: 0.9 }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontFamily: F.corm, fontStyle: "italic", color: C.RED, fontSize: 38, marginTop: 10, opacity: drift }}>every run becomes a race, every race becomes a jog</div>
              </div>
            )}
            {fix > 0 && (
              <div style={{ position: "absolute", left: 56, top: 320, opacity: fix }}>
                <StatStamp t={t} at={62.6} txt="80% EASY" label="HOW THE FASTEST HUMANS TRAIN" col={C.TEAL} size={122} />
                <div style={{ marginTop: 26 }}><ItalicClaim txt="truly easy. full sentences easy." col={C.TEAL} /></div>
                <div style={{ marginTop: 40 }}>
                  <StatStamp t={t} at={69.4} txt="4 MIN × 4 · +7%" label="ENGINE GROWTH · 8 WEEKS · TRAINED ADULTS" col={C.GOLD} size={84} />
                </div>
              </div>
            )}
            <Head big={"THE GREY\nZONE."} it={t < 62 ? "where progress goes quiet" : "the fix is eighty twenty"} itc={t < 62 ? C.RED : C.TEAL} />
            <Cite txt={t < 62 ? "FOSTER 2001 (DRIFT) · STÖGGL & SPERLICH 2014 (THRESHOLD: NO SIG. VO2 GAIN)" : "SEILER & KJERLAND 2006 (~80% EASY) · PERSINGER 2004 (TALK TEST) · HELGERUD 2007 (4×4 +7.2%)"} />
          </div>
        );
      })()}

      {/* MYTH */}
      {t >= B.myth[0] && t < B.myth[1] + 0.3 && (() => {
        const o = win(t, B.myth);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 310 }}>
              <MythStrike t={t} at={86.9} txt={'"CARDIO KILLS GAINS"'} size={76} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 470, opacity: ip(t, [80.8, 81.8], [0, 1]) }}>
              <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 24, letterSpacing: "0.08em", background: "rgba(10,11,14,0.6)", display: "inline-block", padding: "10px 16px", borderRadius: 8 }}>
                b. 1980 · ONE STUDY · SIX DAYS A WEEK OF BRUTAL CARDIO
              </div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 640 }}>
              <StatStamp t={t} at={89.9} txt="ZERO" label="MUSCLE DIFFERENCE · 43 STUDIES POOLED · 2022" col={C.GOLD} size={150} />
            </div>
            <div style={{ position: "absolute", left: 56, right: 66, top: 1024, opacity: ip(t, [93.3, 93.7], [0, 1]) }}>
              <div style={{ fontFamily: F.anton, color: C.CYAN, fontSize: 46, textShadow: "0 0 24px rgba(10,11,14,0.95)" }}>HARD CARDIO + HEAVY LIFTS: HOURS APART.</div>
              <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 46, marginTop: 8, textShadow: "0 0 24px rgba(10,11,14,0.95)" }}>CHASING SIZE: BIKE OVER LONG RUNS.</div>
            </div>
            <Head big={"THE\nMYTH."} it={t > 88.4 ? "forty three studies later, the fear is dead" : "the fear was born in a lab, in 1980"} itc={C.GOLD} />
            <Cite txt="HICKSON 1980 (ORIGIN) · SCHUMANN 2022 SPORTS MED (SMD −0.01, 43 STUDIES) · WILSON 2012 JSCR" />
          </div>
        );
      })()}

      {/* LIFTERS */}
      {t >= B.lift[0] && t < B.lift[1] + 0.3 && (() => {
        const o = win(t, B.lift);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 320 }}>
              <Kicker small="WHAT LIFTERS MISS" big="REST IS AEROBIC" sub="PHOSPHOCREATINE REFILLS OXIDATIVELY BETWEEN SETS" />
            </div>
            <div style={{ position: "absolute", left: 56, top: 620, opacity: ip(t, [101.8, 102.8], [0, 1]) }}>
              <ItalicClaim txt="a fitter heart refills your strength faster" col={C.GOLD} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 800 }}>
              <StatStamp t={t} at={106.2} txt="75 → 45" label="LIFELONG TRAINERS · HEARTS TESTING 30 YEARS YOUNGER" col={C.GOLD} size={110} />
            </div>
            <Head big={"FOR\nLIFTERS."} it="the engine feeds the iron" />
            <Cite txt="HASELER 1999 J APPL PHYSIOL (PCr · O2) · GRIES 2018 J APPL PHYSIOL (LIFELONG COHORT)" />
          </div>
        );
      })()}

      {/* PROTOCOL */}
      {t >= B.proto[0] && t < B.proto[1] + 0.3 && (() => {
        const o = win(t, B.proto);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, right: 66, top: 340 }}>
              {[["2–3 × EASY", "CONVERSATION PACE · FULL SENTENCES", C.TEAL, 112.2],
                ["1 × HARD", "INTERVALS · EARN IT", C.GOLD, 115.7]].map(([a, b, col, at], i) => (
                <div key={i} style={{ opacity: ip(t, [at as number, (at as number) + 0.7], [0, 1]), marginBottom: 34 }}>
                  <div style={{ fontFamily: F.anton, color: col as string, fontSize: 96, lineHeight: 1 }}>{a}</div>
                  <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 23, opacity: 0.8, letterSpacing: "0.1em", marginTop: 8 }}>{b}</div>
                </div>
              ))}
            </div>
            <Head big={"THE\nPROTOCOL."} it="every week, for the rest of your life" itc={C.TEAL} />
            <Cite txt="WHO 150–300 MIN/WEEK BASELINE · SEILER 2010 (INTENSITY DISTRIBUTION)" />
          </div>
        );
      })()}

      {/* CTA */}
      {t >= B.cta[0] && (
        <AbsoluteFill style={{ background: "linear-gradient(100deg, rgba(10,11,14,0.72) 0%, rgba(10,11,14,0.38) 44%, transparent 70%)", opacity: ip(t, [B.cta[0], B.cta[0] + 0.8], [0, 1]) }} />
      )}
      {t >= B.cta[0] && (
        <CTABlock t={t} at={B.cta[0] + 0.4}
          headline={"THREE BILLION\nBEATS."}
          italic="train it, and every beat costs less"
          question="WHAT IS YOUR MORNING NUMBER?"
          ask="COMMENT YOUR RESTING HR ⬇"
          pill="BODY SCAN — FREE" />
      )}
      <ContentsCard t={t + PRE} until={PRE + 0.70} ep="DECODE · EP 04" title="ENDURANCE"
        items={["THE SAVINGS", "THE ENGINE", "THE DEATH PREDICTOR", "THE GREY ZONE", "THE GAINS MYTH", "FOR LIFTERS", "THE PROTOCOL"]}
        itemAts={[2.06, 2.84, 3.50, 4.46, 5.28, 6.16, 7.00]} />
    </AbsoluteFill>
  );
};

// ============================== FILM ==============================
export const Endurance01: React.FC<{ mix?: string }> = ({ mix }) => {
  const b = useBody(); const l = useLungs();
  return (
    <AbsoluteFill style={{ background: "#0A0B0E" }}>
      {mix && <Audio src={staticFile(mix)} />}
      <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 1.1, 4.9], fov: 42 }}>
        <Rig />
        {b && l && <Stage />}
        <EffectComposer disableNormalPass>
          <Bloom intensity={0.95} luminanceThreshold={0.34} luminanceSmoothing={0.3} mipmapBlur radius={0.74} />
          <Vignette darkness={0.62} offset={0.3} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 94% 84% at 50% 44%, transparent 50%, rgba(0,0,0,.68) 100%)", pointerEvents: "none" }} />
      <Overlay />
    </AbsoluteFill>
  );
};
export const calcEndurance01 = () => ({ durationInFrames: 4138, fps: 30, width: 1080, height: 1920 });

