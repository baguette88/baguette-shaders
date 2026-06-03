// magic-circle.glsl.js
// ------------------------------------------------------------------
// Rotating arcane summoning circle for a horizontal disc.
//
// Look: Honkai Star Rail / JJK / Doctor Strange style glowing runic
// disc. Concentric rings of glyphs rotating at different speeds with a
// central star polygon (pentagram / hexagram) and a pulsing core.
//
// Geometry: THREE.CircleGeometry(2, 64), rotation.x = -Math.PI / 2.
// Material flags: transparent:true, depthWrite:false,
//                 blending: THREE.AdditiveBlending, side: THREE.DoubleSide.
//
// All layers sample in polar coords from the disc centre:
//     vec2 p = vUv - 0.5;
//     float r = length(p) * 2.0;        // 0..1 across radius
//     float theta = atan(p.y, p.x);     // -pi..pi
// Each layer adds `uTime * speed` to theta for rotation.
//
// No three import; consumer constructs THREE.Color in the uniforms factory.
// ------------------------------------------------------------------

export const magicCircleVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const magicCircleFragment = /* glsl */`
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uAccent;
  uniform float uRuneCount;
  uniform float uShape;     // 0 = none, 3 = triangle, 5 = pentagram, 6 = hexagram
  uniform float uOpacity;

  #define PI  3.14159265359
  #define TAU 6.28318530718

  // ---- helpers --------------------------------------------------------------

  // Soft band: 1.0 inside [a..b] with smooth ramps of width w on each side.
  float band(float x, float a, float b, float w) {
    return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
  }

  // Thin ring centred at radius c with half-thickness t.
  float ring(float r, float c, float t) {
    return 1.0 - smoothstep(t * 0.5, t, abs(r - c));
  }

  // 2D hash for sparse glyph variation.
  float hash11(float n) {
    return fract(sin(n * 43758.5453) * 9182.917);
  }

  // Distance from point p to infinite line through origin with direction d.
  float lineDist(vec2 p, vec2 d) {
    // d is assumed unit length; signed perp distance, abs for unsigned.
    return abs(p.x * d.y - p.y * d.x);
  }

  // Star polygon SDF (approximate): min distance to any of N lines passing
  // through the centre at evenly spaced angles. With step = 2 we get a
  // pentagram-like crossing pattern for odd N (5 -> classic pentagram look,
  // 6 -> hexagram / Star of David).
  float starLines(vec2 p, float N, float angleOffset) {
    float d = 1e9;
    // Unroll-safe loop: N up to 8.
    for (int i = 0; i < 8; i++) {
      if (float(i) >= N) break;
      // For odd N (5) use step 2 to skip every other vertex -> pentagram.
      // For even N (6) use step 1 -> hexagram via two overlapped triangles
      // (we draw 6 spokes which is visually equivalent to overlaid triangles).
      float k = (mod(N, 2.0) > 0.5) ? 2.0 : 1.0;
      float a = angleOffset + float(i) * k * TAU / N;
      vec2 dir = vec2(cos(a), sin(a));
      d = min(d, lineDist(p, dir));
    }
    return d;
  }

  // Rune mask along a ring: alternating slots driven by fract(theta*count).
  // Returns 0..1. pulse adds slow per-slot fade so glyphs blink.
  float runeMask(float theta, float count, float duty, float t) {
    float a = theta * count * 0.5;       // half so each slot pairs gap+rune
    float slot = floor(a);
    float f = fract(a);
    float gate = step(duty, f);          // duty-cycled gaps
    float blink = 0.6 + 0.4 * sin(t * 1.7 + slot * 2.399);
    return gate * blink;
  }

  // ---- main -----------------------------------------------------------------

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;           // 0..1 across radius
    float theta = atan(p.y, p.x);        // -pi..pi

    // Discard outside the disc to keep alpha clean.
    if (r > 1.02) discard;

    vec3 col = vec3(0.0);

    // ---- Layer 1: outer thin ring (slow CW) ------------------------------
    float thetaOuter = theta - uTime * 0.15;   // negative = clockwise
    // Tick marks every 0.5deg-ish, modulated by a sparse hash.
    float ticks = step(0.78, fract(thetaOuter * 32.0 / PI));
    float outerRing = ring(r, 0.96, 0.012);
    float outerTicks = ring(r, 0.93, 0.025) * ticks;
    col += uAccent * (outerRing * 1.2 + outerTicks * 0.9);

    // ---- Layer 2: middle rune band (faster CCW) --------------------------
    float thetaMid = theta + uTime * 0.45;
    float midBand  = band(r, 0.74, 0.86, 0.015);
    float midRunes = runeMask(thetaMid, uRuneCount, 0.5, uTime);
    // Inner/outer thin rails framing the rune band.
    float midRailA = ring(r, 0.74, 0.008);
    float midRailB = ring(r, 0.86, 0.008);
    col += uColor  * (midBand * midRunes * 1.1);
    col += uAccent * (midRailA + midRailB) * 0.9;

    // ---- Layer 3: inner rune band (very fast CW) -------------------------
    float thetaInner = theta - uTime * 1.1;
    float innerBand  = band(r, 0.50, 0.60, 0.012);
    float innerRunes = runeMask(thetaInner, uRuneCount * 1.5, 0.55, uTime * 1.4);
    float innerRailA = ring(r, 0.50, 0.006);
    float innerRailB = ring(r, 0.60, 0.006);
    col += uAccent * (innerBand * innerRunes * 1.0);
    col += uColor  * (innerRailA + innerRailB) * 0.8;

    // ---- Layer 4: star polygon (pentagram / hexagram / triangle) ---------
    if (uShape > 2.5) {
      // Counter-rotate the star slowly opposite to the outer ring.
      float starAng = uTime * 0.25;
      float c = cos(starAng), s = sin(starAng);
      vec2 ps = mat2(c, -s, s, c) * p;
      float starR = 0.42;                // star roughly inscribed in inner ring
      // Mask the lines to the inscribed-circle radius so they don't bleed.
      float sd = starLines(ps, uShape, 0.0);
      float starLine = (1.0 - smoothstep(0.004, 0.012, sd))
                      * smoothstep(starR + 0.02, starR, length(ps));
      // Outline circle around the star.
      float starRing = ring(length(ps) * (1.0 / starR), 1.0, 0.04);
      col += uColor * starLine * 1.4;
      col += uAccent * starRing * 0.5;
    }

    // ---- Layer 5: core pulse --------------------------------------------
    float pulse = sin(uTime * 3.0) * 0.5 + 0.5;
    float core  = exp(-r * 14.0) * (0.6 + 0.7 * pulse);
    col += uColor * core * 1.8;

    // Centre "hole" so the very middle isn't a hot blob; subtle ring at r~0.06.
    float centerRing = ring(r, 0.07, 0.012);
    col += uAccent * centerRing * 0.9;

    // ---- Alpha shaping ---------------------------------------------------
    // Soft inner cut + soft outer fade.
    float innerCut = smoothstep(0.02, 0.08, r);
    float outerFade = 1.0 - smoothstep(0.94, 1.02, r);
    float a = innerCut * outerFade;

    // Brightness as alpha for additive blending (lets blacks stay invisible).
    float bright = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    a = clamp(a * (0.35 + 0.85 * bright), 0.0, 1.0);

    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

export function magicCircleUniforms(opts = {}) {
  const THREE = opts.THREE || (typeof window !== 'undefined' ? window.THREE : null);
  if (!THREE) {
    throw new Error(
      'magicCircleUniforms: pass { THREE } in opts, or expose THREE globally. ' +
      'This module avoids importing three directly.'
    );
  }
  return {
    uTime:      { value: 0 },
    uColor:     { value: new THREE.Color(opts.color  ?? 0xffd66b) },
    uAccent:    { value: new THREE.Color(opts.accent ?? 0xff7e22) },
    uRuneCount: { value: opts.runeCount ?? 24.0 },
    uShape:     { value: opts.shape     ?? 5.0 },
    uOpacity:   { value: opts.opacity   ?? 1.0 },
  };
}
