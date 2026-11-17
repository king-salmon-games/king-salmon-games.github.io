(() => {
  const header = document.querySelector('.site-header');
  const menu = header?.querySelector('.menu-toggle');
  const narrow = window.matchMedia('(max-width: 575px)');

  if (menu) {
    header.classList.add('has-menu');
    function setOpen(open) {
      header.classList.toggle('open', open);
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    function resizeMenu() {
      menu.hidden = !narrow.matches;
      setOpen(false);
    }
    menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
    header.querySelector('nav')?.addEventListener('click', () => setOpen(false));
    document.addEventListener('click', event => {
      if (!header.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && header.classList.contains('open')) {
        setOpen(false);
        menu.focus();
      }
    });
    narrow.addEventListener('change', resizeMenu);
    resizeMenu();
  }

  const overlay = document.querySelector('.hero-overlay');
  if (overlay && !(CSS.supports('animation-timeline: scroll(root block)') &&
                   CSS.supports('animation-range: 0px 216px'))) {
    const explore = overlay.querySelector('.explore-link');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const portrait = window.matchMedia('(max-width: 680px)');
    let distance;
    let frame = 0;
    let lastProgress = -1;

    // Older browsers share the CSS fade curve. Read geometry only when the
    // layout changes so a swipe never triggers a synchronous layout measurement.
    function paintFade() {
      frame = 0;
      const progress = reduced.matches ? 0 : Math.min(1, Math.max(0, window.scrollY / distance));
      if (progress === lastProgress) return;
      lastProgress = progress;
      overlay.style.opacity = 1 - progress * progress * (3 - 2 * progress);
      explore.style.visibility = progress === 1 ? 'hidden' : '';
    }
    function scheduleFade() {
      if (!frame) frame = requestAnimationFrame(paintFade);
    }
    function measureFade() {
      distance = parseFloat(getComputedStyle(overlay).getPropertyValue('--fade-distance'));
      scheduleFade();
    }
    window.addEventListener('scroll', scheduleFade, { passive: true });
    window.addEventListener('pageshow', measureFade);
    reduced.addEventListener('change', scheduleFade);
    portrait.addEventListener('change', measureFade);
    measureFade();
  }

  const collection = document.querySelector('.collection');
  if (collection) {
    const track = collection.querySelector('.game-track');
    const cards = [...track.children];
    const previous = collection.querySelector('[data-previous]');
    const next = collection.querySelector('[data-next]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    collection.classList.add('is-scrollable');
    collection.querySelector('.gallery-buttons').hidden = false;

    function updateButtons() {
      previous.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    }
    function scrollCard(direction) {
      const step = cards[1].offsetLeft - cards[0].offsetLeft;
      track.scrollBy({ left: direction * step, behavior: reduce.matches ? 'instant' : 'smooth' });
    }
    function revealFragment() {
      const target = document.getElementById(location.hash.slice(1));
      const card = target?.closest('.game-card');
      if (card) track.scrollLeft = card.offsetLeft - cards[0].offsetLeft;
    }
    previous.addEventListener('click', () => scrollCard(-1));
    next.addEventListener('click', () => scrollCard(1));
    track.addEventListener('scroll', updateButtons, { passive: true });
    new ResizeObserver(updateButtons).observe(track);
    window.addEventListener('hashchange', revealFragment);
    revealFragment();
    updateButtons();
  }

  const water = document.querySelector('[data-river-water]');
  const ambience = document.querySelector('[data-river-audio]');
  if (!water || !ambience) return;

  // Muted inline video can begin while the browser waits for an audio gesture.
  // Retry both media elements inside the gesture so each gets the same activation.
  const surface = document.querySelector('[data-water-surface]');
  const gestures = ['click', 'touchend', 'keydown'];
  function listenForGesture(needed) {
    for (const type of gestures) {
      if (needed) {
        document.addEventListener(type, onGesture, { capture: true, passive: true });
      } else {
        document.removeEventListener(type, onGesture, true);
      }
    }
  }
  async function startWaterfall() {
    // Once the GPU has actually drawn, stop decoding the backup film.
    water.hidden = Boolean(surface?.hasAttribute('data-ready'));
    const playback = [ambience.play()];
    if (water.hidden) water.pause();
    else playback.push(water.play());
    await Promise.allSettled(playback);
    listenForGesture((!water.hidden && water.paused) || ambience.paused);
  }
  function onGesture(event) {
    if (event.isTrusted) startWaterfall();
  }
  // Some browsers select a video source before the mobile viewport settles.
  const mobileSource = water.querySelector('source[media]');
  const desktopSource = water.querySelector('source:not([media])');
  const portrait = window.matchMedia(mobileSource.media);
  function selectWaterfall() {
    const source = portrait.matches ? mobileSource.src : desktopSource.src;
    if ((water.src || water.currentSrc) !== source) water.src = source;
    startWaterfall();
  }
  surface?.addEventListener('water-renderer-change', startWaterfall);
  portrait.addEventListener('change', selectWaterfall);
  window.addEventListener('pageshow', selectWaterfall);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) startWaterfall();
  });
  listenForGesture(true);
  selectWaterfall();
})();
