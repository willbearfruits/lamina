# LAMINA footprint / part definition schema (js/library.js, js/lib/parts_hardware.js)

All dims **mm**, local frame centred on the part origin (the point the user places),
X right, **Y up**, as seen from the TOP of the board the part is on. `rot` deg CCW.

```js
{
  id: 'pot_alpha_9mm',            // stable key stored in documents (part.lib)
  name: 'Alpha 9 mm pot RD901F',  // UI name
  cat: 'Controls',                // one of CATEGORIES in library.js
  ref: 'RV',                      // reference designator prefix
  tags: ['pot','alpha'], desc: 'text', verify: false,   // verify:true → UI shows "check vs datasheet"
  pads: [ { name:'1', x, y, shape:'circle'|'rect'|'oval'|'roundrect', w, h, drill, layer:'both'|'F'|'B', rot, slotLen } ],
  holes: [ { x, y, d } ],         // NPTH mechanical holes belonging to the part
  graphics: [                     // silkscreen/fab drawing
    { t:'line', x1,y1,x2,y2, w, layer:'F.Silk' },
    { t:'circle', cx,cy,r, w(0=filled), layer },
    { t:'arc', cx,cy,r,a0,a1, w, layer },
    { t:'rect', cx,cy,w,h, rot, rx, filled, lw, layer },
    { t:'poly', pts:[[x,y]...], filled, lw, layer },
    { t:'polyline', pts, w, closed, layer },
    { t:'text', x,y,text,size,thickness,rot,align, layer }   // text '${REF}' / '${VALUE}' substituted
  ],
  courtyard: { w, h } | { pts:[[x,y]...] },   // centred; used for bbox/collision
  refPos: { x, y },               // where the auto reference designator text goes (F.Silk); refText:false hides it
  height: 12.5,                   // total height above the board surface (mm) — used for stack clearance
  body3d: [ ...prims ],           // 3D model for the preview / STL / OBJ / glTF — see "body3d primitives" below
  through: { x, y, d } | { x, y, slot:{ len, w, rot } },  // clearance hole the FACING board (upper panel) needs when part.through = true
  throughLabel: 'shaft', bushingLen: 7,             // info: length of the threaded bushing above the part body top (panel thickness range)
  panelDist: 5.0,                 // ideal clear gap lower-board-top → panel underside for this part (its bushing shoulder height); DRC compares it with stack.gap
  meta: { mfr, mpn, lcsc, datasheet, pinLenAbove, ... }
}
```

## `body3d` primitives

The 3D model of a part is a flat list of primitives in the **part-local frame**: X right, Y up (top
view), **Z up out of the board surface**, millimetres. `z` is the **bottom of the primitive's bounding
box** unless noted. `js/lib/models3d.js` turns each prim into a three.js mesh; `partBodyGroup()` in
`js/view3d.js` assembles them, merges them per material and caches the result per footprint id.
Bottom-side placement and rotation are applied to the whole group by the resolver — never bake them in.

| prim | fields | notes |
|---|---|---|
| `box` | `x,y,z,w,d,h` | centred at `x,y`, `z` = bottom face. Cheapest prim (12 tris) |
| `rbox` | `x,y,z,w,d,h,r,bevel` | rounded box. `r` = corner radius (default `min(0.35,w/8,d/8)`), `bevel` = top/bottom chamfer (default 0). `w`/`d`/`h` stay exact |
| `cyl` | `x,y,z,d,h,axis,d2,seg,bore,hex` | `axis:'z'` (default): centred at `x,y`, base at `z`. `axis:'x'|'y'`: **centre** at `x,y,z`, running along that axis. `d2` = far-end diameter (cone/frustum; far end = +Z/+X/+Y). `seg` = radial segments (auto from `d`). `bore` = axial hole Ø (tube). `hex:true` = legacy 6-segment |
| `hex` | `x,y,z,af,h,axis,bore` | hex prism, `af` = across flats (measured along Y). `bore` = axial hole Ø. Nuts, standoffs |
| `sphere` | `x,y,z,d,cut,seg` | `cut:'bottom'` = dome sitting on `z` (flat cap at `z`, top at `z+d/2`); `cut:'top'` = bowl; `cut:null`/omitted = full sphere with its bbox bottom at `z` |
| `torus` | `x,y,z,d,thickness,axis` | ring lying in the plane normal to `axis` (default Z); `z` = the ring's **centre plane**, `d` = outer Ø, `thickness` = tube Ø. Thread ridges, crimp grooves |
| `prism` | `x,y,z,pts,h,bevel` | polygon `pts:[[x,y],…]` (relative to `x,y`) extruded from `z` to `z+h`. D-shafts, chamfered cans, polarity stripes |
| `pin` | `x,y,z,len,below,shape,d,w,d2` | a lead **through the board**: from `z-below` (default 2.2, i.e. under the board) up to `z+len`. `shape:'round'` uses `d`; `shape:'square'` uses `w` × (`d`, default `w`) |

Every prim also accepts:

- `color: '#rrggbb'` — required in practice; the material is inferred from it when `material` is absent
  (gold/brass → `gold`, silver → `metal`, tin → `solder`, FR4 greens/blues/blacks → `pcb`, `#dfe` → `glass`).
- `material: 'plastic'|'ceramic'|'rubber'|'pcb'|'metal'|'gold'|'chrome'|'solder'|'glass'|'led'` — tuned
  `MeshStandardMaterial` presets (roughness/metalness, plus opacity for `glass`/`led`). No exotic passes,
  so STL/OBJ/GLB export unchanged.
- `emissive: '#rrggbb'`, `emissiveIntensity` — lit LEDs and display faces (`material:'led'` self-emits its colour).
- `rot: [rx,ry,rz]` — degrees, applied **about the prim's own centre**, after the `axis` orientation.

Degenerate prims (zero/NaN size, unknown `t`) are silently dropped rather than producing NaN geometry.

**Automatic detail.** `partBodyGroup()` adds, for every footprint (unless `fp.autoLeads === false`):
through-hole pads get a thin metal lead going down through the board, mounting-lug slots get a flat
solder tab, and SMD pads get a thin solder sliver. Pads that already have a hand-modelled thin
`pin`/`box`/`cyl` on them are left alone. A footprint with **no** `body3d` gets a rounded, slightly
inset dark body from its courtyard (skipped when `height: 0`, e.g. mounting holes).

**Budget.** Geometries and materials are cached and shared by their parameters, and each part's meshes
are merged into one multi-material mesh cached per footprint id, so repeated parts cost almost nothing.
The whole 168-part library is ~93k triangles; keep a single part under ~3k.

Bottom-side placement is handled by the resolver (mirror X, swap F/B layers) — footprints are always defined for the top side.
Generators (`hdr_1x08`, `fhdr_2x10`, `dip_16`, `soic_8`, `b2b_hdr_1x08`) are resolved by `getFootprint(id)`.

Stack connector types: `{ id:'b2b_xxx', name, nominalGap, minGap, maxGap, lowerGen(rows,n)→libId, upperGen(rows,n)→libId, note }`.
Gap = clear distance between the two boards' facing surfaces = standoff length. Built-in types (see the notes in
`tools/build_hardware_lib.mjs` for the derivations; male header = 2.54 plastic + 6.0 pins, female = 8.5 body):

| id | lower (top side) | upper (bottom side) | gap nominal / min–max |
|---|---|---|---|
| `b2b_hdr` | `hdr_RxN` | `fhdr_RxN` | 11.0 / 10.5–12.5 |
| `b2b_hdr_lp` | `hdr_RxN` | `fhdr_RxN_lp5` (5.0 mm socket) | 7.5 / 7.5–9.5 (trim 6 mm pins to ~4.5 or they bottom out at ~9) |
| `b2b_hdr_stack` | `fhdr_RxN` | `shdr_RxN` (Arduino stacking, 10.5 mm legs) | 10.0 / 8.5–11.5 |
| `b2b_longpin` | `hdr_RxN_l15` (15 mm pins) | `hdr_RxN_pads` (soldered) | 11.0 / 8.0–12.5 |
| `b2b_pinstrip` | `fhdr_RxN` | `fhdr_RxN` (+ male-male strip) | 19.5 / 19.5–22 |

Hardware parts (`js/lib/parts_hardware.js`, generated) put the origin on the shaft/bushing/lens axis for through-panel parts
so `through` is `{0,0}`; modules/connectors are body-centred; `verify:true` = pads/heights not read from a dimensioned drawing.
