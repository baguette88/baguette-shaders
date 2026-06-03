// flame.glsl.js — stylized torch flame, billboard card.
//
// Look: paint-y banded flame (Hades / Sea of Stars vibe). 3-stop palette
// (deep-red shadow → orange body → yellow-white tips) banded by remapped
// fbm value rather than uv.y, so the gradient feels organic. Upward
// scrolling fbm gives gas-like rise; a parabolic taper narrows the
// silhouette toward the top; jittered hot-spots flicker inside the body.
//
// Recommended geometry: PlaneGeometry(1.5, 3) — pivot at base (translate
// y +1.5 after geometry creation, or set mesh.position.y = base height).
// Material flags: { transparent:true, depthWrite:false,
//                   blending: THREE.AdditiveBlending, side: THREE.DoubleSide }
// Background: very dark (≤ #050505). Additive blending eats mid-grays.
//
// Uniforms:
//   uTime, uColorBase, uColorMid, uColorTip,
//   uSpeed     — vertical scroll rate (default 1.6)
//   uIntensity — overall brightness multiplier (default 1.0)
//   uTaper     — silhouette pinch strength, 0 = rectangle, 1.5 = candle
//
// WebGL2 / three r169. Uses `varying` (not `in/out`).

export const flameVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const flameFragment = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3  uColorBase;
uniform vec3  uColorMid;
uniform vec3  uColorTip;
uniform float uSpeed;
uniform float uIntensity;
uniform float uTaper;

varying vec2 vUv;

// --- hash / noise ---------------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  // 5 octaves — flame needs detail at the tips
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p *= 2.03;
    p += vec2(11.7, 3.1); // decorrelate octaves
    amp *= 0.5;
  }
  return v;
}

// 3-stop palette sampled by t in [0,1]
vec3 flamePalette(float t) {
  t = clamp(t, 0.0, 1.0);
  // soft midpoint at ~0.55 so the orange body dominates
  vec3 lo = mix(uColorBase, uColorMid, smoothstep(0.0, 0.55, t));
  vec3 hi = mix(lo,         uColorTip, smoothstep(0.55, 1.0, t));
  return hi;
}

void main() {
  vec2 uv = vUv;

  // Horizontal wobble: makes the column sway like a lazy candle.
  float sway = sin(uv.y * 4.0 + uTime * 1.7) * 0.04 * (1.0 - uv.y);
  uv.x += sway;

  // Upward-scrolling fbm. Two layers @ different scales for variety.
  float t = uTime * uSpeed;
  vec2 q1 = vec2(uv.x * 2.5, uv.y * 1.8 - t * 0.9);
  vec2 q2 = vec2(uv.x * 5.0, uv.y * 3.6 - t * 1.6);
  float n1 = fbm(q1);
  float n2 = fbm(q2);
  float n  = mix(n1, n2, 0.45);

  // Tip stretch: pull noise upward more aggressively near the top so
  // bands elongate as they rise (gas dispersion).
  float stretch = mix(1.0, 1.6, uv.y);
  float bands = fbm(vec2(uv.x * 3.0, uv.y * 2.0 * stretch - t * 1.2));

  // Body mask: parabolic across X, fades toward top.
  // 1 - (2x-1)^2  → 1 at center, 0 at edges
  float xMask = 1.0 - pow(2.0 * uv.x - 1.0, 2.0);
  // Vertical envelope: full at base, narrow at top — uTaper sharpens.
  float yEnv  = pow(1.0 - uv.y, mix(0.85, 1.8, clamp(uTaper, 0.0, 2.0)));
  // Combined silhouette mask, biased by noise so the edge is ragged.
  float silhouette = xMask * yEnv;
  // Noise eats into the silhouette → torn flame edges
  float edge = silhouette - (1.0 - n) * 0.55;
  edge = smoothstep(0.0, 0.35, edge);

  // Heat field: 1 at base hot core, drops upward. fbm modulates it so
  // hot-spots wander up the column instead of a clean gradient.
  float heat = clamp(edge + n * 0.4 - uv.y * 0.55, 0.0, 1.0);
  // Remap so the palette banding is organic (sampled by heat, not uv.y)
  float band = heat;
  // Quantize lightly for a paint-y stepped look (Cuphead-ish)
  band = floor(band * 5.0 + bands * 0.5) / 5.0 + (heat - floor(heat * 5.0) / 5.0) * 0.4;
  band = clamp(band, 0.0, 1.0);

  vec3 col = flamePalette(band);

  // Time-jittered hot-spots: small bright cores that flicker inside body.
  // Sample a coarse cell grid, animate per-cell brightness with hash.
  vec2 cellP = vec2(uv.x * 6.0, uv.y * 8.0 - t * 1.1);
  vec2 cellI = floor(cellP);
  vec2 cellF = fract(cellP) - 0.5;
  float cellHash = hash21(cellI);
  float flick = sin(uTime * (8.0 + cellHash * 14.0) + cellHash * 30.0) * 0.5 + 0.5;
  float dot2  = exp(-dot(cellF, cellF) * 18.0);
  float spot  = dot2 * flick * step(0.72, cellHash) * (1.0 - uv.y * 0.7);
  col += uColorTip * spot * 1.4;

  // Brightness for bloom edge / additive falloff.
  float brightness = max(max(col.r, col.g), col.b);
  // Punch-up via gamma curve — sharpens core, fades wings.
  float bloom = pow(brightness, 1.6);

  // Alpha: silhouette × heat; additive blending takes brightness from here.
  float alpha = edge * (0.35 + heat * 0.85);
  alpha *= uIntensity;

  // Pre-multiply color by bloom for additive presentation, then scale.
  col *= bloom * uIntensity;

  // Kill stray fringe pixels
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

// Uniforms factory — no THREE import; caller passes the namespace if it
// wants Color objects, or hex numbers work because three.Color accepts hex.
export function flameUniforms(opts = {}) {
  // Resolve THREE either from opts.THREE or global (museum loads it globally).
  const THREE = opts.THREE || (typeof window !== 'undefined' && window.THREE);
  if (!THREE) throw new Error('flameUniforms: pass opts.THREE or expose window.THREE');
  return {
    uTime:      { value: 0 },
    uColorBase: { value: new THREE.Color(opts.base ?? 0x4a0a00) },
    uColorMid:  { value: new THREE.Color(opts.mid  ?? 0xff7a18) },
    uColorTip:  { value: new THREE.Color(opts.tip  ?? 0xffe890) },
    uSpeed:     { value: opts.speed     ?? 1.6 },
    uIntensity: { value: opts.intensity ?? 1.0 },
    uTaper:     { value: opts.taper     ?? 1.0 },
  };
}
