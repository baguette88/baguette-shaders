// hologram.glsl.js — sci-fi shield / forcefield / hologram material.
// Fresnel rim glow + scrolling scanlines + intermittent glitch jitter + subtle flicker.
// Recommended geometry: any convex closed mesh — IcosahedronGeometry(1.4, 2) for shield,
//   TorusKnotGeometry for show-off, character meshes for "scanned-in" actors.
// Recommended material flags: { transparent:true, depthWrite:false, side:THREE.DoubleSide,
//   blending: THREE.NormalBlending } (additive: pass opts.additive for THREE.AdditiveBlending).
// Tick uTime once per frame. ESM: exports vertex+fragment GLSL strings and a uniforms factory.

export const hologramVertex = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;
  varying float vFacing; // +1 front-face-ish, -1 back-face-ish (computed in fragment via gl_FrontFacing)

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    // Object-space normal -> world space (no non-uniform scale assumed).
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vFacing = 0.0;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const hologramFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uRimColor;
  uniform float uScanDensity;
  uniform float uScanSpeed;
  uniform float uGlitchAmount;
  uniform float uFresnelPower;
  uniform float uOpacity;
  uniform float uColorCycle;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;

  // Cheap hash — good enough for glitch gating + flicker jitter.
  float hash11(float x) {
    return fract(sin(x * 127.1) * 43758.5453);
  }
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // HSV-ish hue rotation on an rgb color via 120deg-offset sin/cos channels.
  vec3 hueShift(vec3 c, float t) {
    // Rotate around grayscale axis. Standard rodrigues-rotation matrix at angle t.
    float ca = cos(t);
    float sa = sin(t);
    mat3 m = mat3(
      vec3(0.299 + 0.701*ca + 0.168*sa, 0.587 - 0.587*ca + 0.330*sa, 0.114 - 0.114*ca - 0.497*sa),
      vec3(0.299 - 0.299*ca - 0.328*sa, 0.587 + 0.413*ca + 0.035*sa, 0.114 - 0.114*ca + 0.292*sa),
      vec3(0.299 - 0.300*ca + 1.250*sa, 0.587 - 0.588*ca - 1.050*sa, 0.114 + 0.886*ca - 0.203*sa)
    );
    return clamp(m * c, 0.0, 1.0);
  }

  void main() {
    // --- Glitch jitter (gated; fires only occasionally) ----------------------
    // Quantize time into ~2 buckets/sec. Hash each bucket; trigger when above threshold.
    float gBucket = floor(uTime * 2.0);
    float gTrigger = step(0.92, hash11(gBucket));
    // Horizontal offset magnitude + per-row sign so it looks like a tearing CRT slip.
    float row = floor(vUv.y * 40.0);
    float rowJitter = (hash21(vec2(row, gBucket)) - 0.5) * 2.0;
    vec2 uv = vUv;
    uv.x += rowJitter * uGlitchAmount * gTrigger;

    // --- Fresnel rim glow ---------------------------------------------------
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    // Flip normal on back-faces so fresnel is consistent from either side.
    if (!gl_FrontFacing) N = -N;
    float facing = clamp(dot(V, N), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, uFresnelPower);

    // --- Scanlines ----------------------------------------------------------
    // Scroll vertically in world-space so the bands don't smear with UV seams.
    float scanY = vWorldPos.y * uScanDensity - uTime * uScanSpeed * uScanDensity;
    // Add a small uv-driven offset so glitch still affects the bands.
    scanY += uv.x * 0.5;
    float scan = sin(scanY);
    // Sharpen: bright thin lines on darker body.
    scan = smoothstep(0.2, 0.95, scan);

    // --- Secondary fast band — occasional bright sweep down the surface ----
    float sweep = smoothstep(0.0, 0.08, sin(vWorldPos.y * 0.6 - uTime * 1.4) - 0.85);

    // --- Inner depth fade (back-faces softer than front) -------------------
    float frontMask = gl_FrontFacing ? 1.0 : 0.45;

    // --- Color assembly ----------------------------------------------------
    vec3 bodyCol = uColor;
    if (uColorCycle > 0.5) {
      bodyCol = hueShift(bodyCol, uTime * 0.35);
    }

    // Mix body + scanline brighten + rim.
    vec3 col = bodyCol * (0.35 + 0.55 * scan);
    col += bodyCol * sweep * 1.5;
    col = mix(col, uRimColor, fresnel * 0.9);

    // Inner glow — slight emissive at the silhouette interior too.
    col += bodyCol * 0.15;

    // --- Flicker (alpha instability) ---------------------------------------
    float flicker = 0.85 + 0.15 * sin(uTime * 30.0 + hash11(floor(uTime * 12.0)) * 10.0);
    // Brief glitch burst: punch flicker harder when glitching.
    flicker *= mix(1.0, 0.7 + 0.6 * hash11(gBucket + 1.7), gTrigger);

    // Alpha: base opacity * (rim-driven visibility) * front/back mask * flicker.
    float alpha = uOpacity * frontMask * flicker;
    alpha *= (0.25 + 0.75 * (scan * 0.6 + fresnel + sweep * 0.4));
    alpha = clamp(alpha, 0.0, 1.0);

    // Color cycle also pushes rim a bit so the glow doesn't fight the body hue.
    if (uColorCycle > 0.5) {
      col = hueShift(col, sin(uTime * 0.7) * 0.15);
    }

    gl_FragColor = vec4(col, alpha);

    #include <colorspace_fragment>
  }
`;

export function hologramUniforms(opts = {}) {
  // NOTE: caller must have THREE in scope. We deliberately don't import it here so
  // this module stays a leaf with zero deps — matches the rest of baguette-shaders.
  return {
    uTime:         { value: 0 },
    uColor:        { value: new THREE.Color(opts.color    ?? 0x00e5ff) },
    uRimColor:     { value: new THREE.Color(opts.rim      ?? 0xffffff) },
    uScanDensity:  { value: opts.scanDensity   ?? 80.0 },
    uScanSpeed:    { value: opts.scanSpeed     ?? 0.6 },
    uGlitchAmount: { value: opts.glitch        ?? 0.05 },
    uFresnelPower: { value: opts.fresnelPower  ?? 2.2 },
    uOpacity:      { value: opts.opacity       ?? 0.85 },
    uColorCycle:   { value: opts.colorCycle ? 1.0 : 0.0 },
  };
}
