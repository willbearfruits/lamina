# Exporter / importer module contract

Every exporter lives in `js/export/<name>.js`, is a plain ES module (no DOM required unless stated), and exports:

```js
export function exportXxx(doc, opts = {}) → Array<{ name: string, data: string | Uint8Array }>
```
* `doc` = a LAMINA document (docs/FORMAT.md). Exporters call `resolveBoard(board, doc, {textAsStrokes, imagesAsPolys, bitmapFor})` from `js/geom.js` and work ONLY from resolved geometry.
* `opts.boards` = array of board indices to export (default all). `opts.bitmapFor(imageItem) → {w,h,data}` is provided by the app for image items (may be absent → skip images).
* Return files with **relative names** (subfolders allowed, e.g. `gerber/board-F_Cu.gtl`); the app bundles them into a zip or saves individually. Use `safeName(board.name)` from `js/export/common.js` for file stems.
* Coordinates: LAMINA is mm, Y up, origin bottom-left. Convert per target: Gerber = mm Y up (same); Excellon same; KiCad = mm **Y down** (use y' = H − y where H = board height so the board lands in +x/+y quadrant… KiCad's visible sheet has y growing downward; use an origin offset e.g. (20, 20) mm so it doesn't sit at the sheet corner); DXF = Y up (same); SVG = Y down (flip); PDF = points (1 mm = 72/25.4 pt), Y up (same as PDF native).
* Bottom-side text: resolved prims already carry `mirror:true` for bottom text; stroke fonts (`textAsStrokes:true`) already produce mirrored polylines — exporters that need vector text just use the polylines. Only KiCad export uses native text (`t:'text'` with `mirror`).
* Every module has a node test `test/<name>.test.mjs` (see `test/fixtures.mjs`, run with `node test/<name>.test.mjs`) that prints `ALL PASS` at the end and exits non-zero on failure. Tests may shell out to `~/.local/bin/kicad-cli` when relevant.

Importers live in `js/import/<name>.js` and export `importXxx(text|ArrayBuffer, opts) → Document` (or a partial: `{ items, outline, thickness, name }` to be merged by the app; document which).
