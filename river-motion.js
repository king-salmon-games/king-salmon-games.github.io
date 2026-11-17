(() => {
  const scene = document.querySelector('[data-river-scene]');
  const canvas = scene?.querySelector('[data-river-motion]');
  if (!canvas) return;

  const context = canvas.getContext('2d');
  const button = document.querySelector('[data-motion-toggle]');
  const water = scene.querySelector('[data-river-water]');
  const background = scene.querySelector('picture img, img[data-river-background]');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = window.matchMedia('(max-width: 680px)');
  const salmon = new Image();
  salmon.decoding = 'async';
  const openingTime = 1.9;
  const period = 12.84;
  const shoal = [
    { from: [0.767, 0.752], to: [0.849, 0.371], size: 0.068, lift: 0.205, duration: 3.15, interval: period / 3, delay: 0.13, distant: true },
    { from: [0.635, 0.779], to: [0.797, 0.383], size: 0.16, lift: 0.345, duration: 4.28, interval: period / 2, delay: 0 },
  ];
  // The left-hand waterfall has a second, higher pool. Its upstream route brings
  // the foreground fish into the portrait composition above the title.
  const portraitShoal = [
    { ...shoal[0], from: [0.825, 0.747], to: [0.845, 0.37] },
    { ...shoal[1], from: [0.45, 0.6], to: [0.84, 0.37], lift: 0.265 },
  ];
  let route = shoal;

  let paused = motionPreference.matches;
  let manualPreference = false;
  let inView = false;
  let frame = 0;
  let lastFrame = 0;
  let seconds = openingTime;
  let width = 0;
  let height = 0;
  let artWidth = 0;
  let artHeight = 0;
  let left = 0;
  let top = 0;
  let waterSource = '';
  let distantSalmon;

  // Work in the original landscape's coordinates so the splashes meet the same ledges
  // in the desktop composition and its separately art-directed portrait crop.
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) return;
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3000000 / (width * height)));
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    context?.setTransform(density, 0, 0, density, 0, 0);
    const mobileArt = background?.currentSrc
      ? background.currentSrc.includes('river-mobile')
      : portrait.matches;
    const sourceWidth = mobileArt ? 733 : 1717;
    route = mobileArt ? portraitShoal : shoal;
    const scale = Math.max(width / sourceWidth, height / 916);
    artWidth = 1717 * scale;
    artHeight = 916 * scale;
    left = (width - sourceWidth * scale) / 2 - (mobileArt ? 820 * scale : 0);
    top = (height - artHeight) / 2;
    paint();
  }

  function smooth(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  // Fixed spray seeds keep each droplet on a continuous arc, including after a pause.
  const spray = Array.from({ length: 37 }, (_, i) => {
    const rand = (offset) => {
      const n = Math.sin(i * 99.71 + offset * 789.17) * 25547.37;
      return n - Math.floor(n);
    };
    return { vx: (rand(1) - 0.5) * 1.28, vy: 0.3 + rand(2) * 0.84, size: 0.28 + rand(3), delay: rand(4) * 0.14 };
  });

  function splash(x, y, age, scale, direction) {
    if (age < 0 || age > 1.6) return;
    const radius = scale * (0.1 + age * 0.69);
    context.save();
    context.fillStyle = '#def1f5';
    context.strokeStyle = '#d8eef4';
    context.lineWidth = Math.max(0.55, scale * 0.007);
    context.globalAlpha = (1 - age / 1.6) * 0.42;
    context.beginPath();
    context.ellipse(x, y, radius, radius * 0.125, -0.025, 0.1, Math.PI * 1.95);
    context.stroke();
    for (const drop of spray) {
      const t = age - drop.delay;
      const above = drop.vy * t - 0.95 * t * t;
      if (t <= 0 || above <= 0) continue;
      const dx = x + scale * (drop.vx + direction * 0.17) * t;
      const dy = y - scale * above;
      const r = Math.max(0.45, drop.size * scale * 0.009);
      context.globalAlpha = Math.min(0.83, above * 19) * (0.61 + drop.size * 0.18);
      context.beginPath();
      context.ellipse(dx, dy, r * 0.67, r * 1.37, drop.vx * 0.72, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawSalmon(fish, time) {
    const u = time / fish.duration;
    if (u > 1) return;
    const sprite = fish.distant ? distantSalmon : salmon;
    const size = fish.size * artWidth * (1 - 0.19 * u);
    const bodyHeight = size * salmon.height / salmon.width;
    const surfaceY = top + fish.from[1] * artHeight;
    const lipY = top + fish.to[1] * artHeight;
    const x = left + artWidth * (fish.from[0] + (fish.to[0] - fish.from[0]) * u);
    const y = surfaceY + (lipY - surfaceY) * u + size * 0.38 - 4 * artHeight * fish.lift * u * (1 - u);
    const pitch = -1.02 + 1.45 * smooth((u - 0.1) / 0.88);

    context.save();
    context.beginPath();
    context.rect(0, 0, width, u < 0.73 ? surfaceY : lipY);
    context.clip();
    context.translate(x, y);
    context.rotate(pitch);

    // Flex the tail around a stable head. Each textured strip shares its neighbour's
    // endpoint, preserving the silhouette as the salmon's body changes curvature.
    const strips = 16;
    const step = size / strips;
    const sourceStep = sprite.width / strips;
    function spine(t) {
      return (1 - t) ** 2.3 * size * (0.055 * Math.sin(2.3 * seconds - t * 3.6) + 0.038 * Math.sin(5 * u));
    }
    let start = spine(0);
    for (let i = 0; i < strips; i++) {
      const end = spine((i + 1) / strips);
      context.save();
      context.transform(1, (end - start) / step, 0, 1, -size / 2 + i * step, start);
      context.drawImage(sprite, i * sourceStep, 0, sourceStep, sprite.height, 0, -bodyHeight / 2, step + 0.48, bodyHeight);
      context.restore();
      start = end;
    }
    context.restore();

    // Water beads leave the tail as it clears the pool and break away under gravity.
    const wake = smooth(u / 0.13) * (1 - smooth((u - 0.22) / 0.56));
    if (!wake) return;
    context.save();
    context.fillStyle = '#deeff1';
    for (let i = 0; i < 24; i++) {
      const drop = spray[i];
      const age = (seconds * 0.65 + drop.delay * 5 + i * 0.137) % 1;
      const tx = -size * (0.28 + drop.delay + age * 0.32);
      const ty = (drop.vx * 0.21 + 0.07) * size;
      const dx = x + tx * Math.cos(pitch) - ty * Math.sin(pitch);
      const dy = y + tx * Math.sin(pitch) + ty * Math.cos(pitch) + size * age * age * 0.55;
      if (dy > surfaceY) continue;
      const radius = Math.max(0.48, size * 0.0075 * drop.size);
      context.globalAlpha = wake * (1 - age) * 0.88;
      context.beginPath();
      context.ellipse(dx, dy, radius, radius * (1 + age), -0.18, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function paint() {
    if (!context || !width || !distantSalmon) return;
    context.clearRect(0, 0, width, height);
    for (const fish of route) {
      const time = (seconds - fish.delay + fish.interval) % fish.interval;
      const size = fish.size * artWidth;
      splash(left + artWidth * fish.from[0], top + artHeight * fish.from[1], time, size, -1);
      drawSalmon(fish, time);
      splash(left + artWidth * fish.to[0], top + artHeight * fish.to[1], time - fish.duration * 0.89, size * 0.77, 1);
    }
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (!lastFrame) lastFrame = now;
    const elapsed = now - lastFrame;
    if (elapsed < 1000 / 32) return;
    seconds = (seconds + Math.min(elapsed, 100) / 1000) % period;
    lastFrame = now;
    paint();
  }

  function sync() {
    const running = !paused && inView && !document.hidden;
    scene.dataset.motion = paused ? 'paused' : 'playing';
    if (button) {
      button.hidden = false;
      const label = paused ? 'Play motion' : 'Pause motion';
      button.dataset.paused = String(paused);
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', label);
      const text = button.querySelector('[data-motion-label]');
      if (text) text.textContent = label;
    }
    if (running && !frame && context && salmon.naturalWidth) frame = requestAnimationFrame(tick);
    if (!running) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    }
    if (water) {
      const source = portrait.matches ? water.dataset.mobileSrc : water.dataset.desktopSrc;
      if (source !== waterSource) water.removeAttribute('data-playing');
      if (running && source) {
        if (source !== waterSource) {
          waterSource = source;
          water.src = source;
        }
        if (water.paused) water.play().catch(() => {});
      } else {
        water.pause();
      }
    }
    paint();
  }

  button?.addEventListener('click', () => {
    manualPreference = true;
    paused = !paused;
    sync();
  });
  motionPreference.addEventListener('change', event => {
    if (manualPreference) return;
    paused = event.matches;
    if (paused) seconds = openingTime;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  portrait.addEventListener('change', () => { resize(); sync(); });
  water?.addEventListener('playing', () => {
    const activeSrc = water.currentSrc;
    function showFrame() {
      if (water.readyState >= 2 && activeSrc === water.currentSrc) water.setAttribute('data-playing', '');
    }
    if (water.requestVideoFrameCallback) water.requestVideoFrameCallback(showFrame);
    else showFrame();
  });
  water?.addEventListener('error', () => water.removeAttribute('data-playing'));
  background?.addEventListener('load', resize);
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(scene);

  salmon.addEventListener('load', () => {
    // Atmospheric perspective for the upstream fish, composited once at load time.
    const sprite = document.createElement('canvas');
    sprite.width = 320;
    sprite.height = Math.round(sprite.width * salmon.height / salmon.width);
    const tint = sprite.getContext('2d');
    if (tint) {
      tint.drawImage(salmon, 0, 0, sprite.width, sprite.height);
      tint.globalCompositeOperation = 'source-atop';
      tint.fillStyle = 'rgba(151, 179, 191, 0.23)';
      tint.fillRect(0, 0, sprite.width, sprite.height);
    }
    distantSalmon = tint ? sprite : salmon;
    resize();
    sync();
  });
  salmon.src = new URL('assets/river-scene/salmon.webp', document.currentScript?.src || document.baseURI).href;
  resize();
  sync();
})();
