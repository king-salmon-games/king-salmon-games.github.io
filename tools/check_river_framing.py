#!/usr/bin/env python3
"""Check river framing on a running preview with Python Playwright and Chromium.

For installed Chrome, run python tools/check_river_framing.py --browser-channel chrome.
"""

import argparse

from playwright.sync_api import sync_playwright

# Read the crop actually submitted to the last onscreen WebGL pass. The native
# film is independently measured from the fitted frame's four corners.
MEASURE = """() => {
  const hero = document.querySelector('.river-hero').getBoundingClientRect();
  const film = document.querySelector('.film-frame').getBoundingClientRect();
  const cta = document.querySelector('.explore-link').getBoundingClientRect();
  const canvas = document.querySelector('[data-water-surface]');
  if (!canvas.matches('[data-ready], [data-water-layer]')) return null;
  const gl = canvas.getContext('webgl');
  const program = gl.getParameter(gl.CURRENT_PROGRAM);
  if (!program) return null;
  const gpu = gl.getUniform(program, gl.getUniformLocation(program, 'uCrop'));
  const phone = matchMedia('(max-width: 680px)').matches;
  const left = phone ? 820 : 0, width = phone ? 733 : 1717;
  const errorX = Math.abs(film.left + (gpu[0] * 1717 - left) / width * film.width - hero.left);
  const errorY = Math.abs(film.bottom - gpu[1] * film.height - hero.bottom);
  const errorW = Math.abs(gpu[2] * 1717 / width * film.width - hero.width);
  const errorH = Math.abs(gpu[3] * film.height - hero.height);
  // Row 704 in the 1717 × 916 source is the foot of the main falls.
  const waterline = film.top + film.height * 704 / 916;
  return {
    cropError: Math.max(errorX, errorY, errorW, errorH),
    pool: Math.min(hero.bottom, innerHeight) - waterline,
    heroHeight: hero.height,
    ctaFits: cta.top >= Math.max(hero.top, 0) && cta.bottom <= Math.min(hero.bottom, innerHeight)
      && cta.left >= 0 && cta.right <= document.documentElement.clientWidth,
    sourceTop: (hero.top - film.top) * 916 / film.height,
    sourceBottom: (hero.bottom - film.top) * 916 / film.height
  };
}"""


def check(page, width, height, full_height=False):
    page.set_viewport_size({"width": width, "height": height})
    # ResizeObserver schedules the GPU crop for the next presented scene frame.
    page.wait_for_function(f"() => {{ const m = ({MEASURE})(); return m && m.cropError < 2; }}",
                           timeout=30_000)
    result = page.evaluate(MEASURE)
    assert result["pool"] >= .15 * result["heroHeight"], f"Too little foreground at {width}×{height}: {result}"
    assert result["ctaFits"], f"Explore games is clipped at {width}×{height}: {result}"
    if full_height:
        assert abs(result["sourceTop"]) < 2 and abs(result["sourceBottom"] - 916) < 2, result
    print(f"{width}×{height}: {result['pool']:.0f} CSS pixels of pool, "
          f"{result['cropError']:.2f}px camera mismatch.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--browser-channel", help="Use an installed Chromium channel, e.g. chrome.")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.browser_channel, args=["--enable-unsafe-swiftshader"])
        try:
            desktop = browser.new_page(viewport={"width": 1536, "height": 730})
            desktop.goto(args.url)
            check(desktop, 1536, 730)
            check(desktop, 1200, 960, full_height=True)
            check(desktop, 1366, 650)
            desktop.close()
            phone = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            phone.goto(args.url)
            check(phone, 390, 844, full_height=True)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
