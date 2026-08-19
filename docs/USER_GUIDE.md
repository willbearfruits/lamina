# LAMINA user guide

## Start
Two examples ship in `examples/` (pedal sandwich, Eurorack panel) — buttons on the wizard's first step, or Help menu.

`./serve.sh` → open http://localhost:8790 (or `./run.sh` for the desktop window). The **New project wizard** asks:
1. **One board** or **two boards (sandwich)** — a lower "MAIN" board and an upper "PANEL" board joined by headers and standoffs.
2. **Size & shape** — presets (100×100 JLC cheap tier, Hammond 1590B/BB/125B insides, Eurorack HP widths, business card, circles) or custom; corner radius.
3. **Look** — solder-mask colour per board, silkscreen colour, thickness, finish (HASL/ENIG).
4. **Hardware** — corner mounting holes or (two boards) corner **standoffs** that go through both boards; the **board-to-board connector** (pin header ↔ female header 8.5 mm, low-profile, stackable…) which sets the **gap** = standoff length. The wizard tells you if that length is a stock standoff.
5. Name + design rules (JLCPCB 2-layer by default).

## Design studio (generators & effects) — `Ctrl+G` or the ✦ Design button
**Generators** fill a region with art and are hole/pad/part aware by construction: hatch, concentric rings, spiral,
flow field, noise contours, maze, Truchet tiles, Voronoi cells, dot grids, scatter, and halftone from an image.
The region is the board minus cutouts, drills, pads, part courtyards and your margins — or just inside/outside your
selection; on a two-board stack you can also avoid the *other* board's parts, which is how you keep panel art off the pots.
**Effects** transform the selection: grow/shrink, round corners, silhouette, shadow/echo, roughen, hatch-the-selection,
and text/image → outlines. Ten one-click **presets** (Engraved panel, Topographic, Ferrofluid, Circuit maze, Cracked earth, Dot matrix, Static, Exposed copper hatch, Rings, Truchet weave) get you somewhere interesting immediately.
The dialog docks to the side and can be dragged, so the **live preview** stays visible on the board; *Apply* drops real items on the chosen layer and keeps the dialog open so you can stack passes. Tick **keep clear of existing artwork** to make the fill flow around your text and shapes.

## The editor
* **Board tabs** (MAIN / PANEL, `Tab` switches), **viewing top / BOTTOM** toggle (`Shift+V`) — bottom view is mirrored like the real board.
* **Tools** (left): select, line, rect, circle, polygon, text, image, measure, pad, hole, slot, via, trace, copper region, part. Active **layer** is in the toolbar (or click a layer in the Layers panel). Rect/circle/polygon on **Edge.Cuts** are cutouts.
* **Layers panel**: visibility, active layer, counts, *Realistic / Layers* render modes, *X-ray* (see the far side), *Ghost other* (outline + parts + holes of the other board of the stack, so you can line up panel holes with what's underneath).
* **Properties** (right): everything about the selected item; with nothing selected → **board** (size, shape, colour, thickness…), **stack** (gap, connectors, standoffs, hardware list) and **document** settings.
* **Parts panel**: click a part then click on the board (R rotates, F flips side, Esc stops). Stack items (standoffs, connector pairs) live on both boards. Search box filters. Parts marked ⚠ have footprints not fully verified against a datasheet — check before ordering.
* Selection: click, Shift-click, marquee; drag to move; yellow handles edit vertices/radius/corners; arrows nudge by the grid; `R`/`Shift+R` rotate; `F` flip side; `Shift+M` mirror; `Ctrl+C/X/V/D` copy/cut/paste-at-cursor/duplicate; `Del`; Edit → Align/distribute, **Repeat/array** (grid or circular).
* **Right-click** anything for the short way to do it: cut/copy/duplicate/delete, rotate, flip, mirror, move to layer/other board, replace footprint, expose copper, array, align, lock, zoom — and on empty board: paste here, place part, draw, active layer, view side, DRC, export.
* **Snapping**: grid snap plus **object snap** (toolbar `objects`) to pads, holes, part origins, item vertices/centres, board corners/centre — including everything on the *other* board of a stack, so panel art lines up with the pots underneath. Hold `Alt` to ignore snapping; the green cross shows what you snapped to (blue = the other board).
* **TOP / BOTTOM** switch sits in the board tab bar (`Shift+V`): the bottom view is mirrored, exactly like looking at the real board.
* Text uses stroke fonts — **21 families** (sans, roman/times, script, blackletter, Greek/Cyrillic, weather/music/astro symbols); size = cap height; per-item letter/line spacing and a **curve (arc radius)** for arched labels. Heavy faces need ≥2 mm to print.
* Images: PNG/JPG/SVG → thresholded to ink (silk, copper, mask opening — pick the layer). They arrive at **their real size** (the file's own dpi: PNG pHYs, JPEG JFIF/EXIF, SVG mm; 96 dpi assumed otherwise) and Properties has dpi / Original size / Fit board / Centre, plus threshold, invert, dither.
* **Parts you imported** (from KiCad or DipTrace) carry their own footprint. Right-click → *Replace footprint…* to swap in a library part (ranked by pad-pattern similarity, with previews), or Edit → *Match imported parts to library…* to do the whole board at once — that's what gives them 3D bodies, heights and through-panel data.
* **Two-board specifics**: parts on the lower board that must poke through the panel (pots, jacks, toggles, LEDs, encoders) get a *Through upper board* checkbox → the panel gets the right hole automatically, and DRC checks the gap against the part's bushing/panel distance. Component heights on facing sides are checked against the gap.
* **DRC** (`Ctrl+R`): fab rules (trace/space, drills, annular rings, edge distances, silk sizes, silk-over-pad, copper clearance between named nets, parts off-board/overlapping) + stack rules (gap vs connector range, standoff length, collisions, bushings). Click a finding to jump to it.
* **3D** (`2`): textured boards, parts, standoffs; explode slider; snapshot PNG.

## Files
* **Save** = `<name>.lamina.json` (browser: a download; Electron: a save dialog). Autosave to the browser's localStorage; the wizard offers to restore it.
* **Import**: KiCad board (.kicad_pcb → new project / replace / add as second board), KiCad footprint (.kicad_mod → Parts panel "Imported"), **DipTrace board** (PCB Layout → File → Save As → *DipTrace ASCII* `.asc`; the binary .dip cannot be read — pads, outline, traces, vias, holes, texts come across exactly, pattern silk of rotated parts and copper pours are best-effort), SVG graphics (logo/outline), images.

## Export (`Ctrl+E`)
Tick formats, choose boards, then **Export bundle (zip)** (one zip, subfolders + README) or **Save individually**:
* **JLCPCB / FlatCAM** — Gerber (Protel names) + Excellon (PTH & NPTH), per board. *Save individually* gives you `<name>-<board>-jlcpcb.zip` — upload as-is; JLC recognises the layers. Choose the same thickness/colour/finish in the order form.
* **KiCad** — `.kicad_pcb` per board with embedded footprints; DipTrace imports it directly (File → Import → KiCAD board).
* **DXF** — layered DXF for DipTrace (File → Import → DXF, mm), Fusion/FreeCAD, laser cutting.
* **SVG** true-scale renders + per-layer + outline; **PDF** 1:1 pages; **PNG/JPEG** renders (DPI).
* **3D** — STL, OBJ+MTL, GLB (textured; Blender: File → Import → glTF).
* **G-code** — drills, outline with tabs, silk engraving (GRBL). Isolation routing: FlatCAM with the gerbers.
* **BOM / CPL / hardware** — JLC assembly CSVs, standoff/screw/connector list.

## Round trip with your circuit
Design the panel/artwork here → export KiCad → route in KiCad → **Import KiCad board** back to place it under a redesigned panel (the ghost shows its parts) → export the panel's gerbers. Or start from an existing KiCad board and add the second board here.
