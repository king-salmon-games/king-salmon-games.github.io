import { createRiverScene, landscape, openSceneContext, sceneStartTime } from './river-scene.js?v=1';

(() => {
  const canvas = document.querySelector('[data-water-surface]');
  if (!canvas) return;

  const hero = canvas.closest('.river-hero');
  const film = hero.querySelector('[data-river-water]');
  const portrait = window.matchMedia('(max-width: 680px)');
  let gl;
  try {
    gl = openSceneContext(canvas);
  } catch {
    // Browser privacy settings can prevent context creation.
    return;
  }
  if (!gl) return;

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
  const start = performance.now();

  function showSurface(ready) {
    if (canvas.hasAttribute('data-ready') === ready) return;
    if (!ready && film && Number.isFinite(film.duration) && film.duration > 0) {
      film.currentTime = ((performance.now() - start) / 1000) % film.duration;
    }
    canvas.toggleAttribute('data-ready', ready);
    canvas.dispatchEvent(new Event('water-renderer-change'));
  }

  function resize() {
    if (retired || !scene) return;
    const { width, height } = hero.getBoundingClientRect();
    if (width < 1 || height < 1) return;

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
    if (now + 0.5 < nextFrame) return;
    nextFrame = Math.max(now, nextFrame) + frameInterval;
    if (gl.isContextLost()) return;
    try {
      scene.render(sceneStartTime + (now - start) / 1000, crop);
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
      resize();
    } else {
      useFilm();
    }
  }

  function syncFrames() {
    cancelAnimationFrame(frame);
    frame = 0;
    nextFrame = 0;
    sampleStart = 0;
    samples = 0;
    slowWindows = 0;
    if (!retired && scene && onScreen && !document.hidden) frame = requestAnimationFrame(draw);
  }

  async function initialize() {
    const attempt = ++generation;
    const isCurrent = () => !retired && attempt === generation && !gl.isContextLost();
    try {
      const renderer = await createRiverScene(gl, isCurrent);
      if (!renderer || !isCurrent()) return;
      scene = renderer;
      resize();
      syncFrames();
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('River film selected:', error.message);
      useFilm();
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(hero);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncFrames();
  });
  visibilityObserver.observe(hero);
  document.addEventListener('visibilitychange', syncFrames);
  portrait.addEventListener('change', resize);
  canvas.addEventListener('webglcontextlost', event => {
    if (retired) return;
    event.preventDefault();
    generation++;
    scene = null;
    syncFrames();
    showSurface(false);
  });
  canvas.addEventListener('webglcontextrestored', initialize);
  initialize();
})();
