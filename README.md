# King Salmon Games website

Static studio website for [kingsalmongames.com](https://kingsalmongames.com), hosted with GitHub Pages. The homepage introduces Wumbos, Cream Cheese × Phone, PocketLink, Nemus Obscurum, and Kakatta.

## Local preview

Run a static HTTP server from this directory, then open the printed local address:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/>. The site uses plain HTML and CSS, with a small browser script for the wishlist picker. There is no build step, server runtime, analytics, cookies, or form backend.

## Content

- `index.html`: studio introduction, five-project gallery, wishlist invitation, studio information, and contact.
- `wumbos.html`: Wumbos feature overview and email wishlist link.
- `creamcheese.html`, `pocketlink.html`, `nemus-obscurum.html`, `kakatta.html`: concise project overviews and matching wishlist links.
- `wishlist.html`, `wishlist.js`: select one, several, or all projects and prepare an email signup request. A project link preselects its game via `?game=<slug>`; `?game=all` selects all five. Repeated `game` parameters are supported. Unknown values are ignored.
- `support.html`: support for the studio's games, including clearly identified Wumbos-specific instructions.
- `privacy.html`: website, email wishlist, and Wumbos privacy notice. Its Wumbos data-handling statements do not describe the other games.
- `styles.css`: shared responsive styles for the homepage, game details, and utility pages.
- `assets/`: locally hosted artwork and studio branding.

Keep game descriptions grounded in the corresponding project. Add store or public playtest buttons only after their destinations are verified; email inquiries use the studio's existing contact address. When adding a page, update its canonical URL and `sitemap.xml`. Update the stylesheet version in each HTML file when changing shared styles.

## Navigation

All five projects have clickable artwork, linked titles, detail pages, and matching wishlist links. Navigation uses ordinary page links and URL fragments, including the legacy Wumbos fragments. Descriptions and detail-page navigation work without JavaScript.

The wishlist picker prepares a `mailto:` message to the studio's existing address. Visitors must send that message to join; the site never claims an email was sent or a signup completed. A copyable message supports webmail, and direct email remains available without JavaScript. Selections are not persisted or transmitted by the site. Incoming wishlist requests are handled through the studio inbox.

CreamFly is linked from both the homepage Cream Cheese section and its detail page. Its verified URL is `https://creamfly.kingsalmongames.chatgpt.site`; its existing invited-access policy is unchanged and disclosed next to the link.

## Artwork sources

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
