// CoreSpine — real 15-vertebra thoracolumbar column (extracted from skeleton.glb)
// driven as a forward-kinematic chain, plus the procedural pressure canister
// (TVA corset rings + diaphragm dome + pelvic-floor bowl).
// Used by CORE 01. Module-level cache + delayRender, same pattern as Strength01.
import React from "react";
import * as THREE from "three";
import { staticFile, delayRender, continueRender } from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Vert = { g: THREE.Group; c: THREE.Vector3 };
let SPINE: Vert[] | null = null;
let BODY: THREE.Group | null = null;

// ---- body shell (écorché) — the human the spine lives in -----------------
// Same asset and treatment as the BREATH film: a translucent figure that fills
// the frame, with the anatomy glowing inside it.
export const useBody = () => {
  const [ready, setReady] = React.useState<boolean>(!!BODY);
  const [handle] = React.useState(() => (BODY ? null : delayRender("core-body", { timeout: 240000 })));
  React.useEffect(() => {
    if (BODY) return;
    const L = new GLTFLoader();
    L.load(staticFile("fbm/mbmm/ecorche.glb"), (gl) => {
      const s = gl.scene;
      s.traverse((o: any) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) {
            o.userData._base = o.material.color ? o.material.color.clone() : new THREE.Color(1, 1, 1);
            if (o.material.emissive !== undefined) { o.material.emissive = new THREE.Color(0x000000); o.material.emissiveIntensity = 0; }
            o.material.depthWrite = false;          // shell must not occlude the spine
          }
        }
      });
      s.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(s);
      const c = bx.getCenter(new THREE.Vector3());
      const z = bx.getSize(new THREE.Vector3());
      const sc = 3.6 / Math.max(z.x, z.y, z.z);
      s.scale.setScalar(sc); s.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
      BODY = s; setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

// shell 0..1 = visibility · heat 0..1 = stress/red · gold 0..1 = living gold
export const BodyShell: React.FC<{ shell: number; heat?: number; gold?: number }> = ({ shell, heat = 0, gold = 0 }) => {
  if (!BODY || shell <= 0.001) return null;
  const cool = new THREE.Color("#5D7D8C");
  const warm = new THREE.Color("#C9705E");
  const gld = new THREE.Color("#D4A148");
  const tint = cool.clone().lerp(warm, heat).lerp(gld, 0.72 * gold);
  BODY.traverse((o: any) => {
    if (!o.isMesh || !o.material) return;
    if (o.material.color) o.material.color.copy((o.userData._base as THREE.Color) || new THREE.Color(1, 1, 1)).lerp(tint, 0.82);
    if (o.material.emissive) {
      o.material.emissive.setRGB(0.055 * heat + 0.075 * gold, 0.028 + 0.042 * gold, 0.052 - 0.03 * heat);
      o.material.emissiveIntensity = 0.12 + 0.26 * gold;
    }
    o.material.transparent = true;
    o.material.opacity = shell;
  });
  return <primitive object={BODY} />;
};

// ---- loader -------------------------------------------------------------
export const useSpine = () => {
  const [ready, setReady] = React.useState<boolean>(!!SPINE);
  const [handle] = React.useState(() => (SPINE ? null : delayRender("core-spine", { timeout: 180000 })));
  React.useEffect(() => {
    if (SPINE) return;
    const L = new GLTFLoader();
    L.load(staticFile("fbm/mbmm/spine.glb"), (gl) => {
      const s = gl.scene;
      s.updateMatrixWorld(true);
      // collect V00..VNN meshes, bake world transform, normalise to unit height
      const found: Array<{ m: THREE.Mesh; i: number }> = [];
      s.traverse((o: any) => {
        if (o.isMesh && /^V\d\d/.test(o.name || "")) found.push({ m: o as THREE.Mesh, i: parseInt(o.name.slice(1, 3), 10) });
      });
      found.sort((a, b) => a.i - b.i);
      const box = new THREE.Box3().setFromObject(s);
      const size = box.getSize(new THREE.Vector3());
      const sc = 3.0 / size.y;                    // column = 3 units tall
      const mid = box.getCenter(new THREE.Vector3());

      const verts: Vert[] = found.map(({ m }) => {
        const geo = (m.geometry as THREE.BufferGeometry).clone();
        geo.applyMatrix4(m.matrixWorld);          // bake node transform
        geo.translate(-mid.x, -box.min.y, -mid.z); // base at y=0, centred x/z
        geo.scale(sc, sc, sc);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.62, metalness: 0.06, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        const bb = new THREE.Box3().setFromObject(mesh);
        const c = bb.getCenter(new THREE.Vector3());
        // pivot group sits at the vertebra centre; mesh offsets back so it draws in place
        const g = new THREE.Group();
        mesh.position.set(-c.x, -c.y, -c.z);
        g.add(mesh);
        g.position.copy(c);
        return { g, c: c.clone() };
      });
      SPINE = verts;
      setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

export const spineHeight = () => (SPINE ? SPINE[SPINE.length - 1].c.y + 0.16 : 3.0);

// ---- the column ---------------------------------------------------------
// buckle 0..1  — Euler-style failure: S-curve + forward flexion, worst mid-column
// gold   0..1  — bone → living gold (muscle-supported)
// crush  0..1  — vertical compression (sit-up beat)
export const SpineColumn: React.FC<{ buckle: number; gold: number; crush?: number; opacity?: number }> = ({ buckle, gold, crush = 0, opacity = 1 }) => {
  const root = React.useRef<THREE.Group>(null);
  if (!SPINE) return null;
  const n = SPINE.length;

  // forward kinematics along the chain
  let pos = SPINE[0].c.clone();
  let rot = new THREE.Quaternion();
  const boneCol = new THREE.Color("#DCD4C4");
  const goldCol = new THREE.Color("#E8BC6A");
  const failCol = new THREE.Color("#FF3B30");

  for (let i = 0; i < n; i++) {
    const v = SPINE[i];
    if (i > 0) {
      const u = i / (n - 1);
      // first + second buckling modes → an S that fails forward
      const lat = 0.112 * Math.sin(Math.PI * u) + 0.062 * Math.sin(2 * Math.PI * u);
      const fwd = 0.085 * Math.sin(Math.PI * u) + 0.024 * Math.sin(3 * Math.PI * u);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(fwd * buckle, 0, lat * buckle, "XYZ"));
      rot = rot.clone().multiply(q);
      const seg = SPINE[i].c.clone().sub(SPINE[i - 1].c);
      seg.y *= 1 - 0.17 * crush;                 // discs compress
      pos = pos.clone().add(seg.applyQuaternion(rot));
    }
    v.g.position.copy(pos);
    v.g.quaternion.copy(rot);
    const mesh = v.g.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const stress = buckle * Math.sin(Math.PI * (i / (n - 1)));   // mid-column takes the damage
    mat.color.copy(boneCol).lerp(goldCol, gold).lerp(failCol, 0.55 * stress * (1 - gold));
    mat.emissive = new THREE.Color().copy(goldCol).multiplyScalar(0.34 * gold + 0.10 * stress);
    mat.emissiveIntensity = 1;
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
  }
  return <group ref={root}>{SPINE.map((v, i) => <primitive key={i} object={v.g} />)}</group>;
};

// ---- the pressure canister ---------------------------------------------
// p 0..1 = how built the cylinder is · press 0..1 = intra-abdominal pressure
const Ring: React.FC<{ y: number; r: number; op: number; col: string; tube?: number }> = ({ y, r, op, col, tube = 0.026 }) => (
  <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <torusGeometry args={[r, tube, 8, 64]} />
    <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.85} transparent opacity={op} roughness={0.4} />
  </mesh>
);

export const PressureCanister: React.FC<{ p: number; press?: number; showRoof?: number; showFloor?: number }> = ({ p, press = 0, showRoof = 1, showFloor = 1 }) => {
  const H = 3.0;
  const N = 15;
  const squeeze = 1 - 0.10 * press;
  const GOLD = "#E8BC6A", TEAL = "#3FB5C4", CY = "#7FE3EC";
  return (
    <group>
      {/* TVA corset — 360° rings, widest at the waist */}
      {Array.from({ length: N }).map((_, i) => {
        const u = i / (N - 1);
        const y = 0.28 + u * (H - 0.62);
        const prof = 0.60 + 0.30 * Math.sin(Math.PI * Math.min(1, u * 1.08));
        const appear = Math.max(0, Math.min(1, p * (N + 2) - i));   // build bottom-up
        return <Ring key={i} y={y} r={prof * squeeze} op={0.46 * appear} col={GOLD} tube={0.022} />;
      })}
      {/* vertical fascia lines */}
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const r = 0.80 * squeeze;
        return (
          <mesh key={`f${i}`} position={[Math.cos(a) * r, H / 2, Math.sin(a) * r]}>
            <boxGeometry args={[0.012, H * 0.78, 0.012]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.55} transparent opacity={0.16 * p} />
          </mesh>
        );
      })}
      {/* diaphragm — the roof */}
      <mesh position={[0, H - 0.34 + 0.10 * press, 0]} scale={[0.82 * squeeze, 0.40, 0.82 * squeeze]}>
        <sphereGeometry args={[1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={CY} emissive={TEAL} emissiveIntensity={0.7} transparent opacity={0.52 * p * showRoof} side={THREE.DoubleSide} wireframe />
      </mesh>
      {/* pelvic floor — the base */}
      <mesh position={[0, 0.34 - 0.05 * press, 0]} rotation={[Math.PI, 0, 0]} scale={[0.70 * squeeze, 0.32, 0.70 * squeeze]}>
        <sphereGeometry args={[1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={CY} emissive={TEAL} emissiveIntensity={0.7} transparent opacity={0.52 * p * showFloor} side={THREE.DoubleSide} wireframe />
      </mesh>
    </group>
  );
};

// ---- multifidus — the deep stabiliser that wastes after a back-pain episode ----
// show 0..1 = present · waste 0..1 = atrophy (shrinks + dims + desaturates)
export const Multifidus: React.FC<{ show: number; waste: number }> = ({ show, waste }) => {
  if (!SPINE) return null;
  const lo = Math.floor(SPINE.length * 0.55);               // lumbar region only
  const strands: React.ReactNode[] = [];
  for (let i = lo; i < SPINE.length - 1; i++) {
    const a = SPINE[i].g.position, b = SPINE[i + 1].g.position;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b) * 1.65;
    for (const s of [-1, 1]) {
      strands.push(
        <mesh key={`${i}${s}`} position={[mid.x + s * 0.17, mid.y, mid.z - 0.20]} rotation={[0, 0, s * 0.10]}>
          <capsuleGeometry args={[0.055 * (1 - 0.55 * waste), len, 4, 10]} />
          <meshStandardMaterial
            color={waste > 0.5 ? "#8A6F5C" : "#C94B3F"}
            emissive={"#C94B3F"} emissiveIntensity={0.42 * (1 - waste)}
            transparent opacity={show * (0.80 - 0.50 * waste)} roughness={0.55} />
        </mesh>
      );
    }
  }
  return <group>{strands}</group>;
};

