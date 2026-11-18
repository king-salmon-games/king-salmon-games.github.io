#!/usr/bin/env python3
"""Check the homepage's suspended-frame recovery against a running local preview.

Install Python Playwright and run `playwright install chromium`, or select an
installed Chrome with `python tools/check_river_resume.py --browser-channel chrome`.
"""

import argparse

from playwright.sync_api import sync_playwright


# Keep the browser's real scheduling until the test simulates discarded callbacks.
# Observe the time actually submitted to the GPU and the frame copied from the film.
PROBE = """(() => {
  const pending = new Set();
  const probe = window.riverProbe = { gpuTime: 0, poolTime: 0 };
  function track(owner, request, cancel) {
    const schedule = owner[request];
    owner[request] = function(callback) {
      const discard = () => this[cancel](id);
      const id = schedule.call(this, (...args) => {
        pending.delete(discard);
        callback(...args);
      });
      pending.add(discard);
      return id;
    };
  }
  track(window, 'requestAnimationFrame', 'cancelAnimationFrame');
  track(HTMLVideoElement.prototype, 'requestVideoFrameCallback', 'cancelVideoFrameCallback');
  probe.discard = () => {
    for (const cancel of pending) cancel();
    pending.clear();
  };
  const gl = WebGLRenderingContext.prototype;
  const locate = gl.getUniformLocation, set = gl.uniform1f;
  const clocks = new WeakSet();
  gl.getUniformLocation = function(program, name) {
    const location = locate.call(this, program, name);
    if (location && name === 'uTime') clocks.add(location);
    return location;
  };
  gl.uniform1f = function(location, value) {
    if (clocks.has(location)) probe.gpuTime = value;
    return set.call(this, location, value);
  };
  const canvas = CanvasRenderingContext2D.prototype, draw = canvas.drawImage;
  canvas.drawImage = function(image, ...args) {
    const result = draw.call(this, image, ...args);
    if (this.canvas.matches('.film-pool')) probe.poolTime = image.currentTime;
    return result;
  };
})();"""


def check(browser, url, mobile):
    context = browser.new_context(
        viewport={"width": 390 if mobile else 1024, "height": 800},
        is_mobile=mobile, has_touch=mobile,
    )
    clock = "riverProbe.poolTime" if mobile else "riverProbe.gpuTime"
    page = context.new_page()
    try:
        page.add_init_script(PROBE)
        page.goto(url)
        page.evaluate("scrollTo({top: 112, behavior: 'instant'})")
        page.wait_for_function(f"{clock} > 0", timeout=30_000)
        identity = page.evaluate("[performance.timeOrigin, scrollY]")
        assert identity[1] == 112

        # Run the fault after pageshow to cover callbacks discarded late in a restore.
        page.evaluate("""async () => {
          window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
          await new Promise(resolve => setTimeout(resolve, 150));
          riverProbe.discard();
        }""")
        after_fault = page.evaluate(clock)
        page.wait_for_function(f"time => {clock} > time + 0.15", arg=after_fault,
                               polling=100, timeout=6_000)

        if mobile:
            page.evaluate("""async () => {
              window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
              await new Promise(resolve => setTimeout(resolve, 150));
              document.querySelector('video').pause();
            }""")
            paused_at = page.evaluate("document.querySelector('video').currentTime")
            page.wait_for_function("time => !document.querySelector('video').paused && "
                                   "riverProbe.poolTime > time + 0.15",
                                   arg=paused_at, polling=100, timeout=6_000)

        assert page.evaluate("[performance.timeOrigin, scrollY]") == identity
        assert page.evaluate("document.querySelector('video').muted")
        print(f"{'Touch film' if mobile else 'Desktop GPU'} resumed at the original scroll position.")
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--browser-channel", help="Use an installed Chromium channel, e.g. chrome.")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.browser_channel, args=["--enable-unsafe-swiftshader"])
        try:
            for mobile in (False, True):
                check(browser, args.url, mobile)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
