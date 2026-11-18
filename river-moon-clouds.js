// tools/bake_moon_clouds.py stores a 48-second loop of direct light through
// the actual cloud volumes and tree silhouettes. Consecutive RGB channels
// are successive instants. Only the upper-right part of the plate has sky.
const atlasURL = new URL('assets/river-scene/moon-clouds.webp?v=1', import.meta.url);
const width = 384, height = 72, columns = 8, frames = 120, seconds = 48;
let loading;

async function decode() {
  const image = new Image();
  image.src = atlasURL.href;
  await image.decode();
  if (image.naturalWidth !== width * columns || image.naturalHeight !== height * 5) {
    throw new Error('Unexpected river moon cloud atlas dimensions');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const stride = canvas.width * 4;
  canvas.width = canvas.height = 0;

  function offset(frame) {
    const tile = Math.floor(frame / 3);
    return Math.floor(tile / columns) * height * stride +
      tile % columns * width * 4 + frame % 3;
  }

  // Bind both temporal samples once per moon draw. u,v are normalized
  // coordinates in the uncropped 1717 x 916 landscape, with v=0 at its top.
  function atTime(sceneSeconds) {
    const phase = ((sceneSeconds % seconds + seconds) % seconds) * frames / seconds;
    const frame = Math.floor(phase);
    const blend = phase - frame;
    const a = offset(frame), b = offset((frame + 1) % frames);
    return (u, v) => {
      if (u < .30 || u > 1 || v < 0 || v >= .24) return 0;
      const x = Math.max(0, Math.min(width - 1, (u - .30) / .70 * width - .5));
      const y = Math.max(0, Math.min(height - 1, v / .24 * height - .5));
      const left = Math.floor(x), top = Math.floor(y);
      const dx = x - left, dy = y - top;
      const tl = top * stride + left * 4;
      const tr = tl + (left < width - 1 ? 4 : 0);
      const row = top < height - 1 ? stride : 0;
      const atl = pixels[a + tl], atr = pixels[a + tr];
      const abl = pixels[a + tl + row], abr = pixels[a + tr + row];
      const btl = pixels[b + tl], btr = pixels[b + tr];
      const bbl = pixels[b + tl + row], bbr = pixels[b + tr + row];
      const first = (atl + (atr - atl) * dx) * (1 - dy) + (abl + (abr - abl) * dx) * dy;
      const next = (btl + (btr - btl) * dx) * (1 - dy) + (bbl + (bbr - bbl) * dx) * dy;
      return (first + (next - first) * blend) / 255;
    };
  }

  return { atTime };
}

export function loadMoonClouds() {
  loading ??= decode().catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}
