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
  if (!water) return;

  const surface = document.querySelector('[data-water-surface]');
  const hero = water.closest('.river-hero');
  const poster = hero.querySelector('.scene-poster');
  let resumeCheck;
  let revealFrame;
  function active() {
    return !document.hidden && !hero.hasAttribute('data-suspended');
  }
  function heroInView() {
    const bounds = hero.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < document.documentElement.clientHeight;
  }
  function revealFilm() {
    if (revealFrame !== undefined) water.cancelVideoFrameCallback(revealFrame);
    revealFrame = undefined;
    if (poster.classList.contains('film-ready') || water.readyState < 2) return;
    const source = water.currentSrc;
    function reveal() {
      revealFrame = undefined;
      if (water.currentSrc === source && water.readyState >= 2 && !water.seeking) {
        poster.classList.add('film-ready');
      }
    }
    if (water.requestVideoFrameCallback) revealFrame = water.requestVideoFrameCallback(reveal);
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
  water.addEventListener('playing', () => {
    water.removeAttribute('data-needs-renderer');
    revealFilm();
  });
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
    if (!active() || surface?.hasAttribute('data-ready')) {
      // Leave its last frame underneath the opaque canvas during the handoff.
      if (!water.paused) water.pause();
    } else if (water.paused) {
      try {
        await water.play();
      } catch (error) {
        if (active() && water.paused && (error.name === 'NotAllowedError' || error.name === 'NotSupportedError')) {
          videoUnavailable();
        }
      }
    }
    listenForGesture(active() && !surface?.hasAttribute('data-ready') && water.paused);
  }
  function onGesture(event) {
    if (event.isTrusted) startWaterfall();
  }
  // Some decoders pause during the seek back to the opening frame of a loop.
  water.addEventListener('seeked', () => {
    if (water.loop && water.paused && water.currentTime < 0.1 && active() &&
        !surface?.hasAttribute('data-ready')) startWaterfall();
  });
  // A browser can deliver its background pause after the page is visible again.
  water.addEventListener('pause', () => {
    if (active() && water.paused && !water.error && !surface?.hasAttribute('data-ready') &&
        heroInView()) startWaterfall();
  });
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
  function checkRestoredPlayback(retried = false) {
    if (!heroInView()) return;
    const time = water.currentTime;
    const source = water.currentSrc;
    resumeCheck = setTimeout(() => {
      if (!active() || !heroInView()) return;
      // Some browsers discard callbacks shortly after pageshow. Let each
      // renderer check for actual progress before replacing its pending work.
      hero.dispatchEvent(new Event('river-check-frames'));
      revealFilm();
      if (surface?.hasAttribute('data-ready') ||
          water.currentSrc !== source || water.seeking || water.readyState < 3 ||
          water.currentTime !== time) return;
      if (retried) {
        videoUnavailable();
        return;
      }
      // A suspended decoder can still report "playing" with a stopped clock.
      // Reopen playback at its current frame before trying the GPU fallback.
      water.pause();
      startWaterfall();
      checkRestoredPlayback(true);
    }, 1200);
  }
  function suspendRiver() {
    if (hero.hasAttribute('data-suspended')) return;
    clearTimeout(resumeCheck);
    hero.setAttribute('data-suspended', '');
    water.pause();
    hero.dispatchEvent(new Event('river-lifecycle-change'));
  }
  function restoreRiver() {
    if (document.hidden) return;
    clearTimeout(resumeCheck);
    hero.removeAttribute('data-suspended');
    hero.dispatchEvent(new Event('river-lifecycle-change'));
    selectWaterfall();
    revealFilm();
    checkRestoredPlayback();
  }
  document.addEventListener('visibilitychange', () => document.hidden ? suspendRiver() : restoreRiver());
  document.addEventListener('freeze', suspendRiver);
  document.addEventListener('resume', restoreRiver);
  window.addEventListener('pagehide', suspendRiver);
  window.addEventListener('pageshow', restoreRiver);
  window.addEventListener('focus', restoreRiver);
  new IntersectionObserver(entries => {
    if (entries[entries.length - 1].isIntersecting && active() && !surface?.hasAttribute('data-ready')) {
      startWaterfall();
      clearTimeout(resumeCheck);
      checkRestoredPlayback();
    }
  }).observe(hero);
  listenForGesture(true);
  selectWaterfall();
})();
