// snow-ice.glsl.js — Fresh snow / glacial ice surface shader.
// Subsurface (pow(1-NdotV,3)) glow on grazing angles, hash3 sparkle field
// with view-direction twinkle gating, fbm dune modulation, crystalline rim,
// and voronoi F2-F1 hairline cracks gated by uIcy.
// Geometry: PlaneGeometry(10,10,8,8) for snowfield OR SphereGeometry(1.5,64,32) for snowball.
// Material flags: side: THREE.FrontSide, transparent: false (opaque), lights: false.

export const snowIceVertex = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    // Footprint displacement: skipped here — would sample up to 4 uFootprints[i]
    // (vec4 pos.xyz + radius.w), compute dist in XZ, depress along normal:
    //   float d = distance(worldPos.xz, fp.xz);
    //   worldPos.xyz -= vNormal * smoothstep(fp.w, 0.0, d) * 0.05;
    // Then re-project. Add as uniform vec4 uFootprints[4] + int uFootprintCount.
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const snowIceFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uSnowColor;
  uniform vec3  uShadow;
  uniform vec3  uSubsurface;
  uniform vec3  uSparkleColor;
  uniform vec3  uSunDir;
  uniform float uIcy;
  uniform float uSparkleAmt;
  uniform float uNoiseScale;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec2 vUv;

  // ---- hashes ----
  float hash1(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 hash3(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453);
  }

  // ---- value noise ----
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash1(i + vec3(0,0,0));
    float n100 = hash1(i + vec3(1,0,0));
    float n010 = hash1(i + vec3(0,1,0));
    float n110 = hash1(i + vec3(1,1,0));
    float n001 = hash1(i + vec3(0,0,1));
    float n101 = hash1(i + vec3(1,0,1));
    float n011 = hash1(i + vec3(0,1,1));
    float n111 = hash1(i + vec3(1,1,1));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  // ---- voronoi F2 - F1 for ice cracks ----
  vec2 voronoiF1F2(vec3 p) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float f1 = 1e9;
    float f2 = 1e9;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash3(ip + g);
      vec3 r = g + o - fp;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
    return vec2(sqrt(f1), sqrt(f2));
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uSunDir);

    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float NdotL = clamp(dot(N, L), 0.0, 1.0);

    // ---- fbm dune modulation (packed vs fluffy) ----
    vec3 np = vWorldPos * uNoiseScale;
    float dune = fbm(np * 0.35);
    float packed = fbm(np * 1.7 + 11.0);

    // base shadow→snow mix biased by sun
    vec3 baseCol = mix(uShadow, uSnowColor, NdotL * 0.85 + 0.15);
    baseCol = mix(baseCol, uSnowColor * 1.05, smoothstep(0.35, 0.75, dune));
    baseCol = mix(baseCol, uShadow * 1.1, smoothstep(0.55, 0.95, packed) * 0.35);

    // ---- subsurface scatter — warm interior glow on grazing angles ----
    float sss = pow(1.0 - NdotV, 3.0);
    // boost when sun is behind / through the surface
    float backLight = clamp(dot(-L, V) * 0.5 + 0.5, 0.0, 1.0);
    vec3 subsurface = uSubsurface * sss * (0.55 + 0.55 * backLight);

    // ---- crystalline rim ----
    float fresnel = pow(1.0 - NdotV, 5.0);
    float rim = smoothstep(0.0, 0.3, fresnel);
    vec3 rimCol = vec3(0.92, 0.97, 1.05) * rim * 0.45;

    // ---- sparkle field ----
    // quantize world pos to crystal cells, hash3 -> threshold high
    float sparkleScale = 180.0;
    vec3 sp = floor(vWorldPos * sparkleScale);
    vec3 h = hash3(sp);
    float sparkSeed = h.x;
    // only the rare cells become crystal facets
    float crystal = step(0.985, sparkSeed);
    // each facet has a pseudo-random normal — sparkle gated by view alignment
    vec3 facetN = normalize(h * 2.0 - 1.0);
    float facetAlign = pow(clamp(dot(facetN, V), 0.0, 1.0), 64.0);
    // animated twinkle: phase per cell, modulated by view dir so orbiting reveals new sparkles
    float phase = h.y * 6.2831853;
    float twinkle = 0.5 + 0.5 * sin(uTime * 6.0 + phase + dot(V, vec3(7.3, 3.1, 5.7)));
    twinkle = pow(twinkle, 3.0);
    // combine with sun bounce so sparkles also need light
    float sunBounce = pow(max(dot(reflect(-L, N), V), 0.0), 32.0);
    float sparkle = crystal * facetAlign * twinkle * (0.4 + sunBounce) * uSparkleAmt;
    vec3 sparkleCol = uSparkleColor * sparkle * 3.0;

    // ---- ice variant: hairline cracks via voronoi F2-F1 ----
    vec2 vor = voronoiF1F2(vWorldPos * 3.5);
    float crackEdge = vor.y - vor.x;
    // thresholded thin veins (smaller = closer to cell boundary)
    float cracks = 1.0 - smoothstep(0.02, 0.08, crackEdge);
    cracks *= smoothstep(0.0, 0.4, fbm(vWorldPos * 0.8)); // break up uniformity
    vec3 crackCol = vec3(0.18, 0.28, 0.42);

    // ice base shifts cooler & more translucent feel
    vec3 iceTint = mix(uSnowColor, vec3(0.78, 0.88, 0.98), 0.55);
    vec3 iceBase = mix(baseCol, iceTint, 0.6);
    iceBase = mix(iceBase, crackCol, cracks * 0.7);
    // ice gets stronger subsurface
    vec3 iceSubsurface = subsurface * 1.6;

    // ---- blend snow vs ice ----
    vec3 col = mix(baseCol, iceBase, uIcy);
    vec3 ss  = mix(subsurface, iceSubsurface, uIcy);

    // basic lambert + ambient floor
    float lambert = NdotL * 0.7 + 0.3;
    col *= lambert;

    col += ss;
    col += rimCol;
    col += sparkleCol;

    // subtle cool-on-cool global tint
    col = mix(col, col * vec3(0.97, 1.0, 1.04), 0.5);

    // tone clamp
    col = col / (1.0 + col * 0.15);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function snowIceUniforms(opts = {}) {
  // NOTE: factory expects THREE on the caller side (window.THREE or import).
  // We don't import THREE here to keep this file pure GLSL strings + factory.
  const THREE = (typeof window !== 'undefined' && window.THREE) || globalThis.THREE;
  if (!THREE) throw new Error('snowIceUniforms: THREE must be available on globalThis or window');
  return {
    uTime:         { value: 0 },
    uSnowColor:    { value: new THREE.Color(opts.snow       ?? 0xf0f5fa) },
    uShadow:       { value: new THREE.Color(opts.shadow     ?? 0xa8c5e0) },
    uSubsurface:   { value: new THREE.Color(opts.subsurface ?? 0x88a8d8) },
    uSparkleColor: { value: new THREE.Color(opts.sparkle    ?? 0xffffff) },
    uSunDir:       { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uIcy:          { value: opts.icy         ?? 0.0 },
    uSparkleAmt:   { value: opts.sparkleAmt  ?? 1.0 },
    uNoiseScale:   { value: opts.noiseScale  ?? 2.0 },
  };
}
