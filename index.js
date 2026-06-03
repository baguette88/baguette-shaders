// @baguette/shaders — central catalog barrel.
//
// One import surface every game calls on. Add a game's importmap entry (see
// README) then:
//
//   import { pineTreeGrowVertex, pineTreeGrowFragment, pineTreeGrowUniforms,
//            buildPineTreeGeometry } from '@baguette/shaders';
//
// Each shader module exports `<name>Vertex`, `<name>Fragment`, and a
// `<name>Uniforms(opts)` factory. Some also export builder helpers.

export * from './src/pine-tree-grow.glsl.js';
export * from './src/water-surface.glsl.js';
export * from './src/hologram.glsl.js';
export * from './src/snow-ice.glsl.js';
export * from './src/lightning.glsl.js';
export * from './src/flame.glsl.js';
export * from './src/crystal-facet.glsl.js';
export * from './src/magic-circle.glsl.js';
export * from './src/plasma-orb.glsl.js';
export * from './src/smoke.glsl.js';
export * from './src/electricity-arc.glsl.js';
export * from './src/cloth-banner.glsl.js';
export * from './src/oil-slick.glsl.js';
export * from './src/sand-dunes.glsl.js';

// Machine-readable catalog: name -> module + export keys. Mirrors registry.json
// so a game can enumerate/lazy-load shaders without hardcoding strings.
export const SHADERS = [
  { name: 'pine-tree-grow', module: './src/pine-tree-grow.glsl.js', vert: 'pineTreeGrowVertex', frag: 'pineTreeGrowFragment', uniforms: 'pineTreeGrowUniforms', builder: 'buildPineTreeGeometry' },
  { name: 'water-surface',  module: './src/water-surface.glsl.js',  vert: 'waterSurfaceVertex',  frag: 'waterSurfaceFragment',  uniforms: 'waterSurfaceUniforms' },
  { name: 'hologram',       module: './src/hologram.glsl.js',       vert: 'hologramVertex',       frag: 'hologramFragment',       uniforms: 'hologramUniforms' },
  { name: 'snow-ice',       module: './src/snow-ice.glsl.js',       vert: 'snowIceVertex',        frag: 'snowIceFragment',        uniforms: 'snowIceUniforms' },
  { name: 'lightning',      module: './src/lightning.glsl.js',      vert: 'lightningVertex',      frag: 'lightningFragment',      uniforms: 'lightningUniforms' },
  { name: 'flame',          module: './src/flame.glsl.js',          vert: 'flameVertex',          frag: 'flameFragment',          uniforms: 'flameUniforms' },
  { name: 'crystal-facet',  module: './src/crystal-facet.glsl.js',  vert: 'crystalFacetVertex',   frag: 'crystalFacetFragment',   uniforms: 'crystalFacetUniforms' },
  { name: 'magic-circle',   module: './src/magic-circle.glsl.js',   vert: 'magicCircleVertex',    frag: 'magicCircleFragment',    uniforms: 'magicCircleUniforms' },
  { name: 'plasma-orb',     module: './src/plasma-orb.glsl.js',     vert: 'plasmaOrbVertex',      frag: 'plasmaOrbFragment',      uniforms: 'plasmaOrbUniforms' },
  { name: 'smoke',          module: './src/smoke.glsl.js',          vert: 'smokeVertex',          frag: 'smokeFragment',          uniforms: 'smokeUniforms' },
  { name: 'electricity-arc',module: './src/electricity-arc.glsl.js',vert: 'electricityArcVertex', frag: 'electricityArcFragment', uniforms: 'electricityArcUniforms' },
  { name: 'cloth-banner',   module: './src/cloth-banner.glsl.js',   vert: 'clothBannerVertex',    frag: 'clothBannerFragment',    uniforms: 'clothBannerUniforms' },
  { name: 'oil-slick',      module: './src/oil-slick.glsl.js',      vert: 'oilSlickVertex',       frag: 'oilSlickFragment',       uniforms: 'oilSlickUniforms' },
  { name: 'sand-dunes',     module: './src/sand-dunes.glsl.js',     vert: 'sandDunesVertex',      frag: 'sandDunesFragment',      uniforms: 'sandDunesUniforms' },
];
