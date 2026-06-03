// crystal-facet.glsl.js
// ----------------------------------------------------------------------------
// Faceted gem / crystal shader. Diablo / Genshin pickup vibe.
//
// Technique summary:
//   * Hard facet shading via cross(dFdx(vPos), dFdy(vPos)) — every triangle reads
//     as a single plane regardless of vertex normals (so a smooth-shaded import
//     still looks faceted). r169 is WebGL2, derivatives are core, no extension.
//   * Fresnel rim with pow(fresnel, uFresnelPower) for body glow, pow(fresnel, 8)
//     for diamond-edge highlight.
//   * Iridescent thin-film: hue cycles with NdotV through cos() of a high freq;
//     R/G/B channels phase-shifted by 2pi/3 → smooth rainbow band.
//   * Internal sparkle: hash a point along the refracted view ray inside the
//     gem, threshold for pinpoint stars. Cheap fake-refraction.
//   * Color core: deep base color shows through where fresnel is low.
//
// Recommended geometry:
//   new THREE.OctahedronGeometry(1.2, 0)     // 8 hard facets, classic gem
//   new THREE.IcosahedronGeometry(1.2, 0)    // 20 facets, more sparkle surface
// Material flags:
//   { transparent: true, side: THREE.DoubleSide, depthWrite: false }
// ----------------------------------------------------------------------------

export const crystalFacetVertex = /* glsl */`
  varying vec3 vPosW;      // world-space position (for flat normal derivation)
  varying vec3 vPosL;      // local-space position (stable noise seed)
  varying vec3 vViewW;     // world-space view direction (camera -> fragment)
  varying vec3 vNormalS;   // smooth normal as fallback / blend

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vPosL = position;
    vNormalS = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const crystalFacetFragment = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uCore;
  uniform vec3  uRim;
  uniform vec3  uIridA;
  uniform vec3  uIridB;
  uniform float uFresnelPower;
  uniform float uIridFreq;
  uniform float uSparkle;

  varying vec3 vPosW;
  varying vec3 vPosL;
  varying vec3 vViewW;
  varying vec3 vNormalS;

  // ---- hash / noise helpers --------------------------------------------------
  float hash31(vec3 p){
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 p){
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0,0,0));
    float n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0));
    float n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1));
    float n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1));
    float n111 = hash31(i + vec3(1,1,1));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }

  // 3-channel iridescent thin-film band.
  // Each channel reads cosine of NdotV at a phase offset → rainbow strip.
  vec3 iridescence(float ndv, float phase){
    float a = ndv * 6.28318 * uIridFreq + phase;
    vec3 c = vec3(
      cos(a),
      cos(a + 2.0943951),     //  2pi/3
      cos(a + 4.1887902)      //  4pi/3
    );
    c = 0.5 + 0.5 * c;        // [0,1]
    // Tint the rainbow toward the user's two iridescence anchors.
    vec3 tinted = mix(uIridA, uIridB, c.r);
    tinted = mix(tinted, uIridB, c.g * 0.5);
    return mix(c, tinted, 0.65);
  }

  // Internal sparkle: walk a few steps along a refracted ray, sample 3D noise,
  // threshold to isolated pinpoints. Cheap, no real path tracing.
  float sparkleField(vec3 origin, vec3 dir){
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      float t = 0.15 + float(i) * 0.22;
      vec3 p = origin + dir * t;
      // Two octaves of noise, animated.
      float n = vnoise(p * 14.0 + uTime * 0.4);
      n += 0.5 * vnoise(p * 31.0 - uTime * 0.7);
      // Threshold to pinpoints; sharpen with pow.
      float pin = smoothstep(0.78, 0.95, n / 1.5);
      s = max(s, pin * (1.0 - float(i) * 0.18));
    }
    return s;
  }

  void main() {
    // -- flat facet normal from screen-space derivatives --------------------
    // This is the whole point: gives hard facet shading even if the mesh has
    // averaged vertex normals.
    vec3 dPx = dFdx(vPosW);
    vec3 dPy = dFdy(vPosW);
    vec3 nFlat = normalize(cross(dPx, dPy));
    // Make sure flat normal faces the camera (handles DoubleSide back facets).
    if (dot(nFlat, vViewW) < 0.0) nFlat = -nFlat;

    // Blend a hair of the smooth normal so the silhouette doesn't get
    // jagged-AA artifacts at glancing angles. 95% flat / 5% smooth.
    vec3 N = normalize(mix(nFlat, vNormalS, 0.05));
    vec3 V = normalize(vViewW);
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    // -- fresnel -----------------------------------------------------------
    float fresnel = pow(1.0 - ndv, uFresnelPower);
    float edgeSpark = pow(1.0 - ndv, 8.0);     // sharp diamond-edge pop

    // -- iridescent band ---------------------------------------------------
    // Per-facet phase: hash the flat normal so neighboring facets land on
    // different points of the rainbow. Tiny time drift = slow shimmer.
    float facetPhase = hash31(floor(nFlat * 7.31)) * 6.28318 + uTime * 0.35;
    vec3 irid = iridescence(ndv, facetPhase);

    // -- internal sparkle (fake refraction) --------------------------------
    // Refract the inverted view direction through the surface (IOR ~ 1.5).
    vec3 rdir = refract(-V, N, 1.0 / 1.5);
    // Origin in local space so the sparkle pattern is glued to the gem.
    vec3 sOrigin = vPosL;
    vec3 sDir = normalize(mat3(viewMatrix) * rdir); // any stable basis works
    float sparkle = sparkleField(sOrigin, sDir) * uSparkle;

    // -- compose -----------------------------------------------------------
    // Deep core color, dim toward facet centers.
    vec3 body = uCore * (0.55 + 0.45 * (1.0 - ndv * 0.5));

    // Iridescent thin-film modulated by fresnel (only visible at glancing).
    body += irid * fresnel * 0.85;

    // Diamond-edge rim.
    body += uRim * edgeSpark * 1.4;

    // Internal pinpoint sparkles, tinted toward white-iris.
    body += mix(uRim, uIridA, 0.4) * sparkle * 1.6;

    // Subtle facet-tone variation so identical facets don't read uniform.
    float facetTone = hash31(floor(nFlat * 11.7));
    body *= 0.88 + 0.24 * facetTone;

    // Alpha: more opaque toward edges (rim), more transparent at face centers
    // so back facets bleed through the front.
    float alpha = clamp(0.55 + fresnel * 0.6 + sparkle * 0.4 + edgeSpark, 0.0, 1.0);

    gl_FragColor = vec4(body, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function crystalFacetUniforms(opts = {}) {
  // Lazy THREE handle — pulled from globals so this module stays import-free.
  const THREE = (typeof window !== 'undefined' && window.THREE) || globalThis.THREE;
  const C = (hex) => new THREE.Color(hex);
  return {
    uTime:         { value: 0 },
    uCore:         { value: C(opts.core  ?? 0x6e2bb8) },
    uRim:          { value: C(opts.rim   ?? 0xffffff) },
    uIridA:        { value: C(opts.iridA ?? 0xff4dff) },
    uIridB:        { value: C(opts.iridB ?? 0x4dffe0) },
    uFresnelPower: { value: opts.fresnelPower ?? 2.5 },
    uIridFreq:     { value: opts.iridFreq     ?? 3.0 },
    uSparkle:      { value: opts.sparkle      ?? 1.0 },
  };
}
