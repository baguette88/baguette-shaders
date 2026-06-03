// lightning.glsl.js — branching electric bolt billboard.
// SDF distance from each fragment to a noise-perturbed centerline (+ branch lines),
// sharp white-hot core via pow(1-d, 4), soft halo via exp(-d*falloff), and strike
// gating that retriggers every 0.5–2s by hashing floor(time * strikeRate).
// Recommended geometry: PlaneGeometry(2, 6), camera-facing billboard (manual lookAt
// or sprite-like update). Background should be dark for the additive bloom to read.
// Recommended material flags: { transparent:true, depthWrite:false,
//   blending: THREE.AdditiveBlending, side: THREE.DoubleSide }.
// Tick uTime once per frame. ESM: vertex + fragment GLSL strings + uniforms factory.
// No THREE import here; pass `THREE` into lightningUniforms via closure or use the
// helper signature below which expects the caller to provide THREE.Color.

export const lightningVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lightningFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uCore;
  uniform vec3  uGlow;
  uniform float uBranches;   // number of offset sample lines (1..5)
  uniform float uJitter;     // horizontal jitter amplitude in UV space (~0.0..0.4)
  uniform float uStrikeRate; // strikes per second (~0.5..4.0)
  uniform float uIntensity;  // overall multiplier (~0.5..3.0)

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
  // 1D value noise along y (with a seed for branch variation)
  float vnoise(float y, float seed) {
    float i = floor(y);
    float f = fract(y);
    float a = hash21(vec2(i,     seed));
    float b = hash21(vec2(i + 1.0, seed));
    f = f * f * (3.0 - 2.0 * f);
    return mix(a, b, f);
  }
  // fbm of 1D noise — gives organic jagged centerline
  float fbm1(float y, float seed) {
    float v = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      v += amp * (vnoise(y * freq, seed + float(i) * 7.13) - 0.5);
      freq *= 2.07;
      amp  *= 0.55;
    }
    return v; // roughly [-0.5, 0.5]
  }

  // Centerline x position at a given y (UV-y in [0,1]), per-branch seed.
  // Branches diverge near the top, drift apart over time.
  float centerline(float y, float seed, float t) {
    // Slow temporal drift so the bolt "writhes" between strikes.
    float ty = y * 8.0 + t * 1.7 + seed * 11.0;
    float n  = fbm1(ty, seed);
    // Branch base offset: spread fans out from y=1 (top) to y=0 (bottom).
    float spread = (1.0 - y) * 0.35;
    float baseOffset = (seed - 0.5) * spread * 1.8;
    return 0.5 + baseOffset + n * uJitter;
  }

  // Distance from current fragment.x to nearest centerline among N branches.
  float boltDistance(vec2 uv, float t, out float branchFade) {
    float minD = 10.0;
    float fade = 0.0;
    int N = int(clamp(uBranches, 1.0, 5.0));
    for (int i = 0; i < 5; i++) {
      if (i >= N) break;
      float seed = float(i) * 1.731 + 0.137;
      // Main bolt (i==0) reaches full length. Branches start partway down and
      // fade out toward bottom — gives the forking-then-dying look.
      float branchStart = (i == 0) ? 0.0 : 0.15 + hash11(seed) * 0.45;
      float branchEnd   = (i == 0) ? 1.0 : branchStart + 0.25 + hash11(seed + 5.0) * 0.45;
      // Only count this branch if the current y is inside its run.
      float inRun = step(branchStart, uv.y) * step(uv.y, branchEnd);
      float cx = centerline(uv.y, seed, t);
      float d = abs(uv.x - cx);
      // Push out-of-run branches far away so they don't contribute.
      d = mix(10.0, d, inRun);
      if (d < minD) {
        minD = d;
        // Fade branches near their endpoints so they taper off cleanly.
        float runLen = max(branchEnd - branchStart, 0.001);
        float local  = clamp((uv.y - branchStart) / runLen, 0.0, 1.0);
        float taper  = (i == 0) ? 1.0 : smoothstep(0.0, 0.2, local) * smoothstep(1.0, 0.7, local);
        fade = taper;
      }
    }
    branchFade = fade;
    return minD;
  }

  void main() {
    vec2 uv = vUv;

    // --- strike gating: pick a discrete "strike id" each 1/uStrikeRate seconds.
    float strikeId   = floor(uTime * uStrikeRate);
    float strikeRand = hash11(strikeId);
    // 30% of slots are silent — gives the irregular flash cadence.
    float strikeOn   = step(0.30, strikeRand);
    // Fast envelope inside the slot: bright pop, quick decay.
    float slotT = fract(uTime * uStrikeRate);
    float envelope = exp(-slotT * 6.0) * (0.6 + 0.4 * strikeRand);
    // Sub-flicker: jitter inside the strike to fake re-strikes / sub-bolts.
    float flicker = 0.65 + 0.35 * step(0.5, hash11(strikeId * 7.0 + floor(slotT * 8.0)));
    float strike  = strikeOn * envelope * flicker;

    // Each strike re-seeds the centerline so every flash takes a new path.
    float pathTime = uTime + strikeId * 13.37;

    // --- distance to nearest branch
    float branchFade;
    float d = boltDistance(uv, pathTime, branchFade);

    // --- core (sharp white-hot) + halo (soft additive bloom)
    float coreWidth = 0.012;
    float core = pow(max(1.0 - d / coreWidth, 0.0), 4.0);
    float halo = exp(-d * 28.0) * 0.55 + exp(-d * 9.0) * 0.18;

    // Vertical taper so the bolt fades at top/bottom edges of the plane.
    float vTaper = smoothstep(0.0, 0.06, uv.y) * smoothstep(1.0, 0.94, uv.y);

    core *= branchFade * vTaper;
    halo *= branchFade * vTaper;

    // --- composite color
    vec3 col = uCore * core + uGlow * halo;
    float alpha = clamp(core + halo, 0.0, 1.0);

    // Apply strike envelope.
    col   *= strike * uIntensity;
    alpha *= strike;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Uniforms factory. Caller passes THREE so we don't import it here.
// Usage: lightningUniforms(THREE, { core: 0xffffff, glow: 0x6ab8ff, ... })
// Back-compat: also accepts (opts) if THREE is globally available as window.THREE.
export function lightningUniforms(THREE, opts = {}) {
  if (THREE && !THREE.Color && typeof THREE === 'object') {
    // Called as lightningUniforms(opts) — shift args.
    opts = THREE;
    THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  }
  const Color = (THREE && THREE.Color) ? THREE.Color : function (hex) { this.value = hex; };
  return {
    uTime:       { value: 0 },
    uCore:       { value: new Color(opts.core ?? 0xffffff) },
    uGlow:       { value: new Color(opts.glow ?? 0x6ab8ff) },
    uBranches:   { value: opts.branches ?? 3.0 },
    uJitter:     { value: opts.jitter ?? 0.15 },
    uStrikeRate: { value: opts.strikeRate ?? 2.0 },
    uIntensity:  { value: opts.intensity ?? 1.0 },
  };
}
