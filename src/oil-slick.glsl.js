// oil-slick.glsl.js
// ----------------------------------------------------------------------------
// Iridescent oil slick / soap film. Rainbow sheen on dark water.
// Spider-Verse / Trippy aesthetic: saturated drifting bands of color whose
// position depends on view angle + animated film thickness.
//
// Technique summary:
//   * Thin-film interference (approximated, not physically correct): film
//     thickness varies across the surface via 2-octave fbm + slow scroll.
//     Reflectance for each wavelength is cos(thickness * NdotV * 2pi * k_lambda).
//     We approximate three wavelengths (R/G/B ~ 650/550/450 nm) by three phase
//     offsets — cheap rainbow that responds to both view angle and thickness.
//   * Sharp banding: smoothstep + pow on the cos waves to keep colors saturated
//     instead of a washed pastel average.
//   * Dark base shows through where the film is thin / reflectance dips low.
//   * Animated thickness so the bands slowly drift like real soap film.
//   * Fallback fake mode: hsv2rgb of (thickness*freq + time) — kept as a
//     comment block at the bottom for reference.
//
// Recommended geometry (museum):
//   new THREE.SphereGeometry(1.4, 64, 32)   // best — full view-angle sweep
// Alternative:
//   new THREE.PlaneGeometry(5, 5, 8, 8)     // flat puddle, top-down
// Material flags:
//   { side: THREE.FrontSide }               // opaque by default
// ----------------------------------------------------------------------------

export const oilSlickVertex = /* glsl */`
  varying vec3 vPosW;
  varying vec3 vPosL;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vPosL = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW  = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const oilSlickFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uBase;
  uniform float uThicknessScale;
  uniform float uFlowSpeed;
  uniform float uSaturation;
  uniform float uMix;

  varying vec3 vPosW;
  varying vec3 vPosL;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec2 vUv;

  // ---- hash / noise helpers --------------------------------------------------
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise2(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Two-octave fbm — enough to break up the pattern without melting the GPU.
  float fbm2(vec2 p){
    float v = 0.0;
    v += 0.60 * vnoise2(p);
    v += 0.30 * vnoise2(p * 2.17 + 5.3);
    return v;
  }

  // ---- thin-film color -------------------------------------------------------
  // Sample three "wavelengths" (R/G/B) of the cos interference pattern. Each
  // channel gets its own frequency multiplier — that's what produces the
  // characteristic rainbow banding instead of monochrome rings.
  //
  // The three values 0.65 / 0.55 / 0.45 are normalized wavelength inverses
  // for ~650 nm red, ~550 nm green, ~450 nm blue. Sharpened with pow() and
  // smoothstep() to keep colors saturated (Spider-Verse, not pastel).
  vec3 thinFilm(float thickness, float ndv){
    // Optical path length ~ thickness * NdotV (cheap normal-incidence approx).
    float opd = thickness * (0.25 + 0.75 * ndv);
    const float TWO_PI = 6.28318530718;

    // Per-channel inverse-wavelength (smaller = lower freq = longer wavelength).
    float kR = 1.0 / 0.65;
    float kG = 1.0 / 0.55;
    float kB = 1.0 / 0.45;

    vec3 wave = vec3(
      cos(opd * TWO_PI * kR),
      cos(opd * TWO_PI * kG),
      cos(opd * TWO_PI * kB)
    );
    // Remap to [0,1] then sharpen — pow on the band peak gives the saturated
    // neon look. Without this it averages out to grey-pink mush.
    wave = 0.5 + 0.5 * wave;
    wave = smoothstep(vec3(0.15), vec3(0.95), wave);
    wave = pow(wave, vec3(0.85));

    return wave;
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);
    // Two-sided safety so a flipped plane / back of sphere still reads.
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    // -- animated thickness field -----------------------------------------
    // Use local position scaled — gives a noise field stuck to the object so
    // the bands flow over the geometry rather than swimming in screen space.
    vec2 uv = vPosL.xy * 0.8 + vPosL.xz * 0.6;
    vec2 flow = vec2(uTime * uFlowSpeed, uTime * uFlowSpeed * 0.73);

    float n1 = fbm2(uv * 1.0 + flow);
    float n2 = fbm2(uv * 2.7 - flow * 1.3 + 11.2);
    float variance = mix(n1, n2, 0.45);

    // Base thickness modulated by view angle so tilting the surface shifts
    // the whole rainbow — the signature oil-slick behavior.
    float thickness = uThicknessScale * (0.35 + variance) + (1.0 - ndv) * 2.5;

    // -- interference colors ----------------------------------------------
    vec3 irid = thinFilm(thickness, ndv);

    // Pump saturation. Mix toward grayscale negative for desaturation control.
    float lum = dot(irid, vec3(0.299, 0.587, 0.114));
    irid = mix(vec3(lum), irid, uSaturation);

    // -- thin-film mask: dark base shows through where film is "thin" -----
    // Where the noise field is at its lowest values, drop the iridescence so
    // the dark base reads as bare water under the slick.
    float filmMask = smoothstep(0.05, 0.55, variance);

    // Fresnel-style edge boost: at glancing angles the slick brightens.
    float edge = pow(1.0 - ndv, 2.0);
    irid *= (1.0 + edge * 0.6);

    // -- compose ----------------------------------------------------------
    vec3 col = mix(uBase, irid, uMix * filmMask);

    // Tiny base sparkle highlight so the dark areas aren't dead flat.
    col += uBase * 0.15;

    gl_FragColor = vec4(col, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }

  // ---- Reference: simpler hsv2rgb fallback ----------------------------------
  // vec3 hsv2rgb(vec3 c){
  //   vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  //   vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  //   return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  // }
  // // then: hsv2rgb(vec3(fract(thickness * 0.15 + uTime * 0.1), 1.0, 0.9))
`;

export function oilSlickUniforms(opts = {}) {
  const THREE = (typeof window !== 'undefined' && window.THREE) || globalThis.THREE;
  return {
    uTime:           { value: 0 },
    uBase:           { value: new THREE.Color(opts.base ?? 0x080a14) },
    uThicknessScale: { value: opts.thicknessScale ?? 8.0 },
    uFlowSpeed:      { value: opts.flowSpeed ?? 0.1 },
    uSaturation:     { value: opts.saturation ?? 1.0 },
    uMix:            { value: opts.mix ?? 0.85 },
  };
}
