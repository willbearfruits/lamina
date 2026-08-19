# LAMINA — PCB design studio

**▶ Try it now, nothing to install: <https://willbearfruits.github.io/lamina/>**

**▶ Or download the standalone app:
[Releases](https://github.com/willbearfruits/lamina/releases/latest)** —
Linux AppImage (x64/arm64), Windows installer or portable `.exe`, macOS
`.dmg` (Intel/Apple Silicon). Same app, offline, with native Open/Save
dialogs. Unsigned, so the OS will warn once: Windows *More info → Run
anyway*; macOS right-click → *Open*.

Everything is local either way — no cloud, no accounts, no telemetry. In the
browser, projects autosave to that browser's storage; use **File → Save as**
to keep a `.lamina.json` you can carry between machines, and **File → Open**
to load it back.

## Examples

**File → Open example…** — six starting points, all of which resolve and pass
DRC in CI:

| | |
|---|---|
| **Pedal sandwich** | Two boards stacked with standoffs and a board-to-board header, knobs poking through the panel. The full two-board model, panel artwork and copper art. |
| **Daisy Seed breakout** | Module, four knobs, encoder, OLED and audio jacks — the board a [daisypatcher](https://github.com/willbearfruits/daisypatcher) patch is meant to land on. |
| **ESP32-S3 audio board** | ESP32-S3-Zero, two knobs, in/out jacks and a header for an I2S DAC. |
| **Eurorack 8HP panel** | 3U panel with the mounting slots in the right places, pots, jacks and an LED, rear-mounted. |
| **Eurorack 4HP starter** | The smallest useful starting point — duplicate it and build on it. |
| **1590B faceplate** | No components at all: just the holes a 1590B needs, plus artwork in five stroke fonts and a bare-copper bar. Export PDF at 1:1 to print a drill template, or DXF for a CNC. |


Design-first PCB tool for makers: pick a board size and colour, place holes, jacks, pots, headers and standoffs, draw silkscreen/copper art, stack two boards into a sandwich (panel + main board) with the right connector gap and standoff length, look at it in 3D — then export to **JLCPCB (Gerber/Excellon zip), KiCad, DipTrace (DXF or via KiCad), FlatCAM, G-code, SVG, PDF 1:1, PNG/JPEG, STL/OBJ/GLB (Blender), BOM/CPL**. Round-trip: import a finished KiCad board — or a DipTrace board saved as DipTrace ASCII (.asc) — to add artwork or design its panel.

No build step, no cloud. Runs in a browser (`./serve.sh`) or as a desktop app (`./run.sh`, Electron).

```
./serve.sh                       # → http://localhost:8790
./run.sh                         # desktop shell (Electron)
node test/run-all.mjs            # exporter/importer/library tests
node tools/check_examples.mjs    # every example resolves, no DRC errors
http://localhost:8790/?selftest  # in-browser self test
npm run dist:linux               # build the standalone app (also :win, :mac)
```

Docs: `docs/USER_GUIDE.md` (how to use), `docs/FORMAT.md` (file format & geometry contract), `docs/LIBRARY.md` (footprint schema), `docs/EXPORTERS.md`.

Project files are plain JSON (`*.lamina.json`) and autosave to the browser's localStorage.

## Licence

**AGPL-3.0-or-later** — see [`LICENSE`](./LICENSE). The licence covers LAMINA
itself. Boards you design with it are your own work, and the files it exports
(Gerber, KiCad, DXF, G-code, STL…) carry no licence from this tool.

Third-party material, with its own terms and attribution kept alongside it:

- **three.js** r170 (MIT) — vendored in `vendor/`.
- **KiCad footprints** in `lib-src/kicad/` — CC-BY-SA 4.0 with the KiCad
  Libraries Exception; see `lib-src/kicad/LICENSE.md`. Parts loaded from these
  verbatim are marked in their `meta`.
- **Hershey fonts** in `lib-src/hershey/` — see `lib-src/hershey/hershey.txt`
  and `README.md` for the original acknowledgement (Dr. A. V. Hershey, US
  National Bureau of Standards).

Footprints marked `verify:true` were typed from datasheets and drawings rather
than read off an official drawing — check them against your parts before you
order a board.
