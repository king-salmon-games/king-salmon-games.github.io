# King Salmon Games website

Static studio website for [kingsalmongames.com](https://kingsalmongames.com), hosted with GitHub Pages. The homepage introduces Wumbos, Cream Cheese × Phone, PocketLink, Nemus Obscurum, and Kakatta.

## Work on the site locally

From the checkout directory on Windows, start the preview with this command.

```powershell
py -m http.server 4173 --bind 127.0.0.1
```

On macOS or Linux, use `python3` in place of `py`. Open [the local site](http://127.0.0.1:4173/). Edit a file and refresh the page to see the change. Press Ctrl+C in the serving terminal to stop it.

The website ships plain HTML, CSS, JavaScript, and local assets. Ordinary editing requires only a static server and a browser.

## Where to edit

| File | Purpose |
| --- | --- |
| `index.html` | Homepage, game collection order and links, studio introduction, and contact |
| `styles.css` | Shared navigation, local fonts, colors, homepage layout, and responsive styles |
| `site.js` | Mobile menu, swipeable game collection, ambience, and fallback video playback |
| `water-surface.js` | Responsive landscape framing, frame budget, and fallback selection |
| `river-scene.js` | WebGL renderer shared by the homepage and the film encoder |
| `assets/river-scene/water.frag` | Falling sheets, simulated pool surface, reflections, foam, and spray |
| `assets/river-scene/weather.frag` | Volumetric clouds, valley mist, and wind in the trees |
| `assets/river-scene/wind.glsl` | Shared gust direction, timing, and cloud travel |
| `assets/river-scene/` | Desktop and portrait waterfall films, still backgrounds, a looping audio track, and the landscape art record |
| `interior.css` | Project pages, wishlist, support, privacy, and custom 404 layouts |
| `wumbos.html`, `creamcheese.html`, `pocketlink.html`, `nemus-obscurum.html`, `kakatta.html` | Individual project information, approved artwork, and wishlist links |
| `wishlist.html`, `wishlist.js` | Select games and prepare an email signup request |
| `support.html`, `privacy.html` | Studio contact information, game support, and privacy terms |

## Waterfall

The falls accelerate over the ledges and thin as they drop. A signed distance field describes the folded sheets so the shader can trace their surfaces and calculate how they transmit and scatter light. Below the falls, an offline shallow-water simulation drives waves and foam around the rock banks. The water runs at half speed, so the pool's 64 simulated frames play over 16 seconds. The browser adds fine ripples and reflects the moving sky.

The sky shader traces rays through a wind-driven, three-dimensional cloud layer. It samples density toward the sun to shade cloud interiors and edges. The same wind bends the fir crowns, while a lower band of mist drifts across the valley.

Touch-first devices play a 30 fps film rendered from the same water and weather shaders. Its 48-second loop spans a complete cloud cycle. Each crop opens with a still from the first decoded frame. The desktop film is 1600 × 854 and the portrait film is 720 × 900.

On desktop, WebGL takes over at the film's current playhead and targets 30 fps. It repaints the full landscape whenever the drawing buffer changes size and limits the simulation step after a dropped frame. The film also covers GPU interruptions and sustained slow rendering. On touch devices WebGL can take over if video playback fails. The separate ambience starts on arrival where audible autoplay is allowed, or on the first tap, click, or keypress when the browser requires interaction.

The original landscape is `assets/river-scene/river-desktop.webp` (1717 × 916). The portrait crop uses columns 820–1552. From the checkout root, rebuild the assets affected by your edits.

| Change | Command | Offline dependencies |
| --- | --- | --- |
| Water boundaries | `python tools/build_water_mask.py`, then rebake the pool | NumPy, OpenCV |
| Pool dynamics and foam | `python tools/bake_water_dynamics.py` | NumPy, Numba, Pillow |
| Sky boundary, canopy, mist, or cloud volume | `python tools/build_weather.py` | NumPy, Pillow |
| Films and opening stills after changing a shader or its inputs | `python tools/render_river.py --browser-channel chrome --output-dir assets/river-scene` | Python Playwright, Chrome with WebGL, FFmpeg with libx264 and libwebp |

For Playwright's bundled Chromium, install it with `python -m playwright install chromium` and omit `--browser-channel chrome`.

## Navigation

All five projects have clickable artwork, linked titles, detail pages, and matching wishlist links. Navigation uses ordinary page links and URL fragments, including the legacy Wumbos fragments. Descriptions and detail-page navigation work without JavaScript.

The wishlist picker prepares a `mailto:` message to the studio's existing address. Visitors must send that message to join; the site never claims an email was sent or a signup completed. A copyable message supports webmail, and direct email remains available without JavaScript. Selections are not persisted or transmitted by the site. Incoming wishlist requests are handled through the studio inbox.

CreamFly is linked from both the homepage Cream Cheese section and its detail page. Its verified URL is `https://creamfly.kingsalmongames.chatgpt.site`; its existing invited-access policy is unchanged and disclosed next to the link.

## Artwork sources

The river landscape was created with built-in ImageGen. The [art record](assets/river-scene/artwork.json) includes the full landscape prompt and the filenames used by the site. Barlow Condensed and DM Sans are self-hosted with their licenses in `assets/fonts/`.

The game imagery reuses artwork and development captures from the studio's source repositories. The copied opaque PNGs were encoded as JPEG at quality 86, preserving their dimensions and reducing the delivery files by about 80%. The transparent Cream Cheese × Phone wordmark remains PNG.

| Website asset | Source repository and path |
| --- | --- |
| `creamcheese-character.jpg` | `creamcheese`: `game/Assets/Resources/Art/AppIcon.png` |
| `creamcheese-wordmark.png` | `creamcheese`: `game/Assets/Resources/Art/TitleWordmark.png` |
| `creamcheese-gameplay.jpg` | `creamcheese`: `artifacts/campaign-qa/puzzle-area-1-390x844-normal-view-1.png` |
| `pocketlink-artwork.jpg` | `link-party`: `ios/LinkPartyApp/Assets.xcassets/AppIcon.appiconset/PocketLink-1024-v5.png` |
| `nemus-app-icon.jpg` | New dark forest icon, created with built-in image generation; prompt and provenance in `assets/icon-provenance.json` |
| `kakatta-app-icon.jpg` | `kakatta`: `game/Assets/ExternalForge/Branding/KakattaAppIcon.png`; approved source hash in `art/app-icon-provenance.json` |

Existing Wumbos artwork and the crowned-salmon branding are retained. Nemus uses only its forest icon and spoiler-light copy reflecting platforming that develops into simulation and strategy. Earlier Nemus screenshots remain in the repository but are not linked from the site. No new gameplay footage is published. The site identifies app icons and promotional artwork as such.

## Publishing

Changes pushed to the `main` branch are published through GitHub Pages. The custom domain is declared in `CNAME`.
