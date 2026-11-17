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
  const poster = water.closest('.river-hero').querySelector('.scene-poster');
  function revealFilm() {
    const source = water.currentSrc;
    function reveal() {
      if (water.currentSrc === source && water.readyState >= 2 && !water.seeking) {
        poster.classList.add('film-ready');
      }
    }
    if (water.requestVideoFrameCallback) water.requestVideoFrameCallback(reveal);
    else reveal();
  }
  function videoUnavailable() {
    if (water.error) poster.classList.remove('film-ready');
    water.setAttribute('data-needs-renderer', '');
    water.dispatchEvent(new Event('river-video-unavailable'));
  }
  water.addEventListener('loadeddata', revealFilm);
  water.addEventListener('seeked', revealFilm);
  water.addEventListener('error', videoUnavailable);
  water.addEventListener('playing', () => water.removeAttribute('data-needs-renderer'));
  if (water.readyState >= 2) revealFilm();
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
    const live = surface?.hasAttribute('data-ready');
    const playback = ambience.paused ? [ambience.play()] : [];
    if (live) {
      // Leave its last frame underneath the opaque canvas during the handoff.
      if (!water.paused) water.pause();
    } else if (water.paused) {
      playback.push(water.play().catch(error => {
        if (water.paused && (error.name === 'NotAllowedError' || error.name === 'NotSupportedError')) {
          videoUnavailable();
        }
      }));
    }
    await Promise.allSettled(playback);
    listenForGesture((!surface?.hasAttribute('data-ready') && water.paused) || ambience.paused);
  }
  function onGesture(event) {
    if (event.isTrusted) startWaterfall();
  }
  // Some browsers select a video source before the mobile viewport settles.
  const mobileSource = water.querySelector('source[media]');
  const desktopSource = water.querySelector('source:not([media])');
  const portrait = window.matchMedia(mobileSource.media);
  let resumeAt = 0;
  water.addEventListener('loadedmetadata', () => {
    if (resumeAt > 0 && Number.isFinite(water.duration) && water.duration > 0) {
      water.currentTime = resumeAt % water.duration;
    }
    resumeAt = 0;
  });
  function selectWaterfall() {
    const source = portrait.matches ? mobileSource.src : desktopSource.src;
    if ((water.src || water.currentSrc) !== source) {
      resumeAt = water.currentTime;
      poster.classList.remove('film-ready');
      water.src = source;
    }
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
