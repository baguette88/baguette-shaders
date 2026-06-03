# @baguette/shaders

Central three.js GLSL shader catalog for baguette88 games. **Single source of
truth** — new games call on this repo instead of copy-pasting `.glsl.js` files.

Every module in `src/` exports three things with a shared prefix:

```js
<name>Vertex      // vertex shader source (string)
<name>Fragment    // fragment shader source (string)
<name>Uniforms(opts)   // factory -> uniforms object; pass { THREE } or expose window.THREE
```

Some also export builder helpers (e.g. `buildPineTreeGeometry(THREE, opts)`).

`index.js` re-exports everything and ships a `SHADERS` registry array; the same
data lives in `registry.json` for tooling.

---

## Call on it from a new game

These are local single-file three.js games, so the repo is **private** and games
import from the local clone. Add the alias to your importmap:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "@baguette/shaders": "/Users/bread/code/baguette-shaders/index.js",
    "@baguette/shaders/": "/Users/bread/code/baguette-shaders/"
  }
}
</script>
```

> The path is whatever your dev server serves the repo at. Run the game with a
> static server whose root reaches `~/code` (e.g. `python3 -m http.server` from
> `~/code`, then the alias becomes `/baguette-shaders/index.js`). For a game in a
> sibling folder a relative path also works: `"../baguette-shaders/index.js"`.

Then:

```js
import * as THREE from 'three';
import { buildPineTreeGeometry,
         pineTreeGrowVertex, pineTreeGrowFragment, pineTreeGrowUniforms }
  from '@baguette/shaders';

window.THREE = THREE; // lets the uniforms factories build Color/Vector3

const geo  = buildPineTreeGeometry(THREE, { height: 4, tiers: 6 });
const mat  = new THREE.ShaderMaterial({
  vertexShader: pineTreeGrowVertex,
  fragmentShader: pineTreeGrowFragment,
  uniforms: pineTreeGrowUniforms({ THREE, height: geo.userData.height }),
});
scene.add(new THREE.Mesh(geo, mat));

// animate: ease uGrow 0 -> 1 to plant the tree, keep ticking uTime for sway
mat.uniforms.uGrow.value = t;     // 0..1
mat.uniforms.uTime.value = clock; // seconds
```

### If you flip the repo public

Public repos can import straight off the CDN — no local server, no path juggling:

```json
"@baguette/shaders": "https://cdn.jsdelivr.net/gh/baguette88/baguette-shaders@main/index.js",
"@baguette/shaders/": "https://cdn.jsdelivr.net/gh/baguette88/baguette-shaders@main/"
```

---

## Catalog

`pine-tree-grow`, `water-surface`, `hologram`, `snow-ice`, `lightning`, `flame`,
`crystal-facet`, `magic-circle`, `plasma-orb`, `smoke`, `electricity-arc`,
`cloth-banner`, `oil-slick`, `sand-dunes`.

See `demo/pine-tree.html` for a live grow demo.
