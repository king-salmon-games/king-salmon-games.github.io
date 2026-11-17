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
| `water-surface.js` | WebGL setup, responsive landscape framing, frame budget, and fallback selection |
| `assets/river-scene/water.frag` | Signed distance field for the sheets and pool, refraction, crest foam, and spray |
| `assets/river-scene/` | Desktop and portrait waterfall films, still backgrounds, a looping audio track, and the landscape art record |
| `interior.css` | Project pages, wishlist, support, privacy, and custom 404 layouts |
| `wumbos.html`, `creamcheese.html`, `pocketlink.html`, `nemus-obscurum.html`, `kakatta.html` | Individual project information, approved artwork, and wishlist links |
| `wishlist.html`, `wishlist.js` | Select games and prepare an email signup request |
| `support.html`, `privacy.html` | Studio contact information, game support, and privacy terms |

## Waterfall

The homepage draws moving water over the forest artwork with WebGL. The fragment shader traces short viewing rays toward a signed distance field that describes a bent sheet of water. Its slope determines how the surface refracts the landscape and reflects the sky. The falling curtains accelerate down the ledges, while the pool has broader waves that spread from the impact zone. A three-channel mask confines the sheet, brook, and spray effects to their corresponding areas.

The renderer targets 30 frames per second and reduces its internal resolution under sustained load. A six-second video supplies immediate motion during startup and takes over if WebGL is unavailable, interrupted, or too slow. The separate ambience track continues through these changes. Sound starts on arrival where audible autoplay is allowed, or on the first tap, click, or keypress when the browser requires interaction.

The full landscape is `assets/river-scene/river-desktop.webp` (1717 × 916). The portrait crop uses columns 820–1552. To edit the water boundaries, update [the mask generator](tools/build_water_mask.py) and run `python tools/build_water_mask.py`. It produces `assets/river-scene/water-mask.png`. The [video renderer](tools/render_river.py) encodes the two fallback films. Both tools document their optional dependencies in `--help`.

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
