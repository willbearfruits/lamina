# Hershey stroke fonts — source data for `js/lib/fonts.js`

These `.jhf` files are the classic Hershey vector fonts, cached here verbatim so
`tools/build_fonts.mjs` can regenerate `js/lib/fonts.js` offline.

* Fetched from <https://github.com/kamalmostafa/hershey-fonts> (`hershey-fonts/*.jhf`),
  which in turn mirrors <http://emergent.unpythonic.net/software/hershey>.
* `hershey.txt` is the notice file that accompanied the original Usenet distribution,
  copied here unchanged.
* Do not hand-edit these files. Do not hand-edit `js/lib/fonts.js` either — edit the
  generator and re-run `node tools/build_fonts.mjs`.

## Licence / use restriction (verbatim, from `hershey.txt`)

```
This distribution is made possible through the collective encouragement
of the Usenet Font Consortium, a mailing list that sprang to life to get
this accomplished and that will now most likely disappear into the mists
of time... Thanks are especially due to Jim Hurt, who provided the packed
font data for the distribution, along with a lot of other help.

USE RESTRICTION:
	This distribution of the Hershey Fonts may be used by anyone for
	any purpose, commercial or otherwise, providing that:
		1. The following acknowledgements must be distributed with
			the font data:
			- The Hershey Fonts were originally created by Dr.
				A. V. Hershey while working at the U. S.
				National Bureau of Standards.
			- The format of the Font data in this distribution
				was originally created by
					James Hurt
					Cognition, Inc.
					900 Technology Park Drive
					Billerica, MA 01821
					(mit-eddie!ci-dandelion!hurt)
		2. The font data in this distribution may be converted into
			any other format *EXCEPT* the format distributed by
			the U.S. NTIS (which organization holds the rights
			to the distribution and use of the font data in that
			particular format). Not that anybody would really
			*want* to use their format... each point is described
			in eight bytes as "xxx yyy:", where xxx and yyy are
			the coordinate values as ASCII numbers.
```

Some redistributions of the Hershey data carry the older, stricter wording
*"Hershey fonts ... may not be sold for profit"*; it is reproduced here so it travels
with the data whichever notice a downstream reader expects:

```
	Hershey Fonts
	The Hershey fonts are a set of vector fonts created by
	Dr. A. V. Hershey while working at the U. S. National Bureau of
	Standards.  The fonts are publicly available and may be used for
	any purpose, but they may not be sold for profit, and the above
	acknowledgement of Dr. Hershey's authorship must accompany the
	font data in any distribution.
```

The generated `js/lib/fonts.js` carries the Hershey/Hurt acknowledgement in its header,
so LAMINA satisfies condition 1 wherever it ships. LAMINA's own exports contain only the
outline geometry a user typed, never the font data table, so nothing further is required
downstream.

## Format

Each line is one glyph:

| columns | meaning |
| --- | --- |
| `0:4` | glyph number (the mirrors write a `12345` placeholder) |
| `5:7` | number of coordinate pairs, **including** the left/right pair |
| `8` | left position, as a character offset from `R` (82) |
| `9` | right position, same encoding |
| `10:` | coordinate pairs, `x` then `y`, each a character offset from `R`; the pair `" R"` is a pen-up |

`y` grows **downward** in the file. `tools/build_fonts.mjs` flips it to Y-up with the
baseline at `y = 9` in file units (i.e. `y_out = 9 - y_raw`), and shifts `x` by the left
position so each glyph's left bearing is 0. That is exactly what the older, hand-built
`js/lib/hershey.js` did, and the build is verified to reproduce it glyph-for-glyph.

Records map to printable ASCII in file order: record 0 → U+0020, record 94 → U+007E. The
96th record (which would be DEL) is dropped. For the *text* families that ordering is the
real character mapping; for the four symbol families (`weather`, `music`, `astro`,
`symbols`) it is arbitrary — the glyphs simply sit wherever the file put them.

## Files cached here

| file | LAMINA font id | note |
| --- | --- | --- |
| `futural.jhf` | `sans` | the face `js/lib/hershey.js` was built from |
| `futuram.jhf` | `sans-bold` | |
| `rowmans.jhf` | `roman` | |
| `rowmand.jhf` | `roman-duplex` | |
| `rowmant.jhf` | `roman-triplex` | |
| `timesr.jhf` | `times` | |
| `timesrb.jhf` | `times-bold` | |
| `timesi.jhf` | `times-italic` | |
| `timesib.jhf` | `times-bold-italic` | stands in for the missing `italicc` |
| `scripts.jhf` | `script` | |
| `scriptc.jhf` | `script-bold` | |
| `cursive.jhf` | `cursive` | |
| `gothgbt.jhf` | `gothic-eng` | |
| `gothgrt.jhf` | `gothic-ger` | |
| `gothitt.jhf` | `gothic-ita` | |
| `greeks.jhf` | `greek` | |
| `cyrillic.jhf` | `cyrillic` | |
| `meteorology.jhf` | `weather` | arbitrary ASCII mapping |
| `music.jhf` | `music` | arbitrary ASCII mapping |
| `astrology.jhf` | `astro` | arbitrary ASCII mapping |
| `symbolic.jhf` | `symbols` | arbitrary ASCII mapping |

Cached but **not** currently packed (kept so the generator table can grow without another
download): `gothiceng.jhf`, `gothicger.jhf`, `gothicita.jhf` (the *simplex* blackletters —
`gothgbt`/`gothgrt`/`gothitt` are the triplex cuts already shipped), `cyrilc_1.jhf`
(alternate Cyrillic), `markers.jhf`.

### Not available anywhere

`italicc.jhf` / `italiccs.jhf` ("Italic Complex") do **not** exist. The complete Hershey
`.jhf` distribution is 31 files and contains no such font — checked against
kamalmostafa/hershey-fonts, ixd-hof/HersheyFont, tinkerator/hershey and the upstream
emergent.unpythonic.net `hershey.zip`, all of which carry the identical 31-font set.
`timesi` (Times Italic), `timesib` (Times Bold Italic) and `cursive` are the italic-ish
faces the distribution actually has, and all three are packed.
