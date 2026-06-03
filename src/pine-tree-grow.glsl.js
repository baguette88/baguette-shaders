// pine-tree-grow.glsl.js — a conifer that GROWS from sprout to full tree.
//
// Look: a stylized layered pine. A `uGrow` uniform (0→1) drives a growth
// FRONT that rises up the trunk; geometry below the front is full-size,
// geometry above it is collapsed onto the central axis and clamped down to
// the front height — so the tree telescopes upward and each needle tier
// unfurls outward as the front sweeps past it. Freshly-emerged geometry at
// the front is tinted bright lime ("new growth") and matures to deep green
// behind it.
//
// Drive it: ease `uGrow` 0→1 over a few seconds (optionally with a little
// overshoot/settle) to plant a tree. Leave it at 1.0 for a finished tree
// that just sways in the wind.
//
// Geometry contract: the mesh must provide a float attribute `aType`
//   0.0 = bark/trunk, 1.0 = needle
// and its vertices must be baked at FINAL world-relative heights (local
// position.y == true height above the base), because the growth front is a
// height test in local space. Use the exported `buildPineTreeGeometry(THREE)`
// helper and you get all of this for free.
//
// Uniforms:
//   uTime      — seconds, for wind sway
//   uGrow      — 0..1 growth progress (THE control)
//   uHeight    — total tree height in local units (match the geometry)
//   uBand      — softness of the growth front (default 0.5); bigger = looser
//   uSway      — wind sway amplitude in local units (default 0.04)
//   uLightDir  — directional light (world space)
//   uBark/uBarkDark            — trunk palette
//   uNeedle/uNeedleDark/uNeedleFresh — canopy palette (mature/under/new growth)
//   uSnow (0..1) + uFrost      — snow dusting on up-facing needles
//   uAO        — base-darkening amount (fake ambient occlusion), default 0.35
//
// WebGL2 / three r160+. Uses `varying` (not `in/out`), matches the rest of
// the baguette-shaders catalog.

export const pineTreeGrowVertex = /* glsl */`
uniform float uTime;
uniform float uGrow;
uniform float uHeight;
uniform float uBand;
uniform float uSway;

attribute float aType;

varying vec3  vNormalW;
varying vec3  vPos;
varying float vType;
varying float vEmerge;  // 1.0 = just emerged at the front, fades to 0 behind it
varying float vUpY;     // local height normalized 0..1

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

void main(){
  vec3 p = position;
  float h = p.y;

  // current growth front height (a touch above the target so it fully closes)
  float front = uGrow * (uHeight + uBand);

  // emerge: 0 while the front is still well below this vertex, ramps to 1
  // as the front sweeps past it
  float emerge = smoothstep(0.0, uBand, front - h);

  // unfurl: collapse radius onto the trunk axis until emerged, and clamp the
  // height to the front so nothing pokes out ahead of the growing tip
  p.xz *= emerge;
  p.y   = min(h, front);

  // freshness: bright at the leading edge of growth, matures behind it
  vEmerge = 1.0 - smoothstep(0.0, uBand * 2.2, front - h);

  // wind sway — only on emerged geometry, scaled up toward the top
  float k  = emerge * smoothstep(0.0, uHeight * 0.25, h);
  float ph = hash11(floor(h * 3.0)) * 6.2831;
  p.x += sin(uTime * 1.3 + h * 0.8 + ph) * uSway * k;
  p.z += cos(uTime * 1.1 + h * 0.7 + ph) * uSway * k;

  vUpY     = clamp(h / uHeight, 0.0, 1.0);
  vType    = aType;
  vNormalW = normalize(mat3(modelMatrix) * normal);

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const pineTreeGrowFragment = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3  uLightDir;
uniform vec3  uBark;
uniform vec3  uBarkDark;
uniform vec3  uNeedle;
uniform vec3  uNeedleDark;
uniform vec3  uNeedleFresh;
uniform float uSnow;
uniform vec3  uFrost;
uniform float uAO;

varying vec3  vNormalW;
varying vec3  vPos;
varying float vType;
varying float vEmerge;
varying float vUpY;

float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main(){
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  float ndl  = max(dot(N, L), 0.0);
  float diff = 0.4 + 0.6 * ndl;            // wrap-ish ambient + lambert

  vec3 col;
  if (vType < 0.5){
    // --- bark: vertical grooves + per-column streak jitter --------------
    float streak = hash21(vec2(floor((vPos.x + vPos.z) * 28.0), 0.0));
    float groove = 0.5 + 0.5 * sin(vPos.y * 38.0 + streak * 6.2831);
    col = mix(uBarkDark, uBark, groove * (0.4 + 0.6 * streak));
  } else {
    // --- needles: darker underside, per-clump hue jitter ---------------
    float under  = smoothstep(-1.0, 1.0, N.y);
    col = mix(uNeedleDark, uNeedle, 0.4 + 0.6 * under);
    float jitter = hash21(floor(vPos.xz * 4.0));
    col *= 0.85 + 0.3 * jitter;
    // fresh new growth at the leading edge of the grow front = bright lime
    col = mix(col, uNeedleFresh, smoothstep(0.5, 1.0, vEmerge));
  }

  // fake AO — darker toward the inner base, brighter toward the lit crown
  col *= mix(1.0 - uAO, 1.0, vUpY);
  col *= diff;

  // snow dusting on up-facing surfaces
  float up = smoothstep(0.45, 0.92, N.y);
  col = mix(col, uFrost, up * uSnow);

  gl_FragColor = vec4(col, 1.0);
}
`;

// Uniforms factory — no hard THREE import; caller passes opts.THREE or we
// fall back to window.THREE (the museum/demo expose it globally).
export function pineTreeGrowUniforms(opts = {}) {
  const THREE = opts.THREE || (typeof window !== 'undefined' && window.THREE);
  if (!THREE) throw new Error('pineTreeGrowUniforms: pass opts.THREE or expose window.THREE');
  return {
    uTime:        { value: 0 },
    uGrow:        { value: opts.grow   ?? 0.0 },
    uHeight:      { value: opts.height ?? 4.0 },
    uBand:        { value: opts.band   ?? 0.5 },
    uSway:        { value: opts.sway   ?? 0.04 },
    uLightDir:    { value: new THREE.Vector3(...(opts.lightDir ?? [0.4, 1.0, 0.5])).normalize() },
    uBark:        { value: new THREE.Color(opts.bark        ?? 0x5b3a21) },
    uBarkDark:    { value: new THREE.Color(opts.barkDark    ?? 0x2e1d10) },
    uNeedle:      { value: new THREE.Color(opts.needle      ?? 0x2f6d3a) },
    uNeedleDark:  { value: new THREE.Color(opts.needleDark  ?? 0x163a20) },
    uNeedleFresh: { value: new THREE.Color(opts.needleFresh ?? 0x9fd84a) },
    uSnow:        { value: opts.snow   ?? 0.0 },
    uFrost:       { value: new THREE.Color(opts.frost ?? 0xf2f7ff) },
    uAO:          { value: opts.ao     ?? 0.35 },
  };
}

// ---------------------------------------------------------------------------
// buildPineTreeGeometry(THREE, opts) -> BufferGeometry
//
// Turnkey layered-pine geometry, baked at final heights with the `aType`
// attribute the shader needs. Non-indexed and pre-merged (trunk + N needle
// tiers) so you can drop it straight into one Mesh with the grow material.
//
//   opts.height  total tree height        (default 4.0)
//   opts.tiers   number of needle cones   (default 6)
//   opts.radial  cone radial segments     (default 9)
//   opts.trunk   trunk radius             (default 0.12)
//
// Returns the geometry; read geometry.userData.height to feed uHeight.
// ---------------------------------------------------------------------------
export function buildPineTreeGeometry(THREE, opts = {}) {
  const H      = opts.height ?? 4.0;
  const tiers  = opts.tiers  ?? 6;
  const radial = opts.radial ?? 9;
  const trunkR = opts.trunk  ?? 0.12;

  const positions = [];
  const normals   = [];
  const types     = [];

  const bake = (geo, type, yOffset) => {
    geo.translate(0, yOffset, 0);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    for (let i = 0; i < pos.length; i++) { positions.push(pos[i]); normals.push(nor[i]); }
    for (let i = 0; i < pos.length / 3; i++) types.push(type);
    geo.dispose(); if (g !== geo) g.dispose();
  };

  // trunk: a short tapered cylinder, base at y=0
  const trunkH = H * 0.22;
  bake(new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8), 0.0, trunkH * 0.5);

  // needle tiers: overlapping cones, widest at the bottom, shrinking up
  const canopyBase = trunkH * 0.6;
  const canopyH    = H - canopyBase;
  const step       = canopyH / (tiers + 1);
  for (let i = 0; i < tiers; i++) {
    const t       = i / (tiers - 1);              // 0 bottom .. 1 top
    const baseY   = canopyBase + i * step;
    const coneH   = step * 2.1;                    // overlap neighbours
    const radius  = (1.0 - t) * (H * 0.34) + 0.18; // taper to a point
    bake(new THREE.ConeGeometry(radius, coneH, radial), 1.0, baseY + coneH * 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aType',    new THREE.Float32BufferAttribute(types, 1));
  geo.computeBoundingSphere();
  geo.userData.height = H;
  return geo;
}
