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

  const audioToggle = document.querySelector('[data-audio-toggle]');
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!audioToggle || !AudioEngine) return;

  // Layer a low, broad waterfall roar with a narrower band of stream hiss.
  // Create the audio only on request. A stereo buffer loops without a hard cut.
  let audio;
  let enabled = false;
  let inView = true;
  function makeRiverAudio() {
    const ctx = new AudioEngine();
    const rate = ctx.sampleRate;
    const duration = 8;
    const buffer = ctx.createBuffer(2, duration * rate, rate);
    for (let c = 0; c < 2; c++) {
      const channel = buffer.getChannelData(c);
      let slow = 0;
      let mid = 0;
      const overlap = Math.floor(rate * 0.16);
      const head = new Float32Array(overlap);
      for (let i = 0; i < channel.length + overlap; i++) {
        const noise = Math.random() * 2 - 1;
        slow = (slow + noise * 0.065) / 1.065;
        mid = (mid + noise * 0.32) / 1.32;
        const swell = 0.88 + 0.12 * Math.sin(2 * Math.PI * i / channel.length + c * 0.5);
        const sample = (1.8 * slow + 0.52 * mid + 0.09 * noise) * swell;
        if (i < channel.length) channel[i] = sample;
        else head[i - channel.length] = sample;
      }
      for (let i = 0; i < overlap; i++) {
        const mix = i / overlap;
        channel[i] = head[i] * (1 - mix) + channel[i] * mix;
      }
    }
    const sound = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4500;
    const volume = ctx.createGain();
    volume.gain.value = 0.3;
    sound.buffer = buffer;
    sound.loop = true;
    sound.connect(filter).connect(volume).connect(ctx.destination);
    sound.start();
    return ctx;
  }
  function syncAudio() {
    const playing = enabled && inView && !document.hidden;
    if (audio) {
      (playing ? audio.resume() : audio.suspend()).catch(() => {
        enabled = false;
        showAudioState();
      });
    }
    showAudioState();
  }
  function showAudioState() {
    audioToggle.setAttribute('aria-pressed', String(enabled));
    audioToggle.setAttribute('aria-label', enabled ? 'Mute river sound' : 'Enable river sound');
    audioToggle.querySelector('[data-audio-label]').textContent = enabled ? 'Sound on' : 'Sound off';
  }
  audioToggle.addEventListener('click', () => {
    try {
      if (!audio) audio = makeRiverAudio();
      enabled = !enabled;
      syncAudio();
    } catch {
      audioToggle.hidden = true;
    }
  });
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncAudio();
  }).observe(document.querySelector('.river-hero'));
  document.addEventListener('visibilitychange', syncAudio);
  audioToggle.hidden = false;
})();
