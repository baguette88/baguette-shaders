// plasma-orb.glsl.js — Tesla coil / fusion core energy orb.
// Domain-warped 3D fbm sampled on the world-space normal (seam-free spherical
// sampling: no atan/asin wrap). High-contrast threshold turns the fbm field
// into crisp crackling tendrils rather than smeared blobs. Two layers:
//   - slow base swirl  (low freq, big rolling currents through the core)
//   - fast filament    (high freq, twitching surface lightning)
// Fresnel rim boosts the tendrils at glancing angles so the silhouette pops
// against a dark background. Hot core is a deep saturated additive bloom
// modulated by the inverse fresnel (brightest looking straight through).
// Sparks are stochastic pinpoints gated by floor(uTime * 4) — flicker on/off
// 4x per second at random positions on the sphere.
//
// Recommended geometry: SphereGeometry(1.4, 64, 32).
// Recommended material flags:
//   { transparent: true, depthWrite: false, side: THREE.DoubleSide,
//     blending: THREE.AdditiveBlending }
// Tick uTime once per frame. Pass a THREE.Color factory to plasmaOrbUniforms;
// to stay three-import-free this module expects the caller to inject Color.
//
// Museum tip: place on a slowly rotating mount (~0.2 rad/s on Y) against a
// near-black background; add a faint cyan point light *inside* the sphere
// (radius 0.1) so any non-additive scene objects nearby pick up a subtle
// reactor glow. A second, slightly larger (1.55) wireframe pass with low
// opacity sells the "containment field" Vortigaunt vibe.

export const plasmaOrbVertex = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos    = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir     = normalize(cameraPosition - wp.xyz);
    gl_Position  = projectionMatrix * viewMatrix * wp;
  }
`;

export const plasmaOrbFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uCore;
  uniform vec3  uTendril;
  uniform vec3  uRim;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uTendrilDensity;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  // --- hash / noise -------------------------------------------------------
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // 3D value noise
  float vnoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  // 4-octave fbm in 3D
  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise3(p);
      p = p * 2.02 + vec3(17.3, 11.7, 31.1);
      a *= 0.5;
    }
    return v;
  }

  // Domain-warped fbm (IQ): fbm(p + fbm(p + fbm(p)))
  float warpedFbm(vec3 p, float t) {
    vec3 q = vec3(
      fbm3(p + vec3(0.0, 0.0, t)),
      fbm3(p + vec3(5.2, 1.3, -t)),
      fbm3(p + vec3(-3.1, 4.7, t * 0.5))
    );
    vec3 r = vec3(
      fbm3(p + 4.0 * q + vec3(1.7, 9.2, t * 0.3)),
      fbm3(p + 4.0 * q + vec3(8.3, 2.8, -t * 0.4)),
      fbm3(p + 4.0 * q + vec3(-2.6, 6.1, t * 0.6))
    );
    return fbm3(p + 4.0 * r);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    float fres = 1.0 - max(dot(N, V), 0.0);
    float rimSoft = pow(fres, 1.5);
    float rimSharp = pow(fres, 4.0);

    float t = uTime * uSpeed;

    // --- base swirl: slow, large currents through the core ---------------
    vec3 pBase = N * (uTendrilDensity * 0.5) + vec3(0.0, 0.0, t * 0.25);
    float base = warpedFbm(pBase, t * 0.4);

    // --- filament crackle: fast, fine surface lightning ------------------
    vec3 pFil = N * uTendrilDensity * 1.6 + vec3(t * 0.8, -t * 0.5, t * 0.6);
    float fil = warpedFbm(pFil, t * 1.7);

    // High-contrast tendrils — crisp lines, not blobs
    float tendrilA = smoothstep(0.45, 0.55, base);
    float tendrilB = smoothstep(0.48, 0.56, fil);
    float tendrils = max(tendrilA * 0.6, tendrilB);

    // Edge boost: tendrils brighter where surface is perpendicular to view
    tendrils *= 0.55 + 1.45 * rimSoft;

    // --- hot core glow through transparency ------------------------------
    // Brightest looking straight through (low fresnel), modulated by base
    // field so the core "breathes" with the swirl underneath.
    float coreView = pow(1.0 - fres, 2.2);
    float corePulse = 0.75 + 0.25 * sin(uTime * 2.0 + base * 6.28);
    float core = coreView * (0.55 + 0.45 * base) * corePulse;

    // --- hue shift / pulse on tendril color ------------------------------
    float hueT = 0.5 + 0.5 * sin(uTime * 0.8);
    vec3 tendrilCol = mix(uTendril, uCore, 0.35 * hueT) * (1.4 + 0.6 * tendrilB);

    // --- stochastic sparks: bright pinpoints, 4 Hz reseed ----------------
    float sparkSeed = floor(uTime * 4.0);
    vec3  sparkP    = N * 18.0 + vec3(sparkSeed * 7.13, sparkSeed * 3.71, sparkSeed * 11.9);
    float sparkHash = hash13(floor(sparkP));
    float spark     = step(0.985, sparkHash);
    // Sparks live longer near the rim, brief flash everywhere
    float sparkLife = 0.5 + 0.5 * sin(uTime * 25.0 + sparkHash * 50.0);
    spark *= sparkLife * (0.5 + rimSoft);

    // --- compose ---------------------------------------------------------
    vec3 col = vec3(0.0);
    col += uCore   * core   * 1.2;
    col += tendrilCol * tendrils;
    col += uRim    * rimSharp * 1.4;
    col += vec3(1.0, 1.0, 1.1) * spark * 3.0;

    // Soft baseline so even quiet regions glow faintly through
    col += uCore * 0.05 * (1.0 - fres);

    col *= uIntensity;

    // Additive blending: alpha is a soft envelope (don't gate by it hard
    // or sparks/tendrils at edges will pop). Keep mostly opaque-feeling
    // contribution but fade slightly behind for the back-face pass.
    float alpha = clamp(0.35 + 0.65 * (tendrils + core + rimSharp + spark), 0.0, 1.0);

    gl_FragColor = vec4(col, alpha);
  }
`;

// Uniforms factory. Pass `THREE` (or any object exposing Color) so this
// module stays import-free.
//   plasmaOrbUniforms(THREE, { core: 0x6effff, ... })
// or just call with a Color factory:
//   plasmaOrbUniforms({ Color }, { ... })
export function plasmaOrbUniforms(THREE, opts = {}) {
  // Allow either (THREE, opts) or (opts) if THREE is globally available.
  if (THREE && THREE.core !== undefined && !THREE.Color) {
    opts = THREE;
    THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  }
  const Color = THREE && THREE.Color ? THREE.Color : null;
  const mk = (hex) => Color ? new Color(hex) : { isColor: true, hex };
  return {
    uTime:           { value: 0 },
    uCore:           { value: mk(opts.core    ?? 0x6effff) },
    uTendril:        { value: mk(opts.tendril ?? 0xffffff) },
    uRim:            { value: mk(opts.rim     ?? 0x4080ff) },
    uSpeed:          { value: opts.speed     ?? 1.0 },
    uIntensity:      { value: opts.intensity ?? 1.2 },
    uTendrilDensity: { value: opts.density   ?? 4.0 },
  };
}
