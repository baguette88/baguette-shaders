// Rolling sand dunes terrain — long-period 2D noise drives vertex displacement
// on a high-tessellation plane, with high-frequency wind ripples laid on top
// (gated by NdotW so they only appear on dune flanks facing the wind). Normals
// are derived from two epsilon height samples — no normalMatrix lighting math,
// the height field IS the surface. Palette evokes Dune / Journey / The Pathless:
// warm beige bodies, deep amber valleys, bright wind-bleached crests.
//
// Recommended geometry: new THREE.PlaneGeometry(10, 10, 128, 128) rotated -PI/2.
// Recommended material: { side: THREE.FrontSide } (opaque, depthWrite on).
// Tick `uTime` once per frame. WebGL2 / three r169 (varying-style).

const THREE = globalThis.THREE;

// ---------------------------------------------------------------------------
// Shared noise block — pasted into both vertex and fragment so each stage can
// resample the height field independently (vertex for displacement + normal,
// fragment for the crest/shadow color band that re-reads world height).
// ---------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */`
  // Cheap 2D hash → [0,1).
  float duneHash(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Value noise with smooth (quintic) interpolation — softer ridges than
  // linear, no diamond artifacts.
  float duneNoise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float a = duneHash(i + vec2(0.0, 0.0));
    float b = duneHash(i + vec2(1.0, 0.0));
    float c = duneHash(i + vec2(0.0, 1.0));
    float d = duneHash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // 4-octave fbm — long-period base + medium detail. Tuned so the lowest
  // octave dominates (rolling dunes), with higher octaves adding crest break.
  float duneFbm(vec2 p){
    float v = 0.0;
    float a = 0.55;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80); // ~37deg per octave — kills grid
    for(int i = 0; i < 4; i++){
      v += duneNoise(p) * a;
      p = rot * p * 2.07 + vec2(17.3, 9.7);
      a *= 0.48;
    }
    return v;
  }
`;

// ---------------------------------------------------------------------------
// Vertex — displaces the plane by sampled height, then re-samples at +eps in
// X and Z to build a height-field normal. NdotW (wind-facing) is computed
// here and passed down so the fragment can also use it if needed.
// ---------------------------------------------------------------------------
export const sandDunesVertex = /* glsl */`
  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uDuneAmp;
  uniform float uDuneScale;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vHeight;
  varying float vNdotW;
  varying vec2  vLocalXZ;

  ${NOISE_GLSL}

  // Height field sampled in local plane coords (plane lies in XY locally,
  // rotated -PI/2 on the CPU → local-X = world-X, local-Y = world-Z).
  // Returns the displacement along the plane normal (= world Y after rotation).
  float duneHeight(vec2 p){
    // Base dune body — long-period fbm.
    float base = duneFbm(p * uDuneScale);
    // Soften troughs, sharpen crests — pow(>1) compresses lows, lifts highs.
    base = pow(base, 1.35) * uDuneAmp;

    // Wind ripples — high-freq sin along wind dir, slowly drifting.
    // Aligned to uWindDir so ripple lines run *perpendicular* to wind flow,
    // the way real aeolian ripples form.
    float windCoord = dot(p, uWindDir);
    float rippleT   = uTime * 0.08; // slow migration
    float ripple    = sin(windCoord * 6.5 - rippleT * 4.0) * 0.5
                    + sin(windCoord * 13.0 - rippleT * 6.0) * 0.25;

    // Gate ripple amplitude by slope facing the wind. We approximate the
    // wind-facing factor here with a cheap finite-diff along uWindDir.
    float e = 0.25;
    float hForward = duneFbm((p + uWindDir * e) * uDuneScale);
    float slopeIntoWind = (hForward - duneFbm(p * uDuneScale)) / e;
    float windFace = clamp(slopeIntoWind * 2.5, 0.0, 1.0);

    return base + ripple * 0.05 * windFace;
  }

  void main(){
    vec2 p = position.xy; // local plane coords (pre-rotation)

    float h = duneHeight(p);

    // Epsilon-derived normal: sample height field at +eps in two directions,
    // build tangent vectors, cross product → surface normal. We treat the
    // plane as local XY with +Z up *before* the CPU-side -PI/2 X rotation,
    // so the resulting normal is correct in local space.
    float e = 0.06;
    float hx = duneHeight(p + vec2(e, 0.0));
    float hz = duneHeight(p + vec2(0.0, e));
    vec3 nLocal = normalize(vec3(-(hx - h) / e, -(hz - h) / e, 1.0));

    // Wind-facing dot product (in plane space, against uWindDir as a 3D vec).
    vec3 wind3 = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
    vNdotW = clamp(dot(nLocal.xzy, wind3), 0.0, 1.0);

    // Displace along local +Z (becomes world +Y after the -PI/2 X rotation).
    vec3 displaced = position + vec3(0.0, 0.0, h);
    vec4 wp = modelMatrix * vec4(displaced, 1.0);

    vWorldPos = wp.xyz;
    // Lighting uses height-derived normal directly — no normalMatrix needed.
    // The CPU rotation maps local +Z → world +Y, local +X → world +X,
    // local +Y → world -Z, so we rebuild the world normal explicitly.
    vNormal   = normalize(vec3(nLocal.x, nLocal.z, -nLocal.y));
    vHeight   = h;
    vLocalXZ  = p;

    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ---------------------------------------------------------------------------
// Fragment — three-stop sand palette (shadow → sand → crest) driven by NdotL
// and world height, dusty distance haze, subtle ripple chroma break.
// ---------------------------------------------------------------------------
export const sandDunesFragment = /* glsl */`
  uniform float uTime;
  uniform vec3  uSand;
  uniform vec3  uCrest;
  uniform vec3  uShadow;
  uniform vec3  uHaze;
  uniform vec3  uSunDir;
  uniform vec2  uWindDir;
  uniform float uDuneAmp;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vHeight;
  varying float vNdotW;
  varying vec2  vLocalXZ;

  ${NOISE_GLSL}

  void main(){
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDir);

    // Cheap NdotL — sand reads bright in direct sun, plunges fast in shadow.
    // pow(NdotL, 1.5) deepens the valleys without crushing slopes to black.
    float NdotL  = max(dot(N, L), 0.0);
    float lit    = pow(NdotL, 1.5);

    // Height-driven crest band — peaks read bleached/dry, valleys deep amber.
    // Normalize against uDuneAmp so the band tracks amplitude changes.
    float hNorm  = clamp(vHeight / max(uDuneAmp, 0.001), 0.0, 1.0);
    float crestT = smoothstep(0.55, 0.92, hNorm);

    // Base sand → crest blend (height-driven).
    vec3 col = mix(uSand, uCrest, crestT);
    // Shadow blend (light-driven). Deep amber wins in valleys/back-lit faces.
    col = mix(uShadow, col, lit);

    // Subtle ripple chroma break on wind-facing flanks — sharpens the look
    // of wind-rippled sand without re-displacing geometry.
    if(vNdotW > 0.05){
      float windCoord = dot(vLocalXZ, uWindDir);
      float rippleT   = uTime * 0.08;
      float ripple    = sin(windCoord * 13.0 - rippleT * 6.0) * 0.5 + 0.5;
      // Tint ripple highlights toward crest color, troughs toward sand body.
      col = mix(col, uCrest, ripple * vNdotW * 0.18);
    }

    // Micro-grain via fbm in fragment — keeps the surface from reading as
    // a clean plastic gradient under raking light.
    float grain = duneFbm(vLocalXZ * 8.0);
    col *= mix(0.92, 1.06, grain);

    // ---- Distant haze --------------------------------------------------------
    // Warm dusty cream past 8 units from the camera. Uses real cameraPosition
    // when present (three injects it as a built-in uniform in fragment shader).
    float dist = length(vWorldPos - cameraPosition);
    float haze = smoothstep(8.0, 22.0, dist);
    col = mix(col, uHaze, haze * 0.75);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Uniform factory — pass overrides via `opts`. THREE is resolved from
// globalThis (set by the caller's three.js import).
//
// Usage:
//   import * as THREE from 'three';
//   globalThis.THREE = THREE;
//   import { sandDunesVertex, sandDunesFragment, sandDunesUniforms }
//     from './sand-dunes.glsl.js';
//   const geo = new THREE.PlaneGeometry(10, 10, 128, 128);
//   geo.rotateX(-Math.PI / 2);
//   const mat = new THREE.ShaderMaterial({
//     vertexShader: sandDunesVertex,
//     fragmentShader: sandDunesFragment,
//     uniforms: sandDunesUniforms(),
//     side: THREE.FrontSide,
//   });
// ---------------------------------------------------------------------------
export function sandDunesUniforms(opts = {}) {
  const T = globalThis.THREE || THREE;
  return {
    uTime:      { value: 0 },
    uSand:      { value: new T.Color(opts.sand   ?? 0xe3b676) },
    uCrest:     { value: new T.Color(opts.crest  ?? 0xfbe6b0) },
    uShadow:    { value: new T.Color(opts.shadow ?? 0x6e3318) },
    uHaze:      { value: new T.Color(opts.haze   ?? 0xfdd99a) },
    uSunDir:    { value: new T.Vector3(0.3, 0.6, 0.2).normalize() },
    uWindDir:   { value: new T.Vector2(1.0, 0.5).normalize() },
    uDuneAmp:   { value: opts.duneAmp   ?? 1.4 },
    uDuneScale: { value: opts.duneScale ?? 0.35 },
  };
}
