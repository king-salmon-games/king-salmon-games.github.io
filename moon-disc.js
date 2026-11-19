import { loadMoonClouds } from './river-moon-clouds.js?v=1';

// A small patch of the 1717 × 916 plate. Its diameter follows the Moon's
// apparent size, enlarged to read at the scale of a phone's painted skyline.
const patch = 108;
const resolution = 144;
const maskSize = 32;
const clamp = x => Math.max(0, Math.min(1, x));

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

async function readAlbedo() {
  const image = new Image();
  image.src = 'assets/river-scene/lunar-albedo.webp?v=1';
  await image.decode();
  const canvas = makeCanvas(image.width);
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

// Shade the near hemisphere from the local Sun direction. The maria rotate
// with lunar north while the terminator follows a separate orientation.
function shadeDisk(sprite, moon, albedo, sunAltitude) {
  const ctx = sprite.getContext('2d');
  const pixels = ctx.createImageData(resolution, resolution);
  const radius = 16.5 * (moon.angularRadius / .259) * resolution / patch;
  const northX = Math.sin(moon.poleAngle), northY = Math.cos(moon.poleAngle);
  const warm = Math.exp(-moon.altitude / 15);
  const dusk = clamp(-sunAltitude / 5);
  const gain = dusk * dusk * (3 - 2 * dusk);
  const phase = moon.illumination;
  for (let y = 0, i = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++, i += 4) {
      const nx = (x + .5 - resolution / 2) / radius;
      const ny = (resolution / 2 - y - .5) / radius;
      const r = Math.hypot(nx, ny);
      const glow = .095 * phase * Math.exp(-2.15 * Math.max(0, r - 1))
        * clamp((resolution / (2 * radius) - r) * 2);
      let tone = .82, alpha = glow;
      if (r < 1 + .5 / radius) {
        const nz = Math.sqrt(Math.max(0, 1 - r * r));
        const incidence = nx * moon.lightX + ny * moon.lightY + nz * moon.lightZ;
        const longitude = Math.atan2(nx * northY - ny * northX, nz);
        const latitude = Math.asin(Math.max(-1, Math.min(1, nx * northX + ny * northY)));
        const col = Math.floor((.5 + longitude / (2 * Math.PI)) * albedo.width);
        const row = Math.min(albedo.height - 1, Math.floor((.5 - latitude / Math.PI) * albedo.height));
        const rock = albedo.data[(row * albedo.width + col) * 4] / 255;
        const lit = Math.max(incidence, 0);
        const scatter = lit / (.55 * nz + lit + .001);
        const limb = clamp((1 - r) * radius + .5);
        const sunlight = clamp(incidence * radius + .5);
        const earthshine = .055 * (1 - phase) ** 2 * clamp(phase * 80);
        const disc = limb * (earthshine + (1 - earthshine) * sunlight);
        const brightness = (.34 + .66 * Math.sqrt(scatter)) * (.40 + .92 * rock);
        alpha = glow + (1 - glow) * disc;
        tone = (.82 * glow * (1 - disc) + brightness * disc) / Math.max(.001, alpha);
      }
      pixels.data[i] = 244 * tone;
      pixels.data[i + 1] = (244 - 32 * warm) * tone;
      pixels.data[i + 2] = (251 - 75 * warm) * tone;
      pixels.data[i + 3] = 255 * gain * alpha;
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

export async function mountMoon(hero) {
  const canvas = hero.querySelector('.river-moon');
  const surface = hero.querySelector('[data-water-surface]');
  const film = hero.querySelector('[data-river-water]');
  const poster = hero.querySelector('.scene-poster');
  canvas.width = canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const [albedo, clouds] = await Promise.all([readAlbedo(), loadMoonClouds()]);
  const sprite = makeCanvas(resolution);
  const mask = makeCanvas(maskSize);
  const maskContext = mask.getContext('2d');
  const transmission = maskContext.createImageData(maskSize, maskSize);
  const portrait = matchMedia('(max-width: 680px)');
  let position = null, inFrame = false, onScreen = true;
  let timer, lastTime;

  function render() {
    clearTimeout(timer);
    if (!inFrame || !onScreen || document.hidden || hero.hasAttribute('data-suspended')) return;
    // The opening still was baked at 4 seconds. The GPU can slow or suspend
    // independently of the film. Use the clock of whichever layer is visible.
    const time = surface.hasAttribute('data-ready') ? surface.riverSceneTime()
      : 4 + (poster.classList.contains('film-ready') ? film.currentTime : 0);
    if (time !== lastTime) {
      lastTime = time;
      const sample = clouds.atTime(time);
      for (let y = 0; y < maskSize; y++) {
        const v = position.v + ((y + .5) / maskSize - .5) * patch / 916;
        for (let x = 0; x < maskSize; x++) {
          const u = position.u + ((x + .5) / maskSize - .5) * patch / 1717;
          // The atlas contains linear optical transmission. The small canvas
          // is composited onto the display-encoded landscape.
          transmission.data[(y * maskSize + x) * 4 + 3] = 255 * Math.sqrt(sample(u, v));
        }
      }
      maskContext.putImageData(transmission, 0, 0);
      ctx.clearRect(0, 0, resolution, resolution);
      ctx.drawImage(sprite, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0, resolution, resolution);
      ctx.globalCompositeOperation = 'source-over';
      canvas.hidden = false;
    }
    timer = setTimeout(render, 100);
  }

  function register() {
    const bounds = hero.getBoundingClientRect();
    const frame = film.parentElement.getBoundingClientRect();
    const w = bounds.width, h = bounds.height;
    const sourceWidth = portrait.matches ? 733 : 1717;
    const scale = frame.width / sourceWidth;
    const size = patch * scale;
    const left = frame.left - bounds.left - (portrait.matches ? 820 * scale : 0);
    const top = frame.top - bounds.top;
    inFrame = false;
    if (position) {
      const x = left + position.u * 1717 * scale - size / 2;
      const y = top + position.v * frame.height - size / 2;
      inFrame = x < w && x + size > 0 && y < h && y + size > 0;
      if (inFrame) {
        canvas.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        canvas.style.width = canvas.style.height = size + 'px';
      }
    }
    if (!inFrame) canvas.hidden = true;
    lastTime = undefined;
    render();
  }
  new ResizeObserver(register).observe(hero);
  portrait.addEventListener('change', register);
  new IntersectionObserver(entries => {
    onScreen = entries[entries.length - 1].isIntersecting;
    render();
  }).observe(hero);
  hero.addEventListener('river-lifecycle-change', render);
  surface.addEventListener('water-renderer-change', render);
  canvas.addEventListener('contextrestored', register);

  return {
    update(sunAltitude, moon) {
      position = null;
      if (moon && moon.altitude > 0 && moon.illumination > .002) {
        // A fixed south-facing panorama. Compress elevation to fit the small
        // band of sky above the painted ridge, in both crops of the same plate.
        position = {
          u: .742 + (moon.azimuth - 180) * .0026,
          v: .215 - .0031 * moon.altitude / (1 + moon.altitude / 130)
        };
        shadeDisk(sprite, moon, albedo, sunAltitude);
      }
      register();
    }
  };
}
