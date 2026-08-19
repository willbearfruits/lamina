# LAMINA — “Illustrator for PCBs” roadmap

The point of LAMINA is **design**: the board is a printed object (mask, silk, bare copper, holes, outline)
that also has to be manufacturable. Everything below is judged by that: does it make the *artwork* better,
and does it stay fab-correct?

## Shipped (v0.1 → v0.2)
- Board as a canvas: shape presets, colours per board, cutouts, two-board sandwiches with real stack maths.
- Draw tools (line/rect/circle/arc/polygon/text/image/pad/hole/slot/via/trace/copper region), vertex handles.
- Stroke-font text (Hershey), images thresholded to ink on any layer, copper art with mask openings.
- Right-click menus everywhere, TOP/BOTTOM view switch, object snapping (incl. to the *other* board of a stack),
  align/distribute, repeat & array (grid + circular), mirror, footprint replacement + matching for imported parts.
- Realistic + layer views, 3D preview, DRC (JLC rules + stack sanity), exports to JLCPCB/KiCad/DipTrace/FlatCAM/
  Blender/SVG/PDF/PNG/G-code, imports from KiCad, DipTrace, SVG, images.

## Next: the effects & generators panel (engine landing now)
A raster-backed area engine (`js/lib/clip.js`) gives us boolean ops, offsets and morphology on real geometry.
On top of it:

**Effects** (act on the selection, or on a whole layer, non-destructively where possible)
- Offset / inflate / deflate (grow a logo, thicken thin silk, make a mask opening 0.15 mm bigger than its copper)
- Round / chamfer corners; simplify; smooth
- Outline (silhouette of a group of shapes), skeleton/centre-line, dashed & dotted strokes
- Halftone (image → dots, the classic PCB photo trick), stipple, hatch fill (line/cross/waves), gradient hatch
- Distort: jitter/roughen, wave, twist, bulge, noise displacement — “glitch” presets fit this repo’s aesthetic
- Shadow / echo (offset copies on a second layer, e.g. copper under silk for a double-exposure look)
- Trace-ify: turn artwork into copper that *looks* like routing (orthogonal/45° “circuit” paths)

**Generators** (fill any region — board minus keepouts — and are hole/part aware by construction)
- Hatch, concentric contours, spiral, flow field, contour noise, maze, truchet tiles, voronoi cells, dot/hex grids,
  scatter, halftone from an image, Hilbert/space-filling curves, circuit-trace mazes
- Region = board outline − cutouts − drills − pads − courtyards − user margin, so generated art never fouls the fab

**Reactive layout helpers**
- Keepout-aware auto-placement of text labels around a control (arc text over a pot, tick marks, scale rings)
- “Fill the empty copper” pour with clearance, stitching vias on a grid inside a region

## Then
- **Text**: font picker (multi-font pack landing now), text on a path/arc, per-letter spacing/rotation, text→outline,
  vertical text, ligature-free stroke fonts for engraving, right-to-left (Hebrew) via a stroke Hebrew font.
- **Symbols & assets**: a shape library (arrows, waveform glyphs, jack/knob icons, star/burst, rosettes, guilloché),
  a “panel graphics” kit (pot scales, tick rings, chicken-head pointers), and saved user symbols.
- **Colour/finish preview**: ENIG vs HASL vs bare copper, black/white/matte mask, silk-on-copper contrast checks,
  a “what will actually print at 0.15 mm” proof view.
- **Groups & symbols**: group/ungroup, instance a group (edit once, update everywhere) — panels repeat a lot.
- **Smart guides**: alignment lines while dragging, equal-spacing hints, dimension annotations that live on Fab.
- **Panelisation**: step-and-repeat a whole board into a panel with mouse-bites/V-scores (a real JLC saving).
- **Live parametrics**: link a hole/label to a part so moving the pot moves its ring and legend.
- **Interactive knob/panel preview**: 3D with knobs and caps fitted, and a “photo” render mode.
