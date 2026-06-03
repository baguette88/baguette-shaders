// Stylized pond/ocean water surface — sum-of-sines height field with epsilon-derived
// normals, view-fresnel deep↔shallow blend, peak foam via smoothstep, and a tight
// Blinn-Phong sun glitter highlight. Subnautica/Abzu palette, not photoreal.
// Recommended geometry: new THREE.PlaneGeometry(N, N, 64, 64) rotated -Math.PI/2.
// Recommended material: { transparent: true, side: THREE.DoubleSide }.
// Tick `uTime` once per frame. Optional `uShoreFactor` (default 0) drives shoreline foam.

export const waterSurfaceVertex = /* glsl */`
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uWaveFreq;

  varying vec3  vWPos;
  varying vec3  vNormal;
  varying float vHeight;
  varying vec2  vUv;

  // Four directional sine waves — phase = dot(dir, xz) * freq + time * speed.
  // Amplitudes fall as frequency rises so the surface stays believable.
  float waveHeight(vec2 p, float t){
    float f = uWaveFreq;
    float a = uWaveAmp;

    float w1 = sin(dot(p, vec2( 1.00,  0.20)) * f        + t * 1.10) * a;
    float w2 = sin(dot(p, vec2(-0.70,  0.71)) * f * 1.73 + t * 1.47) * a * 0.55;
    float w3 = sin(dot(p, vec2( 0.35, -0.94)) * f * 2.61 + t * 1.92) * a * 0.32;
    float w4 = sin(dot(p, vec2(-0.92, -0.39)) * f * 4.10 + t * 2.41) * a * 0.18;

    return w1 + w2 + w3 + w4;
  }

  void main(){
    vUv = uv;

    // Plane is rotated -PI/2 on the CPU — position.xy here maps to world XZ after
    // model transform. Sample height in *local* space so it's view-independent.
    vec2 p = position.xy;
    float h = waveHeight(p, uTime);

    // Epsilon-derived normal in local space, then rotated into world by normalMatrix.
    float e = 0.15;
    float hx = waveHeight(p + vec2(e, 0.0), uTime);
    float hz = waveHeight(p + vec2(0.0, e), uTime);
    // For a plane lying in XY local (Y-up after rotation), the surface tangent is
    // along x and z; normal points along +z in local space (which becomes +Y world).
    vec3 nLocal = normalize(vec3(-(hx - h) / e, -(hz - h) / e, 1.0));

    vec3 displaced = position + vec3(0.0, 0.0, h);
    vec4 wp = modelMatrix * vec4(displaced, 1.0);

    vWPos   = wp.xyz;
    vNormal = normalize(normalMatrix * nLocal);
    vHeight = h;

    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const waterSurfaceFragment = /* glsl */`
  uniform float uTime;
  uniform vec3  uDeep;
  uniform vec3  uShallow;
  uniform vec3  uFoam;
  uniform vec3  uSunDir;     // world-space, already normalized
  uniform vec3  uSunColor;
  uniform float uWaveAmp;
  uniform float uShoreFactor;

  varying vec3  vWPos;
  varying vec3  vNormal;
  varying float vHeight;
  varying vec2  vUv;

  void main(){
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);

    // ---- Fresnel (Schlick) ----------------------------------------------------
    // Grazing angles → shallow/sky tint; near-vertical view → deep color.
    float NdotV = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - NdotV, 5.0);
    fresnel = mix(0.04, 1.0, fresnel);

    // Slight depth cue from local wave height — troughs read darker.
    float depthCue = smoothstep(-uWaveAmp, uWaveAmp, vHeight);
    vec3 deep    = uDeep * mix(0.78, 1.0, depthCue);
    vec3 shallow = uShallow * mix(0.95, 1.15, depthCue);

    vec3 baseColor = mix(deep, shallow, fresnel);

    // ---- Diffuse wrap (cheap "subsurface" feel for backlit waves) -------------
    float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    baseColor *= mix(0.85, 1.18, wrap);

    // ---- Peak foam ------------------------------------------------------------
    // Only the sharpest crests get foam. Threshold scaled to uWaveAmp so it
    // tracks amplitude changes automatically.
    float crestT = smoothstep(uWaveAmp * 0.55, uWaveAmp * 0.95, vHeight);
    // A little high-freq noise via vUv so foam doesn't read as a clean iso-line.
    float foamJitter = 0.5 + 0.5 * sin(vUv.x * 87.3 + uTime * 1.7)
                              * sin(vUv.y * 73.1 - uTime * 1.3);
    float peakFoam = crestT * mix(0.65, 1.0, foamJitter);

    // ---- Optional shoreline foam (skipped when uShoreFactor == 0) -------------
    float shoreFoam = 0.0;
    if(uShoreFactor > 0.0){
      // Distance-from-center radial band — caller can replace with a real
      // shore-distance texture later.
      vec2 c = vUv - 0.5;
      float r = length(c) * 2.0;
      float band = smoothstep(0.85, 1.0, r) * (1.0 - smoothstep(1.0, 1.12, r));
      shoreFoam = band * uShoreFactor
                * (0.7 + 0.3 * sin(r * 32.0 - uTime * 2.0));
    }

    float foamMask = clamp(peakFoam + shoreFoam, 0.0, 1.0);
    baseColor = mix(baseColor, uFoam, foamMask);

    // ---- Sun glitter (sharp Blinn-Phong) --------------------------------------
    float NdotH = max(dot(N, H), 0.0);
    float spec = pow(NdotH, 96.0);
    // A second, broader lobe softens the highlight core so it doesn't aliase.
    spec += pow(NdotH, 22.0) * 0.18;
    // Knock specular off the foam — wet foam shouldn't sun-flare.
    spec *= (1.0 - foamMask * 0.85);
    baseColor += uSunColor * spec * 1.35;

    // ---- Edge softening / output ---------------------------------------------
    // Alpha biases slightly transparent in deep view, opaque in foam.
    float alpha = mix(0.86, 1.0, fresnel);
    alpha = mix(alpha, 1.0, foamMask);

    gl_FragColor = vec4(baseColor, alpha);
  }
`;

// Uniform factory — `THREE` resolved from caller's import scope.
// Usage:
//   import * as THREE from 'three';
//   import { waterSurfaceVertex, waterSurfaceFragment, waterSurfaceUniforms }
//     from './water-surface.glsl.js';
//   const mat = new THREE.ShaderMaterial({
//     vertexShader: waterSurfaceVertex,
//     fragmentShader: waterSurfaceFragment,
//     uniforms: waterSurfaceUniforms(),
//     transparent: true,
//     side: THREE.DoubleSide,
//   });
export function waterSurfaceUniforms(opts = {}) {
  return {
    uTime:        { value: 0 },
    uDeep:        { value: new THREE.Color(opts.deep    ?? 0x062b3f) },
    uShallow:     { value: new THREE.Color(opts.shallow ?? 0x3da6c4) },
    uFoam:        { value: new THREE.Color(opts.foam    ?? 0xeaf6ff) },
    uSunDir:      { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor:    { value: new THREE.Color(opts.sun     ?? 0xfff0c8) },
    uWaveAmp:     { value: opts.amp  ?? 0.12 },
    uWaveFreq:    { value: opts.freq ?? 1.6 },
    uShoreFactor: { value: opts.shore ?? 0.0 },
  };
}
