# LAMINA project format & geometry contract (format `lamina/1`)

This is the single source of truth for the in-memory document, the `.lamina.json`
file, and the **resolved geometry** that every exporter/renderer consumes.
Exporters MUST work from `resolveBoard()` output (js/geom.js), never from raw items,
so that pads, parts, images and text are flattened exactly once and every format agrees.

## Units & frame

* All lengths are **millimetres**. Angles are **degrees, counter-clockwise**.
* Every board has its own local frame: origin at the **bottom-left corner of the
  board's bounding box**, X right, **Y up** (mathematical). Exporters convert
  (KiCad/DXF/PDF/SVG have their own conventions — see each exporter).
* All coordinates — including bottom-side items — are expressed **as seen from the
  top** (like KiCad and Gerber). Bottom-side text is rendered mirrored.
* Boards in a stack share the XY frame; `board.offset = {x,y}` shifts a board
  relative to the stack origin (usually 0,0 for both).

## Document

```jsonc
{
  "format": "lamina/1",
  "name": "my-pedal",
  "created": "2026-08-18T12:00:00Z",
  "modified": "...",
  "units": "mm",
  "drcPreset": "jlcpcb-2layer",           // key into DRC presets (js/drc.js)
  "boards": [ Board, ... ],               // 1 or 2 (index 0 = lower/main, 1 = upper/panel)
  "stack": Stack,                          // present even for 1 board (enabled:false)
  "meta": { "author": "", "notes": "" }
}
```

## Board

```jsonc
{
  "id": "b1", "name": "MAIN", "role": "lower" | "upper",
  "outline": { "type": "rect", "w": 100, "h": 100, "r": 2 }        // r = corner radius
           | { "type": "circle", "d": 60 }
           | { "type": "polygon", "points": [[x,y],...] },
  "thickness": 1.6,                     // 0.6 0.8 1.0 1.2 1.6 2.0
  "color": "green",                     // green|red|blue|black|white|yellow|purple  (solder mask)
  "silkColor": "white",                 // white|black
  "finish": "HASL",                     // HASL|LeadFreeHASL|ENIG
  "copperOz": 1,
  "offset": { "x": 0, "y": 0 },
  "items": [ Item, ... ]
}
```

## Items (all have `id`, `type`; graphics have `layer`)

Layers: `F.Cu B.Cu F.Mask B.Mask F.Silk B.Silk F.Paste B.Paste Edge.Cuts F.Fab B.Fab`.
Notes: `*.Mask` items are **openings** (mask removed) as in Gerber/KiCad convention.
`Edge.Cuts` graphics with a closed shape (rect/circle/polygon) are internal **cutouts**.

| type | fields | notes |
|---|---|---|
| `line` | x1,y1,x2,y2,width | round caps |
| `arc` | cx,cy,r,a0,a1,width | CCW from a0 to a1 |
| `circle` | cx,cy,r,width,filled | filled → disc; else ring of `width` |
| `rect` | x,y,w,h,rot,rx,width,filled | (x,y) = **center**; rx corner radius |
| `polygon` | points,width,filled | closed |
| `text` | x,y,text,size,thickness,rot,mirror,align(`left|center|right`), font(`stroke`) | size = cap height (mm); thickness = stroke width. Bottom layers auto-mirror at render/export |
| `image` | x,y,w,h,rot,src(dataURL),threshold(0-255),invert,dither(false) | (x,y)=center. Vectorised at export (dark pixels → filled) |
| `pad` | x,y,shape(`circle|rect|oval|roundrect`),w,h,rot,drill(0=SMD),slot(0 or slot length),layer(`F|B|both`),plated(true),name,net,maskMargin(null=default) | `both` = through-hole. `roundrect` uses `rr` ratio (default 0.25) |
| `hole` | x,y,d | non-plated through hole (NPTH) |
| `slot` | x,y,len,w,rot | NPTH slot (routed) |
| `via` | x,y,d,drill,net | plated, both Cu, tented (no mask opening) unless `tented:false` |
| `trace` | points,width,layer(`F.Cu|B.Cu`),net | polyline, round joins/caps |
| `region` | points,layer(`F.Cu|B.Cu`),net | filled copper polygon (no automatic clearance) |
| `part` | lib,ref,value,x,y,rot,side(`top|bottom`),through(bool),locked, fp(optional inline footprint) | `lib` = key in js/library.js; `fp` = inline footprint def (imports) |

## Stack (two-board sandwich)

```jsonc
{
  "enabled": true,
  "gap": 11.0,                  // clear distance between facing surfaces (top of lower ↔ bottom of upper)
  "gapSource": "connector" | "manual",
  "links": [ Link, ... ]        // things that exist on BOTH boards at the same XY
}
```
`Link` = `{ id, kind: "standoff"|"connector"|"screw", x, y, rot, lib, opts }`

* **standoff**: `lib` = `standoff_m3` etc. Produces an NPTH hole (`opts.holeD`, default from lib) on both boards and a 3D hex spacer of length `stack.gap`. `opts.length` overrides (must equal gap ± tolerance or DRC warns).
* **connector**: `lib` = a mated pair from `library.js` (`STACK_CONNECTORS`), e.g. `b2b_hdr_1x08` → male header on the lower board (top side) + female header on the upper board (bottom side). Each pair defines `{nominalGap, minGap, maxGap}`. `opts.flip` swaps which board gets which half.
* Parts with `through:true` on the lower board request a hole in the upper board of `lib.through.d` at their position (pots, jacks, toggles, LEDs, encoders...).

## Resolved geometry (`resolveBoard(board, doc, opts) → Resolved`)

```jsonc
{
  "outline": [[x,y],...],                        // CCW polygon, corner radius flattened
  "cutouts": [ [[x,y],...], ... ],
  "layers": { "F.Cu": [Prim,...], "B.Cu": [...], "F.Mask": [...], "B.Mask": [...],
              "F.Silk": [...], "B.Silk": [...], "F.Paste": [...], "B.Paste": [...],
              "F.Fab": [...], "B.Fab": [...] },
  "drills": [ { x, y, d, plated:true|false, slotLen:0, rot:0 }, ... ],
  "pads": [ { x,y,shape,w,h,rot,drill,slotLen,layer,name,net,plated, partRef, poly:[[x,y]...] } ],
  "parts": [ { ref, value, lib, name, x,y,rot,side, height, body3d:[...], bbox:[x0,y0,x1,y1] } ],
  "bbox": [x0,y0,x1,y1]
}
```
Prims (every exporter must handle exactly these):
* `{t:'line', x1,y1,x2,y2,w}` round caps
* `{t:'polyline', pts:[[x,y]...], w, closed}` round joins/caps
* `{t:'arc', cx,cy,r,a0,a1,w}`
* `{t:'circle', cx,cy,r,w}` — `w===0` ⇒ filled disc, else ring
* `{t:'poly', pts, holes:[[pts]...] }` — filled, even-odd
* `{t:'text', x,y,text,size,thickness,rot,mirror,align}` — only when `opts.textAsStrokes` is false; otherwise text becomes `polyline`s from the Hershey stroke font
* `{t:'image', ...}` — only when `opts.imagesAsPolys` is false; otherwise `poly` runs

Copper: pads contribute their shape to `F.Cu`/`B.Cu` (through-hole → both), an expanded shape to `*.Mask` (default margin 0.05 mm each side... configurable in doc.drc), SMD pads to `*.Paste`. Vias: annular ring on both Cu, no mask opening if tented. Text on Cu is copper.

## Side flip rule for parts
For `side:'bottom'`: local point (px,py) → mirror px → −px, then rotate by `rot`, then translate.  Pad layer `F`→`B`, silk `F.Silk`→`B.Silk`, `F.Fab`→`B.Fab`; text mirrored.

## File
`*.lamina.json` = the Document verbatim (pretty-printed). Images are inline dataURLs.
