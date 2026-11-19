# OVO — UI Theme & Typography

## Typography

The sidebar font is a theme picked in **Settings → Sidebar font**, with two options:

| Value | Typeface | Notes |
| --- | --- | --- |
| `mono` (default) | `ui-monospace, Menlo, Consolas, monospace` | The plain monospace the project shipped with; no download. |
| `pixel` | **Geist Pixel** | Self-hosted, pixel feel. |

The choice is held in memory by the store (`sidebarFont`) and applied as
`<aside class="hud-sidebar" data-font="mono|pixel">`; CSS keys everything off `[data-font='pixel']`.
Display toggles (`sidebarFont`, `themeMode`, `daylightMode`) reset on reload, while visual
environment preferences (`ovo-floor`, `ovo-plant`, `ovo-moody-lighting`), camera view (`ovo-view`),
idle/lounge poses (`ovo-agent-poses`), and the selected agent (`?agent=`) persist across reloads.

### Geist Pixel, self-hosted

Geist Pixel is self-hosted from `public/fonts/` (`geist-pixel-latin-400.woff2`,
`geist-pixel-latin-ext-400.woff2`), so the app makes no request to `fonts.googleapis.com` and keeps
working offline. Only the single 400 cut Google Fonts publishes is shipped (latin + latin-ext
subsets), and pixel mode sets `font-synthesis: none`, so heavy text is differentiated by size and
letterspacing instead of a faux-bold. The two badges step up one pixel in pixel mode
(`.live-badge` 8→9px, `.source-badge` 9→10px) because the pixel cut reads thinner. Two deliberate
exceptions:

- `.sidebar-controls` stays `ui-monospace` in both modes: the arrow glyphs (`↑↓←→`) have no pixel
  cut and would otherwise mix two typefaces on one line.
- Text the browser paints outside the canvas (names in the 3D scene, HUD chips on the canvas) is
  not part of the sidebar.

The static site in `docs/` goes further and uses Geist Pixel for **all** text, not just headings:
`docs/site.css` starts both `:root` and `--mono` with `'Geist Pixel'`, `--pixel` aliases `--mono`,
and the same two 400 woff2 files are vendored in `docs/assets/` (with the latin subset preloaded in
`docs/index.html`). Heavier rules still request 520–700, but `font-synthesis: none` keeps the browser
from faking those cuts, so the page renders one weight on the pixel grid at every size.

The page also loads **nothing** from a third party: Font Awesome Free 6.7.2 is vendored in
`docs/assets/fontawesome/` (css plus the solid, brands and regular woff2 cuts, attribution in
`NOTICE.txt`) and the four coin marks sit in `docs/assets/coins/`. Previously the stylesheet came from
`cdnjs.cloudflare.com` and the coins from `cryptoicon.io`, which meant a visitor's IP reached both
hosts and the page broke without network.

Licence: SIL Open Font License 1.1, `Copyright 2026 The Geist Project Authors`
(<https://github.com/vercel/geist-font>); the full text ships as `public/fonts/OFL.txt`.

## Theme

The UI chrome has three modes, picked in **Settings → Theme**:

| Value | Behaviour |
| --- | --- |
| `system` (default) | Follows the OS `prefers-color-scheme`, and keeps following it live — changing the system appearance repaints OVO without a reload. |
| `light` | Pins the light palette, whatever the OS says. |
| `dark` | Pins the dark palette, whatever the OS says. |

The palette is a set of CSS custom properties in `src/styles/index.css`: dark values on `:root`
(the defaults), light values in `:root[data-theme='light']`. Every sidebar, info-panel, button,
select and modal colour reads a `--ovo-*` variable, so both palettes come from one stylesheet.
`color-scheme` is set alongside each palette so native widgets (select popups, scrollbars) follow.

`src/theme.ts` only decides which palette is active: `resolveTheme()` maps the mode to `light` or
`dark`, and `applyTheme()` writes two attributes on `<html>` — `data-theme` (the resolved palette)
and `data-theme-mode` (what the user picked). While the mode is `system`, `watchSystemTheme()`
subscribes to the `prefers-color-scheme: light` media query and re-applies on change. The choice
lives in the store as `themeMode` and is applied by an effect in `App.tsx`; like every other UI
toggle it resets on reload — OVO keeps only the camera view and the selected agent across sessions.

Two details worth knowing:

- The canvas office art is **not** themed. It is pixel art drawn once into textures, so it keeps its
  own day/night look; the light palette is a warm paper tone (`--ovo-bg: #f4f1ea`) chosen so the
  frosted sidebar still reads as an overlay on top of that unchanged scene.
- `index.html` carries a small inline script that sets `data-theme` from the OS **before** React
  mounts, so a light desktop never flashes the dark defaults. It is kept in sync with `src/theme.ts`
  by hand, and its `theme-color` metas are split per `prefers-color-scheme` for the browser UI.
