# The mark

`mark.svg` is the source of truth. Everything downstream of it — the PNGs, the
`.ico`, the `.icns` in `docs/brand/icons/`, and the SVGs the app serves from
`public/` — is rendered from it by `scripts/make_brand.py`. Never drawn by
hand, never edited downstream.

```
uv run scripts/make_brand.py          # PEP 723: cairosvg and pillow come with it
```

The script needs no project and no virtualenv of its own; its dependencies are
declared in its header and `uv` resolves them per run. Nothing in the web build
depends on it — the app ships the vectors, and the raster set is made ahead of
a platform that demands a `.ico` or an `.icns` rather than in response to one.

## The four drawings

| File              | What it is                | Where it goes                        |
| ----------------- | ------------------------- | ------------------------------------ |
| `mark.svg`        | the full mark, `pdf → md` | every slot at 24px and up; `public/` |
| `mark-small.svg`  | the arrow alone           | 16px slots only; the favicon         |
| `mark-macos.svg`  | the full mark, inset      | `icon.icns`, all sizes               |
| `lockup-wide.svg` | mark + wordmark on paper  | README, docs, About                  |

`WEB_SVGS` in the script is the list of what the app serves: add a stem there
and it ships, and there is no second place to update. The rendered set lands in
`docs/brand/icons/`, beside the SVGs it comes from rather than beside a
consumer, because it has more than one possible consumer and no current one.

## Why there are two drawings

Three elements do not survive 16 pixels. At that size a person is not reading the
mark, they are matching a red square in a list — so the small slots get the arrow,
which is a crop of the full mark rather than a different idea. The threshold is the
size a person _sees_, not the pixel count: `icon.icns` holds two different 32×32
images, because one of them is displayed at 16pt on a retina screen.

## Why macOS gets its own drawing

Apple's icon grid expects app art to sit inside its canvas — roughly 824 of 1024,
with transparent margin. A full-bleed tile renders visibly larger than every native
neighbor in the Dock. `mark-macos.svg` is the same drawing at that inset.

## Specification

```
gradient      #F0522A → #B01221 at 135°, 17.8° of hue travel
reads as      #D03225 at 16px (a gradient collapses to its average)
letters       #FFF4EE, 4.66 : 1 against that average
tile          64 units, corner radius 14 (21.9%)
safe area     46 × 50
type          Nunito 900, lowercase, tracking −0.015em
layout        arrow rule — type at 19.01/64, clearance 0.16em, arrow shaft 0.21em
wordmark      Literata 600 at opsz 12 (the text cut), tracking −0.028em
```

Both faces are OFL. **Neither is a dependency** — every glyph is already converted
to outlines, so nothing downstream loads a font. That is deliberate: favicons render
outside normal font loading, GitHub blocks external resources inside README SVGs,
and the PNGs are rasterised at build time. A `font-family` reference in any of those
falls back silently to whatever the machine happens to have.

To change the type you need the fonts again — pin `Nunito[wght].ttf` at 900 and
`Literata[opsz,wght].ttf` at 600/12, and re-outline. Do not pin Literata's `opsz`
to 72; that is the display cut, and it has hairline serifs that fight the mark.
