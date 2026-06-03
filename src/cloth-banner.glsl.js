// cloth-banner.glsl.js — medieval banner / flag in wind.
//
// Look: heavy fabric waving slowly, Dark Souls / Elden Ring vibe.
// Travelling sine ripple along uv.x (mount → tail) with the amplitude
// anchored at the pole (× uv.x) so the hoist side stays fixed while the
// fly edge whips. A second wave at a different frequency breaks symmetry.
// Per-vertex normal is derived analytically from the wave's cosine slope
// (∂z/∂x), so fragment lighting is smooth without flat shading.
//
// Fragment: lambert + ambient with uSunDir, plus a subtle subsurface
// "light bleed" on the back-lit side. Optional centered emblem stamp
// (cross SDF) painted in trim color. Pole shadow stripe darkens the
// first 5% of uv.x. High-frequency weave pattern subtly modulates value.
//
// Recommended geometry: PlaneGeometry(4, 2.4, 40, 24).
//   - Long axis (4 units) = uv.x = mount-to-tail (the wave traveling axis).
//   - Tessellation 40×24 is the minimum that keeps the ripple smooth.
//   - Mount the pole on the LEFT edge (uv.x = 0). The wave anchors there.
// Material flags: { side: THREE.DoubleSide }. Opaque, lit, depthWrite on.
//
// Uniforms:
//   uTime       — seconds
//   uColor      — fabric base color (vec3)
//   uTrim       — emblem / trim color (vec3)
//   uSunDir     — normalized light direction (vec3, world-ish space)
//   uWindSpeed  — phase rate of the travelling wave (default 1.6)
//   uWaveAmp    — peak displacement at the fly edge (default 0.18)
//   uWaveFreq   — primary wave frequency along uv.x (default 4.0)
//   uEmblem     — > 0 to stamp the center emblem
//
// WebGL2 / three r169. Uses `varying`. Resolve THREE via globalThis.THREE.

const THREE = globalThis.THREE;

export const clothBannerVertex = /* glsl */`
precision highp float;

uniform float uTime;
uniform float uWindSpeed;
uniform float uWaveAmp;
uniform float uWaveFreq;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;

// Travelling wave z(x,y,t).
// Anchored at uv.x=0 by the (uv.x) multiplier so the pole stays still.
// Two layers at different frequencies break the symmetry of a pure sin.
float waveZ(vec2 uv, float t) {
  float a1 = sin(uv.x * uWaveFreq - t * uWindSpeed);
  float a2 = sin(uv.x * (uWaveFreq * 1.73) - t * (uWindSpeed * 0.83) + 1.7);
  // small vertical modulation so top and bottom of the flag flap differently
  float v  = mix(0.85, 1.15, uv.y);
  return (a1 * 0.75 + a2 * 0.35) * uWaveAmp * uv.x * v;
}

// Analytic slope dZ/dUVx — derivative of waveZ wrt uv.x.
// d/dx [ sin(k x - w t) * x ] = k cos(k x - w t) * x + sin(k x - w t).
float waveDZ_dUVx(vec2 uv, float t) {
  float k1 = uWaveFreq;
  float k2 = uWaveFreq * 1.73;
  float p1 = uv.x * k1 - t * uWindSpeed;
  float p2 = uv.x * k2 - t * (uWindSpeed * 0.83) + 1.7;
  float v  = mix(0.85, 1.15, uv.y);
  float d1 = (k1 * cos(p1) * uv.x + sin(p1)) * 0.75;
  float d2 = (k2 * cos(p2) * uv.x + sin(p2)) * 0.35;
  return (d1 + d2) * uWaveAmp * v;
}

void main() {
  vUv = uv;

  // Plane geometry default normal is +Z (lies in the XY plane).
  vec3 pos = position;
  float z = waveZ(uv, uTime);
  pos.z += z;

  // Approximate analytic normal: tangent along x is (1, 0, dz/dx_world).
  // PlaneGeometry width spans world X by W units; uv.x runs 0..1, so
  // dz/dx_world = dz/dUVx / width. We don't know width here so we use a
  // normalized form: building (T,B,N) directly in uv space gives the same
  // direction up to scale, which is all normalize cares about.
  float dzdx = waveDZ_dUVx(uv, uTime);
  // Tangent in object space (uv.x runs along +X for a default PlaneGeometry)
  vec3 T = normalize(vec3(1.0, 0.0, dzdx));
  // Bitangent along +Y — we approximate dz/dy ≈ 0 (vertical flap is small)
  vec3 B = vec3(0.0, 1.0, 0.0);
  vec3 N = normalize(cross(B, T)); // points roughly +Z, tilts with wave

  vNormalW = normalize(mat3(modelMatrix) * N);
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const clothBannerFragment = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3  uColor;
uniform vec3  uTrim;
uniform vec3  uSunDir;
uniform float uEmblem;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;

// SDF of a plus/cross centered in the flag (uv space, 0..1).
// Returns negative inside the shape.
float sdCross(vec2 p, vec2 b) {
  p = abs(p);
  p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2  w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0));
}

void main() {
  // --- Base fabric color ---
  vec3 base = uColor;

  // --- High-freq weave: subtle brightness ripple, doesn't change hue ---
  float weave = sin(vUv.x * 220.0) * sin(vUv.y * 180.0);
  base *= 1.0 + weave * 0.04;

  // --- Pole shadow stripe: darken first 5% of uv.x ---
  float pole = smoothstep(0.0, 0.05, vUv.x);
  base *= mix(0.45, 1.0, pole);

  // --- Edge fray darkening (top/bottom hem) ---
  float hem = smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.0, 0.04, 1.0 - vUv.y);
  base *= mix(0.78, 1.0, hem);

  // --- Emblem stamp: centered cross in trim color ---
  if (uEmblem > 0.5) {
    vec2 cuv = vUv - vec2(0.5, 0.5);
    // stretch slightly so the cross reads on a 4×2.4 flag (aspect ~1.67)
    cuv.x *= 1.6;
    float d = sdCross(cuv, vec2(0.22, 0.07));
    float mask = 1.0 - smoothstep(-0.005, 0.005, d);
    // dark outline just outside the shape
    float outline = (1.0 - smoothstep(0.0, 0.012, d)) * (1.0 - mask);
    base = mix(base, uTrim, mask);
    base = mix(base, uTrim * 0.25, outline);
  }

  // --- Lighting ---
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  float NdotL = dot(N, L);

  float lambert = max(NdotL, 0.0);
  float ambient = 0.35;
  // Subtle back-side subsurface bleed (heavy fabric, but still translucent)
  float bleed = pow(max(-NdotL, 0.0), 2.0) * 0.15;

  vec3 lit = base * (ambient + lambert * 0.85 + bleed);

  // --- Subtle global value variance to suggest fabric thickness folds ---
  lit *= 0.95 + 0.05 * sin(vUv.x * 11.0 + uTime * 0.2);

  gl_FragColor = vec4(lit, 1.0);
}
`;

export function clothBannerUniforms(opts = {}) {
  const T = THREE ?? globalThis.THREE;
  return {
    uTime:      { value: 0 },
    uColor:     { value: new T.Color(opts.color ?? 0x8a1f1f) },
    uTrim:      { value: new T.Color(opts.trim  ?? 0xe8c44b) },
    uSunDir:    { value: new T.Vector3(0.4, 0.8, 0.3).normalize() },
    uWindSpeed: { value: opts.windSpeed ?? 1.6 },
    uWaveAmp:   { value: opts.waveAmp   ?? 0.18 },
    uWaveFreq:  { value: opts.waveFreq  ?? 4.0 },
    uEmblem:    { value: opts.emblem    ?? 1.0 },
  };
}
