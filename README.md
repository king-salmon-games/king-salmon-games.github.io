# King Salmon Games website

Static studio website for [kingsalmongames.com](https://kingsalmongames.com), hosted with GitHub Pages. The homepage introduces WUMBOS, Cream Cheese × Phone, PocketLink, and Nemus Obscurum.

## Local preview

Run a static HTTP server from this directory, then open the printed local address:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/>. The site uses plain HTML and CSS with no build step, analytics, cookies, or form backend.

## Content

- `index.html`: studio introduction, four-game lineup, studio information, and contact.
- `wumbos.html`: the existing WUMBOS feature overview and playtesting contact.
- `support.html`: support for the studio's games, including clearly identified WUMBOS-specific instructions.
- `privacy.html`: the existing website and WUMBOS privacy notice. Its WUMBOS data-handling statements do not describe the other games.
- `styles.css`: shared responsive styles for the homepage, game details, and utility pages.
- `assets/`: locally hosted artwork and studio branding.

Keep game descriptions grounded in the corresponding project. Add store or public playtest buttons only after their destinations are verified; email inquiries use the studio's existing contact address. When adding a page, update its canonical URL and `sitemap.xml`. Update the stylesheet version in each HTML file when changing shared styles.

## Artwork sources

The multi-project redesign reuses artwork and development captures from the studio's source repositories. No new AI artwork was generated. The copied opaque PNGs were encoded as JPEG at quality 86, preserving their dimensions and reducing the delivery files by about 80%. The transparent Cream Cheese × Phone wordmark remains PNG.

| Website asset | Source repository and path |
| --- | --- |
| `creamcheese-character.jpg` | `creamcheese`: `game/Assets/Resources/Art/AppIcon.png` |
| `creamcheese-wordmark.png` | `creamcheese`: `game/Assets/Resources/Art/TitleWordmark.png` |
| `creamcheese-gameplay.jpg` | `creamcheese`: `artifacts/campaign-qa/puzzle-area-1-390x844-normal-view-1.png` |
| `pocketlink-artwork.jpg` | `link-party`: `ios/LinkPartyApp/Assets.xcassets/AppIcon.appiconset/PocketLink-1024-v5.png` |
| `nemus-species.jpg` | `nemus-obscurum`: `docs/images/homeworld-species.png` |
| `nemus-homeworld.jpg` | `nemus-obscurum`: `docs/images/homeworld-water.png` |
| `nemus-orbit.jpg` | `nemus-obscurum`: `docs/images/presentation-homeworld.png` |

Existing WUMBOS artwork and the crowned-salmon branding are retained. The site labels development captures and promotional artwork separately.

## Publishing

Changes pushed to the `main` branch are published through GitHub Pages. The custom domain is declared in `CNAME`.
