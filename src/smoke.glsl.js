// smoke.glsl.js — stylized volumetric smoke / steam billboard.
//
// Look: soft rising column of grey smoke billowing from a base — campfire
// chimney vibe. 3-stop monochrome palette (shadow interior → body mid →
// bright wispy edge). Three parallax fbm layers at different scales and
// scroll rates fake volumetric depth without raymarching. Density taper
// keeps the silhouette planted at the base, fat in the middle, dissipating
// at the top. Occasional puff bursts gated by a 0.5Hz hash kick the bottom
// when a new chunk emerges.
//
// Recommended geometry: PlaneGeometry(2.5, 4) vertical billboard. Pivot at
// base (translate y +2 after creation, or set mesh.position.y = base + 2).
// Material flags: { transparent:true, depthWrite:false,
//                   side: THREE.DoubleSide, blending: THREE.NormalBlending }
// NOTE: NormalBlending (not additive) — smoke darkens what's behind it.
// Background can be anything; works best against bright sky / firelight.
//
// Uniforms:
//   uTime, uShadow, uBody, uHighlight,
//   uSpeed   — vertical scroll rate (default 0.6, slower than flame)
//   uDensity — opacity multiplier (default 1.0, 0..2 useful range)
//   uTaper   — silhouette pinch, higher = narrower column (default 1.2)
//
// WebGL2 / three r169. Uses `varying` (not `in/out`).

export const smokeVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const smokeFragment = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3  uShadow;
uniform vec3  uBody;
uniform vec3  uHighlight;
uniform float uSpeed;
uniform float uDensity;
uniform float uTaper;

varying vec2 vUv;

// --- hash / noise ---------------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash11(float n) {
  return fract(sin(n * 91.3458) * 47453.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave fbm — smoke needs soft billowy mass.
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p *= 2.07;
    p += vec2(7.3, 13.7); // decorrelate octaves
    amp *= 0.5;
  }
  return v;
}

// 3-stop monochrome palette, t in [0,1] — shadow → body → highlight.
vec3 smokePalette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 lo = mix(uShadow, uBody,      smoothstep(0.0, 0.55, t));
  vec3 hi = mix(lo,      uHighlight, smoothstep(0.55, 1.0, t));
  return hi;
}

void main() {
  vec2 uv = vUv;
  float t = uTime * uSpeed;

  // Gentle lateral sway — column drifts side-to-side as it rises.
  float sway = sin(uv.y * 2.3 + uTime * 0.4) * 0.05 * uv.y;
  uv.x += sway;

  // Three parallax layers — different scales + scroll rates fake volume.
  // Layer 1: big slow background mass.
  vec2 q1 = vec2(uv.x * 1.4, uv.y * 1.1 - t * 0.6);
  float n1 = fbm(q1);
  // Layer 2: mid-frequency body detail, scrolls faster.
  vec2 q2 = vec2(uv.x * 2.6 + 4.2, uv.y * 2.2 - t * 1.0);
  float n2 = fbm(q2);
  // Layer 3: high-frequency wisps near the surface, fastest.
  vec2 q3 = vec2(uv.x * 4.8 - 1.7, uv.y * 4.0 - t * 1.5);
  float n3 = fbm(q3);

  // Weighted composite — background dominates, wisps add texture.
  float n = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;

  // Vertical density falloff: low at bottom (just emerged), peak in the
  // middle, dissipating at the top.
  float rise   = smoothstep(0.0, 0.18, uv.y);        // ramp in from base
  float fadeUp = 1.0 - smoothstep(0.7, 1.0, uv.y);   // dissipate at top
  float yEnv   = rise * fadeUp;

  // Side-edge fade for tapered column. uTaper sharpens the pinch.
  float xDist = abs(2.0 * uv.x - 1.0);
  float xEnv  = 1.0 - smoothstep(0.6 / max(uTaper, 0.3), 1.0, xDist);

  // Optional puff bursts: every ~2s, kick the bottom intensity if the
  // hashed time-cell rolls above the threshold.
  float bucket = floor(uTime * 0.5);
  float puff   = step(0.8, hash11(bucket));
  float puffEnv = puff * (1.0 - smoothstep(0.0, 0.35, uv.y))
                       * (1.0 - xDist) * 0.45;

  // Raw density: noise carved by envelopes, plus puff kick at the base.
  float density = (n * 1.15 - 0.35) * yEnv * xEnv + puffEnv;
  density = clamp(density * uDensity, 0.0, 1.0);

  // Gradient sample for palette: dark interior → mid → bright wisps.
  // We want bright edges (low density, just on the silhouette boundary)
  // and dark interiors (high density). Invert density for color sampling
  // but bias mid-density to body color.
  float edgeGlow = smoothstep(0.05, 0.35, density) *
                   (1.0 - smoothstep(0.35, 0.75, density));
  float core     = smoothstep(0.45, 0.9, density);
  // t=0 shadow (deep interior), t=0.5 body (most of mass), t=1 highlight (edges)
  float paletteT = 0.5 + edgeGlow * 0.5 - core * 0.5;
  // Add subtle vertical brightening near the top — sunlight catches wisps.
  paletteT += smoothstep(0.4, 0.95, uv.y) * 0.15;

  vec3 col = smokePalette(paletteT);

  // Alpha: silhouette density. Soft cutoff so edges feather.
  float alpha = smoothstep(0.0, 0.25, density);
  alpha *= 0.92;

  if (alpha < 0.01) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

// Uniforms factory — resolves THREE from globalThis fallback.
export function smokeUniforms(opts = {}) {
  const THREE = opts.THREE || (typeof globalThis !== 'undefined' && globalThis.THREE);
  if (!THREE) throw new Error('smokeUniforms: expose globalThis.THREE or pass opts.THREE');
  return {
    uTime:      { value: 0 },
    uShadow:    { value: new THREE.Color(opts.shadow    ?? 0x222226) },
    uBody:      { value: new THREE.Color(opts.body      ?? 0x9094a0) },
    uHighlight: { value: new THREE.Color(opts.highlight ?? 0xe6e8ed) },
    uSpeed:     { value: opts.speed   ?? 0.6 },
    uDensity:   { value: opts.density ?? 1.0 },
    uTaper:     { value: opts.taper   ?? 1.2 },
  };
}
