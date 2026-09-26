// EnduranceHeart — EP-04's engine visuals.
// HONESTY NOTE: muscles.glb has no usable cardiac geometry (its "Right atrium"
// cluster turned out to be pectoral muscle sheets — verified by per-mesh QC).
// So the heart is a PROCEDURAL luminous core (Whoop-style glow organ) placed
// between the REAL BodyParts3D lungs — no fake anatomy, and the read is instant:
// a light in the chest that beats. Rate, ECG, counter and 3D all run off ONE clock.
import React from "react";
import * as THREE from "three";
import { staticFile, delayRender, continueRender } from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let LUNG: THREE.Group | null = null;

const fitTo = (s: THREE.Group, h: number, prep: (o: any) => void) => {
  s.traverse((o: any) => { if (o.isMesh) { o.frustumCulled = false; prep(o); } });
  s.updateMatrixWorld(true);
  const bx = new THREE.Box3().setFromObject(s);
  const c = bx.getCenter(new THREE.Vector3()); const z = bx.getSize(new THREE.Vector3());
  const sc = h / Math.max(z.x, z.y, z.z);
  s.scale.setScalar(sc); s.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
  return s;
};

export const useLungs = () => {
  const [ready, setReady] = React.useState<boolean>(!!LUNG);
  const [handle] = React.useState(() => (LUNG ? null : delayRender("endu-lungs", { timeout: 180000 })));
  React.useEffect(() => {
    if (LUNG) return;
    new GLTFLoader().load(staticFile("fbm/mbmm/lungs.glb"), (g) => {
      LUNG = fitTo(g.scene, 0.66, (o) => {
        o.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#2a7787"), emissive: new THREE.Color("#0e515c"),
          emissiveIntensity: 0.06, roughness: 0.58, metalness: 0,
          transparent: true, opacity: 0.92,
        });
      });
      setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

// One clock for everything: sharp systole spike + softer refill.
export const beatPhase = (t: number, bpm: number) => {
  const p = (t * bpm / 60) % 1;
  return Math.exp(-Math.pow((p - 0.10) / 0.085, 2)) + 0.42 * Math.exp(-Math.pow((p - 0.30) / 0.10, 2));
};

// Integrated phase for a CHANGING bpm (piecewise-linear), so the beat never
// jumps when the rate animates 70 → 45. Mirrors BreathReel's breathPhase.
export const beatPhaseVar = (t: number, T: number[], V: number[]) => {
  let ph = 0;
  for (let i = 1; i < T.length; i++) {
    const t0 = T[i - 1], t1 = T[i];
    if (t <= t0) break;
    const te = Math.min(t, t1);
    const rEnd = V[i - 1] + (V[i] - V[i - 1]) * ((te - t0) / (t1 - t0));
    ph += ((V[i - 1] + rEnd) / 2) * (te - t0) / 60;
    if (te === t) return ph;
  }
  if (t > T[T.length - 1]) ph += (V[V.length - 1] / 60) * (t - T[T.length - 1]);
  return ph;
};
export const spike = (phase: number) => {
  const p = phase % 1;
  return Math.exp(-Math.pow((p - 0.10) / 0.085, 2)) + 0.42 * Math.exp(-Math.pow((p - 0.30) / 0.10, 2));
};

// The luminous heart-core: an organic cluster (ventricle mass + two atrial
// lobes + aortic stub) that swells on the clock and lights the chest.
// s = beat spike 0..1 · grow = athlete's-heart size · amp = stroke-volume pulse
export const HeartCore: React.FC<{
  s: number; grow?: number; amp?: number; gold?: number; heat?: number;
  opacity?: number; scale?: number; pos?: [number, number, number];
}> = ({ s, grow = 0, amp = 0.07, gold = 0, heat = 0, opacity = 1, scale = 1, pos = [0, 0, 0] }) => {
  const base = new THREE.Color("#C4453A").lerp(new THREE.Color("#E8BC6A"), 0.75 * gold);
  const emis = new THREE.Color("#8F1F1A").lerp(new THREE.Color("#D4A148"), 0.8 * gold)
    .lerp(new THREE.Color("#FF3B30"), 0.35 * heat);
  const k = scale * (1 + 0.24 * grow) * (1 + amp * s);
  const glow = 0.9 + 1.6 * s;
  const M = (o = 1) => (
    <meshStandardMaterial color={base} emissive={emis} emissiveIntensity={glow}
      transparent opacity={opacity * o} roughness={0.42} />
  );
  return (
    <group position={pos} scale={k} rotation={[0.12, -0.25, 0.28]}>
      {/* ventricle mass — tapered toward the apex (down-left) */}
      <mesh position={[0, -0.045, 0]} scale={[0.82, 1.05, 0.78]}>
        <sphereGeometry args={[0.115, 28, 22]} />{M()}
      </mesh>
      <mesh position={[-0.038, -0.10, 0.010]} scale={[0.66, 0.78, 0.62]}>
        <sphereGeometry args={[0.105, 24, 18]} />{M()}
      </mesh>
      {/* atrial lobes */}
      <mesh position={[0.045, 0.055, -0.008]} scale={[0.66, 0.58, 0.64]}>
        <sphereGeometry args={[0.1, 22, 16]} />{M(0.95)}
      </mesh>
      <mesh position={[-0.048, 0.05, 0.016]} scale={[0.56, 0.52, 0.54]}>
        <sphereGeometry args={[0.1, 22, 16]} />{M(0.95)}
      </mesh>
      {/* aortic stub */}
      <mesh position={[0.014, 0.105, 0]} rotation={[0, 0, -0.5]}>
        <cylinderGeometry args={[0.034, 0.052, 0.13, 16]} />{M(0.9)}
      </mesh>
      {/* inner light — throws the beat onto the lungs and shell */}
      <pointLight color={gold > 0.5 ? "#E8BC6A" : "#FF5A4A"} intensity={0.55 + 1.5 * s} distance={1.9} decay={2} />
    </group>
  );
};

// ECG trace for SVG overlays, phase-locked to the same clock.
// phase = beatPhaseVar(t, T, V) — pass the film's rate keyframes.
export const ecgPath = (phase: number, x0: number, x1: number, y0: number, h: number, beats = 4) => {
  const W = x1 - x0; const pts: string[] = []; const N = 240;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = (u * beats + 1 - (phase % 1)) % 1;
    let y = 0;
    y += 0.08 * Math.exp(-Math.pow((p - 0.16) / 0.03, 2));
    y -= 0.12 * Math.exp(-Math.pow((p - 0.235) / 0.008, 2));
    y += 1.00 * Math.exp(-Math.pow((p - 0.25) / 0.009, 2));
    y -= 0.28 * Math.exp(-Math.pow((p - 0.268) / 0.010, 2));
    y += 0.16 * Math.exp(-Math.pow((p - 0.40) / 0.035, 2));
    pts.push(`${i ? "L" : "M"}${(x0 + u * W).toFixed(1)} ${(y0 - y * h).toFixed(1)}`);
  }
  return pts.join(" ");
};

// Lungs colour/state driver (hero support, not the star this episode).
export const Lungs: React.FC<{ s: number; gold?: number; heat?: number; opacity?: number; pos?: [number, number, number]; breathAmp?: number; breathS?: number }> = ({ s, gold = 0, heat = 0, opacity = 1, pos = [0, 0.8, 0.14], breathAmp = 0.05, breathS = 0 }) => {
  const g = React.useRef<THREE.Group>(null);
  if (!LUNG) return null;
  const lc = new THREE.Color("#2a7787").lerp(new THREE.Color("#C94B3F"), heat).lerp(new THREE.Color("#D4A148"), 0.5 * gold);
  const le = new THREE.Color("#0e515c").lerp(new THREE.Color("#FF7A66"), heat).lerp(new THREE.Color("#E8BC6A"), 0.55 * gold);
  LUNG.traverse((o: any) => {
    if (o.isMesh && o.material) {
      o.material.color.copy(lc); o.material.emissive.copy(le);
      o.material.emissiveIntensity = 0.05 + 0.10 * s;
      o.material.opacity = opacity;
    }
  });
  if (g.current) {
    g.current.scale.setScalar(1 + breathAmp * breathS);
    g.current.position.set(pos[0], pos[1] + 0.02 * breathS, pos[2]);
  }
  return <group ref={g}><primitive object={LUNG} /></group>;
};

