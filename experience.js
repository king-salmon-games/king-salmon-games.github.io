/* King Salmon Games — local, dependency-free progressive enhancement.
   Game discovery works as ordinary anchor navigation without this script. */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionAllowed = !reducedMotion.matches;
  const worlds = document.querySelector('.worlds');
  const tabList = document.querySelector('.world-tabs');
  const tabs = Array.from(document.querySelectorAll('.world-tab'));
  const panels = tabs.map(tab => document.getElementById(tab.dataset.world));
  const nextButton = document.querySelector('.next-world');
  const announcement = document.getElementById('world-announcement');
  let selected = 0;

  // Keep every project and its original fragments addressable, including old
  // links into the WUMBOS story. A failed graphics enhancement cannot hide them.
  if (worlds && tabList && tabs.length && panels.every(Boolean)) {
    const names = tabs.map(tab => tab.querySelector('.world-tab-name').textContent);
    const legacyFragments = ['trade', 'manipulate', 'survive', 'customize'];
    const warmedPanels = new Set();

    function warmPanel(index) {
      if (warmedPanels.has(index)) return;
      warmedPanels.add(index);
      panels[index].querySelectorAll('img[loading="lazy"]').forEach(image => {
        image.loading = 'eager';
        // Decode hidden-panel artwork ahead of selection; failed images never
        // delay navigation or prevent the remaining story from being read.
        if (typeof image.decode === 'function') image.decode().catch(() => {});
      });
    }

    function indexForHash() {
      let id;
      try { id = decodeURIComponent(window.location.hash.slice(1)); }
      catch (_) { return -1; }
      if (legacyFragments.includes(id)) return 0;
      const target = document.getElementById(id);
      return panels.findIndex(panel => panel === target || (target && panel.contains(target)));
    }

    function selectWorld(index, options = {}) {
      selected = (index + tabs.length) % tabs.length;
      warmPanel(selected);
      tabs.forEach((tab, i) => {
        const active = i === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[i].hidden = !active;
      });
      worlds.dataset.world = panels[selected].id;
      if (nextButton) {
        nextButton.querySelector('span').textContent = `Next: ${names[(selected + 1) % tabs.length]}`;
      }
      if (options.announce && announcement) {
        announcement.textContent = `Showing ${names[selected]}, world ${selected + 1} of ${tabs.length}.`;
      }
      if (options.updateHash) {
        // Preserve browser history state owned by the browser or another script.
        try {
          const method = options.updateHash === 'push' ? 'pushState' : 'replaceState';
          if (window.location.hash !== `#${panels[selected].id}`) {
            window.history[method](window.history.state, '', `#${panels[selected].id}`);
          }
        }
        catch (_) { /* Selection remains usable where history is unavailable. */ }
      }
      if (options.focus) tabs[selected].focus({ preventScroll: true });
    }

    tabList.setAttribute('role', 'tablist');
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panels[index].id);
      panels[index].setAttribute('role', 'tabpanel');
      panels[index].setAttribute('aria-labelledby', tab.id);
      panels[index].tabIndex = 0;
      tab.addEventListener('pointerenter', () => warmPanel(index), { once: true });
      tab.addEventListener('focus', () => warmPanel(index), { once: true });
      tab.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        selectWorld(index, { updateHash: 'push', announce: true });
      });
      tab.addEventListener('keydown', event => {
        let next = index;
        if (event.key === 'ArrowRight') next += 1;
        else if (event.key === 'ArrowLeft') next -= 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === ' ') {
          event.preventDefault();
          selectWorld(index, { updateHash: 'push', announce: true });
          return;
        } else return;
        event.preventDefault();
        selectWorld(next, { updateHash: 'replace', announce: true, focus: true });
      });
    });

    const initialIndex = indexForHash();
    selectWorld(initialIndex >= 0 ? initialIndex : 0);
    worlds.dataset.enhanced = 'true';

    // Prepare the four nearby destinations before a visitor reaches the
    // selector. Artwork elsewhere retains its normal lazy-loading behavior.
    if ('IntersectionObserver' in window) {
      const artworkObserver = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        panels.forEach((_, index) => warmPanel(index));
        artworkObserver.disconnect();
      }, { rootMargin: '750px 0px' });
      artworkObserver.observe(tabList);
    }

    function revealHashTarget() {
      const index = indexForHash();
      if (index < 0) {
        // The unqualified page and game-directory URLs represent the default
        // first world, including when returning to them with browser Back.
        if (['', '#top', '#main', '#games'].includes(window.location.hash)) selectWorld(0);
        return;
      }
      selectWorld(index);
      // Hash navigation can initially target an element inside a hidden panel.
      // Scroll once, after revealing it, using the page's normal anchor behavior.
      requestAnimationFrame(() => {
        let target;
        try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); }
        catch (_) { return; }
        if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    }
    window.addEventListener('hashchange', revealHashTarget);
    if (initialIndex >= 0) revealHashTarget();
    if (nextButton) {
      nextButton.hidden = false;
      nextButton.addEventListener('click', () => {
        selectWorld(selected + 1, { updateHash: 'push', announce: true, focus: true });
        tabList.scrollIntoView({ block: 'start', behavior: motionAllowed ? 'smooth' : 'instant' });
      });
    }
  }

  const stage = document.querySelector('.current-stage');
  const canvas = document.getElementById('current-canvas');
  const motionButton = document.querySelector('.motion-toggle');
  if (!stage || !canvas || !motionButton) return;

  let context;
  try { context = canvas.getContext('2d', { alpha: true }); }
  catch (_) { return; }
  if (!context) return;

  const compact = window.matchMedia('(max-width: 760px)');
  const finePointer = window.matchMedia('(pointer: fine)');
  let visible = true;
  let pageActive = true;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let logicalScale = 1;
  let flowGradient;
  let mistGradient;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  let lineCount = 66;
  let pointCount = 140;
  const TAU = Math.PI * 2;

  function point(angle, layer, time) {
    const radius = 1 + .095 * Math.sin(angle * 3 + layer * 3 + time * .13)
      + .07 * Math.cos(angle * 2 - layer * 2 - time * .1);
    const x = (236 + layer * 94) * radius * Math.cos(angle);
    const y = (285 + layer * 97) * radius * Math.sin(angle);
    return [
      500 + x * .94 + y * .342 + 14 * Math.sin(angle * 2 + layer * 7 + time * .08) + pointerX * 12,
      500 - x * .342 + y * .94 + 13 * Math.cos(angle * 3 + layer * 5 - time * .08) + pointerY * 9
    ];
  }

  function draw(time) {
    context.setTransform(logicalScale, 0, 0, logicalScale, 0, 0);
    context.clearRect(0, 0, 1000, 1000);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = mistGradient;
    context.fillRect(0, 0, 1000, 1000);
    pointerX += (targetX - pointerX) * .045;
    pointerY += (targetY - pointerY) * .045;
    context.globalCompositeOperation = 'screen';
    context.strokeStyle = flowGradient;
    context.lineWidth = compact.matches ? 1.2 : .9;

    for (let i = 0; i < lineCount; i += 1) {
      const layer = i / (lineCount - 1);
      context.globalAlpha = .12 + .43 * Math.sin(layer * Math.PI) ** 2;
      context.beginPath();
      for (let j = 0; j <= pointCount; j += 1) {
        const p = point(j / pointCount * TAU, layer, time);
        if (j === 0) context.moveTo(p[0], p[1]);
        else context.lineTo(p[0], p[1]);
      }
      context.closePath();
      context.stroke();
    }

    context.fillStyle = '#b7d4ca';
    const speckCount = compact.matches ? 32 : 65;
    for (let i = 0; i < speckCount; i += 1) {
      const angle = i * 2.399963 + time * .006;
      const radius = 395 + Math.sin(i * 17) * 70;
      context.globalAlpha = .15 + (i % 4) * .075;
      context.beginPath();
      context.arc(500 + Math.cos(angle) * radius, 500 + Math.sin(angle) * radius, .7 + (i % 3) * .3, 0, TAU);
      context.fill();
    }
    // A few glints carry the direction of the current without a busy starfield.
    const glintCount = compact.matches ? 7 : 13;
    for (let i = 0; i < glintCount; i += 1) {
      const angle = i * 2.399963 + time * (.045 + (i % 3) * .006);
      const p = point(angle, .15 + (i % 7) / 10, time);
      context.globalAlpha = .35 + Math.sin(i * 5 + time * .2) * .15;
      context.fillStyle = i % 3 === 0 ? '#f1c6a7' : '#b9e3ce';
      context.beginPath();
      context.arc(p[0], p[1], i % 3 === 0 ? 1.8 : 1.2, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    stage.dataset.rendered = 'true';
  }

  function shouldAnimate() {
    return motionAllowed && visible && pageActive && !document.hidden;
  }

  function tick(now) {
    if (!shouldAnimate()) { frame = 0; return; }
    frame = requestAnimationFrame(tick);
    const interval = compact.matches ? 1000 / 24 : 1000 / 30;
    const delta = now - lastTime;
    if (delta < interval) return;
    elapsed += Math.min(delta, 100) / 1000;
    lastTime = now;
    draw(elapsed);
  }

  function synchronizeAnimation() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (shouldAnimate()) {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    const width = stage.getBoundingClientRect().width;
    const ratio = Math.min(window.devicePixelRatio || 1, compact.matches ? 1.25 : 1.5);
    const size = Math.max(1, Math.round(width * ratio));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    logicalScale = size / 1000;
    lineCount = compact.matches ? 42 : 66;
    pointCount = compact.matches ? 100 : 140;
    context.setTransform(logicalScale, 0, 0, logicalScale, 0, 0);
    flowGradient = context.createLinearGradient(190, 180, 800, 860);
    flowGradient.addColorStop(0, '#64b7b3');
    flowGradient.addColorStop(.39, '#adc6b8');
    flowGradient.addColorStop(.73, '#d8aa93');
    flowGradient.addColorStop(1, '#ed9478');
    mistGradient = context.createRadialGradient(500, 500, 80, 500, 500, 470);
    mistGradient.addColorStop(0, 'rgba(66,124,121,.12)');
    mistGradient.addColorStop(.65, 'rgba(66,124,121,.055)');
    mistGradient.addColorStop(1, 'rgba(66,124,121,0)');
    draw(elapsed);
  }

  function updateMotionControl() {
    motionButton.querySelector('.motion-label').textContent = motionAllowed ? 'Pause motion' : 'Resume motion';
    motionButton.querySelector('.motion-icon').textContent = motionAllowed ? 'Ⅱ' : '▷';
    motionButton.setAttribute('aria-label', motionAllowed ? 'Pause ambient animation' : 'Resume ambient animation');
    document.body.dataset.motion = motionAllowed ? 'running' : 'paused';
  }

  try {
    resize();
    updateMotionControl();
    motionButton.hidden = false;
  } catch (_) {
    delete stage.dataset.rendered;
    canvas.hidden = true;
    return;
  }

  motionButton.addEventListener('click', () => {
    motionAllowed = !motionAllowed;
    updateMotionControl();
    synchronizeAnimation();
  });
  reducedMotion.addEventListener('change', () => {
    motionAllowed = !reducedMotion.matches;
    updateMotionControl();
    synchronizeAnimation();
  });
  stage.addEventListener('pointermove', event => {
    if (!motionAllowed || !finePointer.matches || event.pointerType === 'touch') return;
    const bounds = stage.getBoundingClientRect();
    targetX = (event.clientX - bounds.left) / bounds.width * 2 - 1;
    targetY = (event.clientY - bounds.top) / bounds.height * 2 - 1;
  });
  stage.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      synchronizeAnimation();
    }, { threshold: 0 }).observe(stage);
  }
  document.addEventListener('visibilitychange', synchronizeAnimation);
  window.addEventListener('pagehide', () => { pageActive = false; synchronizeAnimation(); });
  window.addEventListener('pageshow', () => { pageActive = true; synchronizeAnimation(); });
  synchronizeAnimation();
})();
