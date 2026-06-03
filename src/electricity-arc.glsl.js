// electricity-arc.glsl.js — continuous crackling arc between two points.
// Unlike lightning.glsl.js (vertical, gated strikes), this is a Tesla-coil /
// Jacob's-ladder / Force-lightning effect: an *always-on* horizontal discharge
// whose centerline jitters every frame across multiple parallel filaments.
//
// Technique:
//   - uv.x runs along the arc, uv.y is perpendicular.
//   - For each filament i: centerline y(x) = base_offset_i + noise(x*8, t*15)*uJitter.
//   - Distance from current uv.y to each filament's centerline → 1D SDF.
//   - Hot core via pow(1-d/coreW, 6) (white), halo via exp(-d*8) (bluish purple).
//   - Endpoint mask: arc only renders for uv.x in [0.05, 0.95] with soft fade.
//   - Sparks: step(0.97, hash(...)) bright points sprinkled along the path.
//
// Recommended geometry: PlaneGeometry(6, 1.5), horizontal billboard.
// Recommended material flags: { transparent:true, depthWrite:false,
//   blending: THREE.AdditiveBlending, side: THREE.DoubleSide }.
// Tick uTime once per frame. Resolves THREE via globalThis.THREE if not passed.

export const electricityArcVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const electricityArcFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uCore;       // white-hot core color
  uniform vec3  uHalo;       // bluish-purple bloom color
  uniform float uFilaments;  // number of parallel filaments (1..5)
  uniform float uJitter;     // perpendicular jitter amplitude (~0.05..0.4)
  uniform float uChaos;      // crackle frequency multiplier (~0.5..2.0)
  uniform float uIntensity;  // overall brightness multiplier

  varying vec2 vUv;

  // --- hash / noise -------------------------------------------------------
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // 2D value noise — used for centerline jitter that changes every frame.
  float vnoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // fbm of 2D noise — organic jagged crackle.
  float fbm2(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * (vnoise2(p) - 0.5);
      p *= 2.07;
      amp *= 0.55;
    }
    return v; // ~[-0.5, 0.5]
  }

  // Centerline y position at uv.x for filament seed.
  // Noise input includes uTime so every frame re-rolls the path → continuous crackle.
  float centerlineY(float x, float seed, float t) {
    // Base offset spreads filaments apart vertically.
    float baseOffset = (seed - 0.5) * 0.12;
    // Primary crackle: high-freq noise in x, very high-freq in t.
    float n1 = fbm2(vec2(x * 8.0 * uChaos + seed * 17.0, t * 15.0 + seed * 23.0));
    // Secondary slow drift so the whole arc snakes lazily.
    float n2 = fbm2(vec2(x * 2.0 + seed * 3.1, t * 2.0 + seed * 7.0)) * 0.4;
    return 0.5 + baseOffset + (n1 + n2) * uJitter;
  }

  void main() {
    vec2 uv = vUv;

    // --- endpoint mask: arc only between [0.05, 0.95] with soft fade at ends.
    float endMask = smoothstep(0.05, 0.12, uv.x) * smoothstep(0.95, 0.88, uv.x);

    // --- accumulate min distance across N filaments + a per-filament fade.
    float minD = 10.0;
    float halo = 0.0;
    float core = 0.0;
    int N = int(clamp(uFilaments, 1.0, 5.0));
    for (int i = 0; i < 5; i++) {
      if (i >= N) break;
      float seed = float(i) * 1.731 + 0.137;
      float cy = centerlineY(uv.x, seed, uTime);
      float d  = abs(uv.y - cy);

      // Per-filament intensity flicker — each strand pulses independently.
      float pulse = 0.55 + 0.45 * vnoise2(vec2(seed * 9.0, uTime * 8.0 + seed));

      // Core: very thin white-hot center.
      float coreW = 0.018;
      float c = pow(max(1.0 - d / coreW, 0.0), 6.0) * pulse;

      // Halo: softer exp falloff for the bluish bloom.
      float h = exp(-d * 8.0) * 0.35 * pulse
              + exp(-d * 24.0) * 0.25 * pulse;

      core += c;
      halo += h;
      if (d < minD) minD = d;
    }

    // --- sparks: random bright pixels near the arc, retriggered every frame.
    // Quantize time so sparks blink rather than smear, but fast enough to feel live.
    float sparkT = floor(uTime * 30.0);
    float sparkH = hash21(vec2(floor(uv.x * 80.0) + sparkT * 1.7,
                               floor(uv.y * 40.0) + sparkT * 3.1));
    // Confine sparks to within ~0.08 of any filament centerline.
    float nearArc = step(minD, 0.08);
    float spark = step(0.97, sparkH) * nearArc
                * (1.0 - smoothstep(0.0, 0.08, minD));

    // --- composite color
    vec3 col = uCore * (core + spark * 1.5) + uHalo * halo;
    float alpha = clamp(core + halo + spark, 0.0, 1.0);

    // Apply endpoint mask + intensity.
    col   *= endMask * uIntensity;
    alpha *= endMask;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Uniforms factory. Resolves THREE from globalThis if not passed.
// Usage: electricityArcUniforms({ core: 0xffffff, halo: 0x9070ff, ... })
//    or: electricityArcUniforms(THREE, { ... })
export function electricityArcUniforms(THREE, opts) {
  // Arg-shift: called as electricityArcUniforms(opts).
  if (THREE && !THREE.Color && typeof THREE === 'object') {
    opts = THREE;
    THREE = null;
  }
  if (!THREE) {
    THREE = (typeof globalThis !== 'undefined' && globalThis.THREE)
      ? globalThis.THREE
      : (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  }
  opts = opts || {};
  const Color = (THREE && THREE.Color) ? THREE.Color : function (hex) { this.value = hex; };
  return {
    uTime:       { value: 0 },
    uCore:       { value: new Color(opts.core ?? 0xffffff) },
    uHalo:       { value: new Color(opts.halo ?? 0x9070ff) },
    uFilaments:  { value: opts.filaments ?? 4.0 },
    uJitter:     { value: opts.jitter ?? 0.18 },
    uChaos:      { value: opts.chaos ?? 1.0 },
    uIntensity:  { value: opts.intensity ?? 1.2 },
  };
}
