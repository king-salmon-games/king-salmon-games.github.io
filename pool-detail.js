// The native film carries two renders of the same pool at each timestamp.
// Present its detailed strip over the matching water in the visible frame.
export function setupPoolDetail(hero, film, surface) {
  const layer = hero.querySelector('.film-pool');
  const overlay = hero.querySelector('.hero-overlay');
  const explore = overlay.querySelector('.explore-link');
  const portrait = matchMedia('(max-width: 680px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cssTimeline = CSS.supports('animation-timeline: scroll(root block)') &&
                      CSS.supports('animation-range: 0px 216px');
  const videoFrames = typeof film.requestVideoFrameCallback === 'function';
  let context;
  let distance, filmWidth, baseHeight, stripHeight, packedHeight;
  let detail = 0;
  let visible = true;
  let scrollFrame = 0;
  let pending = null;
  let lastTime = -1;

  function stopCopy() {
    if (pending === null) return;
    if (videoFrames) film.cancelVideoFrameCallback(pending);
    else cancelAnimationFrame(pending);
    pending = null;
  }

  function needsStrip() {
    // WebKit can expose a scaled decoded frame. Check its aspect ratio and
    // use normalized source rows so both the native and scaled raster align.
    return detail > 0 && visible && !document.hidden && !surface.hasAttribute('data-ready') &&
      !film.seeking && film.readyState >= 2 && film.videoWidth > 0 &&
      Math.abs(film.videoHeight - film.videoWidth * packedHeight / filmWidth) <= 2;
  }

  function copyFrame(time) {
    if (time === lastTime) return;
    context ??= layer.getContext('2d', { alpha: false });
    if (!context) return;
    if (layer.width !== filmWidth || layer.height !== stripHeight) {
      layer.width = filmWidth;
      layer.height = stripHeight;
    }
    const sourceHeight = stripHeight * film.videoHeight / packedHeight;
    context.drawImage(film, 0, film.videoHeight - sourceHeight, film.videoWidth, sourceHeight,
                      0, 0, filmWidth, stripHeight);
    lastTime = time;
    layer.toggleAttribute('data-frame', true);
  }

  function nextFrame(now, metadata) {
    pending = null;
    if (!needsStrip()) return;
    copyFrame(metadata ? metadata.mediaTime : film.currentTime);
    if (!film.paused) scheduleCopy();
  }

  function scheduleCopy() {
    pending = videoFrames ? film.requestVideoFrameCallback(nextFrame) : requestAnimationFrame(nextFrame);
  }

  function syncCopy() {
    if (!needsStrip()) {
      stopCopy();
      layer.removeAttribute('data-frame');
      lastTime = -1;
    } else if (film.paused) {
      stopCopy();
      copyFrame(film.currentTime);
    } else if (pending === null) {
      copyFrame(film.currentTime);
      scheduleCopy();
    }
  }

  function readScroll() {
    scrollFrame = 0;
    const t = Math.min(1, Math.max(0, window.scrollY / distance));
    detail = t * t * (3 - 2 * t);
    if (!cssTimeline) {
      overlay.style.opacity = reduced.matches ? '' : String(1 - detail);
      explore.style.visibility = !reduced.matches && t === 1 ? 'hidden' : '';
    }
    if (!cssTimeline || reduced.matches) layer.style.opacity = String(detail);
    else if (layer.style.opacity) layer.style.removeProperty('opacity');
    syncCopy();
  }

  function configure() {
    const style = getComputedStyle(film.parentElement);
    distance = parseFloat(style.getPropertyValue('--fade-distance'));
    filmWidth = Number(style.getPropertyValue('--film-width'));
    baseHeight = Number(style.getPropertyValue('--film-height'));
    stripHeight = Number(style.getPropertyValue('--strip-height'));
    // The encoder starts the strip on the next H.264 macroblock boundary.
    packedHeight = Math.ceil(baseHeight / 16) * 16 + stripHeight;
    readScroll();
  }
  if (!CSS.supports('width: 1cqh')) {
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const coverWidth = Math.max(width, height * filmWidth / baseHeight);
      film.parentElement.style.setProperty('--film-cover-width', coverWidth + 'px');
    }).observe(hero);
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncCopy();
  }).observe(hero);
  window.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(readScroll);
  }, { passive: true });
  for (const event of ['loadeddata', 'emptied', 'playing', 'pause', 'seeking', 'seeked', 'error']) {
    film.addEventListener(event, syncCopy);
  }
  surface.addEventListener('water-renderer-change', syncCopy);
  document.addEventListener('visibilitychange', syncCopy);
  portrait.addEventListener('change', configure);
  reduced.addEventListener('change', readScroll);
  window.addEventListener('pageshow', configure);
  configure();
  return () => detail;
}
