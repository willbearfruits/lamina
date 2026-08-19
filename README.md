# LAMINA — PCB design studio

**▶ Runs in your browser, nothing to install: <https://willbearfruits.github.io/lamina/>**
(Everything is local — no cloud, no accounts. Projects autosave to that
browser's storage; use **File → Save as** to keep a `.lamina.json` you can
carry to another machine, and **File → Open** to load it back.)


Design-first PCB tool for makers: pick a board size and colour, place holes, jacks, pots, headers and standoffs, draw silkscreen/copper art, stack two boards into a sandwich (panel + main board) with the right connector gap and standoff length, look at it in 3D — then export to **JLCPCB (Gerber/Excellon zip), KiCad, DipTrace (DXF or via KiCad), FlatCAM, G-code, SVG, PDF 1:1, PNG/JPEG, STL/OBJ/GLB (Blender), BOM/CPL**. Round-trip: import a finished KiCad board — or a DipTrace board saved as DipTrace ASCII (.asc) — to add artwork or design its panel.

No build step, no cloud. Runs in a browser (`./serve.sh`) or as a desktop app (`./run.sh`, Electron).

```
./serve.sh                     # → http://localhost:8790
node test/run-all.mjs          # exporter/importer/library tests
http://localhost:8790/?selftest  # in-browser self test
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
