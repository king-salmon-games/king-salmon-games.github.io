import { setupPoolDetail } from './pool-detail.js?v=3';

async function startLiveScene(canvas, poolDetail) {
  const hero = canvas.closest('.river-hero');
  const film = hero.querySelector('[data-river-water]');
  const portrait = window.matchMedia('(max-width: 680px)');
  let engine;
  let gl;
  try {
    engine = await import('./river-scene.js?v=6');
    gl = engine.openSceneContext(canvas);
  } catch {
    // The film also covers module loading failures and blocked GPU contexts.
    return;
  }
  if (!gl) return;
  const { createRiverScene, landscape, sceneStartTime } = engine;

  const frameInterval = 1000 / 30;
  const crop = new Float32Array(4);
  let scene;
  let generation = 0;
  let frame = 0;
  let nextFrame = 0;
  let onScreen = true;
  let retired = false;
  let quality = 1;
  let sampleStart = 0;
  let samples = 0;
  let slowWindows = 0;
  let needsResize = true;
  let previousDraw = null;
  let sceneTime = sceneStartTime;

  function showSurface(ready) {
    if (canvas.hasAttribute('data-ready') === ready) return;
    if (!ready && film && Number.isFinite(film.duration) && film.duration > 0) {
      film.currentTime = (sceneTime - sceneStartTime) % film.duration;
    }
    canvas.toggleAttribute('data-ready', ready);
    canvas.dispatchEvent(new Event('water-renderer-change'));
  }

  function requestResize() {
    needsResize = true;
  }

  function resize() {
    const { width, height } = hero.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    needsResize = false;

    const pixelBudget = portrait.matches ? 480000 : 980000;
    const density = Math.min(window.devicePixelRatio || 1, 1.6, Math.sqrt(pixelBudget / (width * height)));
    const w = Math.max(1, Math.round(width * density * quality));
    const h = Math.max(1, Math.round(height * density * quality));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    // Match the CSS picture's centered object-fit: cover, including its mobile crop.
    const sourceWidth = portrait.matches ? landscape.portraitWidth : landscape.width;
    const sourceLeft = portrait.matches ? landscape.portraitLeft : 0;
    const scale = Math.max(width / sourceWidth, height / landscape.height);
    const visibleWidth = width / scale;
    const visibleHeight = height / scale;
    crop[0] = (sourceLeft + (sourceWidth - visibleWidth) / 2) / landscape.width;
    crop[1] = (1 - visibleHeight / landscape.height) * (portrait.matches ? 0.5 : 0.68);
    crop[2] = visibleWidth / landscape.width;
    crop[3] = visibleHeight / landscape.height;
  }

  function useFilm() {
    retired = true;
    scene = null;
    cancelAnimationFrame(frame);
    frame = 0;
    showSurface(false);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (!nextFrame) nextFrame = now;
    if (now + 0.5 < nextFrame) return;
    nextFrame += (1 + Math.floor((now + 0.5 - nextFrame) / frameInterval)) * frameInterval;
    if (gl.isContextLost()) {
      contextLost();
      return;
    }
    if (!canvas.hasAttribute('data-ready')) {
      // Start at the frame the visitor can see, even after a slow startup.
      if (film.readyState >= 2 && !film.seeking) sceneTime = sceneStartTime + film.currentTime;
    } else if (previousDraw !== null) {
      // A stalled browser should resume the wind without skipping through it.
      sceneTime += Math.min(now - previousDraw, 2 * frameInterval) / 1000;
    }
    previousDraw = now;
    try {
      // Resizing clears the drawing buffer. Change it only inside a draw and
      // submit the entire opaque landscape before returning to the compositor.
      if (needsResize) resize();
      if (needsResize) return;
      scene.render(sceneTime, crop, true, poolDetail());
    } catch {
      // A GPU reset can invalidate the framebuffer before the loss event is
      // delivered. Let the event handlers rebuild it when the context returns.
      if (!gl.isContextLost()) useFilm();
      return;
    }
    if (!canvas.hasAttribute('data-ready')) {
      const error = gl.getError();
      if (gl.isContextLost() || error === gl.CONTEXT_LOST_WEBGL) return;
      if (error !== gl.NO_ERROR) { useFilm(); return; }
      showSurface(true);
    }

    // Measure sustained delivery, excluding start-up and time spent offscreen.
    if (!sampleStart) sampleStart = now;
    samples++;
    const elapsed = now - sampleStart;
    if (elapsed < 2400) return;
    const fps = samples * 1000 / elapsed;
    samples = 0;
    sampleStart = now;
    slowWindows = fps < 21 ? slowWindows + 1 : 0;
    if (slowWindows < 2) return;
    slowWindows = 0;
    if (quality > 0.56) {
      quality = Math.max(0.55, quality * 0.74);
      requestResize();
    } else {
      useFilm();
    }
  }

  function syncFrames() {
    cancelAnimationFrame(frame);
    frame = 0;
    nextFrame = 0;
    previousDraw = null;
    sampleStart = 0;
    samples = 0;
    slowWindows = 0;
    if (!retired && scene && onScreen && !document.hidden && !hero.hasAttribute('data-suspended')) {
      frame = requestAnimationFrame(draw);
    }
  }

  async function initialize() {
    const attempt = ++generation;
    const isCurrent = () => !retired && attempt === generation && !gl.isContextLost();
    try {
      const renderer = await createRiverScene(gl, isCurrent);
      if (!renderer || !isCurrent()) return;
      scene = renderer;
      requestResize();
      syncFrames();
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('River film selected:', error.message);
      useFilm();
    }
  }

  const resizeObserver = new ResizeObserver(requestResize);
  resizeObserver.observe(hero);
  const visibilityObserver = new IntersectionObserver(entries => {
    onScreen = entries[entries.length - 1].isIntersecting;
    syncFrames();
  });
  visibilityObserver.observe(hero);
  function syncViewport() {
    if (retired) return;
    if (!hero.hasAttribute('data-suspended')) {
      // Intersection and queued animation callbacks can both be stale on return.
      const bounds = hero.getBoundingClientRect();
      onScreen = bounds.bottom > 0 && bounds.top < document.documentElement.clientHeight;
      requestResize();
      if (gl.isContextLost()) {
        contextLost();
        return;
      }
    }
    syncFrames();
  }
  hero.addEventListener('river-lifecycle-change', syncViewport);
  hero.addEventListener('river-check-frames', () => {
    if (scene && (previousDraw === null || performance.now() - previousDraw > 500)) syncViewport();
  });
  portrait.addEventListener('change', requestResize);
  function contextLost() {
    generation++;
    scene = null;
    syncFrames();
    showSurface(false);
  }
  canvas.addEventListener('webglcontextlost', event => {
    if (retired) return;
    event.preventDefault();
    contextLost();
  });
  canvas.addEventListener('webglcontextrestored', initialize);
  initialize();
}

const canvas = document.querySelector('[data-water-surface]');
if (canvas) {
  const hero = canvas.closest('.river-hero');
  const film = hero.querySelector('[data-river-water]');
  const poolDetail = setupPoolDetail(hero, film, canvas);
  // On a touch-first screen the decoder presents the authored scene on its own
  // clock throughout a gesture, including while a finger is held on the glass.
  if (matchMedia('(pointer: coarse)').matches && !film.error && !film.hasAttribute('data-needs-renderer')) {
    film.addEventListener('river-video-unavailable', () => startLiveScene(canvas, poolDetail), { once: true });
  } else {
    startLiveScene(canvas, poolDetail);
  }
}
