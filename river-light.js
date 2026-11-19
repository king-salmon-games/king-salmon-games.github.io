(() => {
  // NOAA's fractional-year approximation. The clock is an absolute instant at
  // Salmon River Falls, NY (43.5492 N, 75.9423 W). UTC avoids dependence on
  // the visitor's zone and keeps the light continuous across Eastern DST.
  // https://gml.noaa.gov/grad/solcalc/solareqns.PDF
  const rad = Math.PI / 180;
  const latitude = 43.5492 * rad;
  const longitude = -75.9423;
  function sunAt(time) {
    const date = new Date(time);
    const year = date.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const yearLength = Date.UTC(year + 1, 0, 1) - start;
    const phase = 2 * Math.PI * (time - start - 43200000) / yearLength;
    const declination = .006918 - .399912 * Math.cos(phase) + .070257 * Math.sin(phase)
      - .006758 * Math.cos(2 * phase) + .000907 * Math.sin(2 * phase)
      - .002697 * Math.cos(3 * phase) + .00148 * Math.sin(3 * phase);
    const equation = 229.18 * (.000075 + .001868 * Math.cos(phase) - .032077 * Math.sin(phase)
      - .014615 * Math.cos(2 * phase) - .040849 * Math.sin(2 * phase));
    const utcHour = (time % 86400000) / 3600000;
    const hourAngle = (15 * utcHour + longitude + equation / 4 - 180) * rad;
    const east = -Math.cos(declination) * Math.sin(hourAngle);
    const up = Math.sin(latitude) * Math.sin(declination)
      + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
    return { altitude: Math.asin(up) / rad, east };
  }

  // Hard-light transfer values. Midgray preserves the original exposure.
  // Each altitude keys ambient terrain, open sky, whitewater, and direct sun.
  const stops = [
    [-15, 0x141e2e, 0x1a2841, 0x213247, 0x1a2841], // moonless night
    [ -7, 0x29334e, 0x424d75, 0x3d536f, 0x675578], // blue hour
    [ -2, 0x4d4b5d, 0x796476, 0x686377, 0xb17b74], // afterglow
    [  2, 0x695956, 0x897777, 0x7e7474, 0xca936b], // low, raking light
    [  9, 0x827569, 0x887f7b, 0x83827c, 0xb89674],
    [ 22, 0x85837a, 0x7a8190, 0x808483, 0x858895],
    [ 48, 0x86877d, 0x748399, 0x818784, 0x79889c]  // high daylight
  ];
  const rgb = n => [n >> 16, (n >> 8) & 255, n & 255];
  const moonResponse = [[4, 4, 3], [16, 15, 9], [24, 21, 13], [16, 15, 9]];
  const westernDaylight = [-26, 4, 34];
  function lighting(altitude) {
    const end = stops.findIndex(stop => stop[0] >= altitude);
    if (end <= 0) return stops[end === 0 ? 0 : stops.length - 1].slice(1).map(rgb);
    const a = stops[end - 1], b = stops[end];
    const t = (altitude - a[0]) / (b[0] - a[0]);
    const blend = t * t * (3 - 2 * t);
    return a.slice(1).map((color, i) => {
      const from = rgb(color), to = rgb(b[i + 1]);
      return from.map((value, k) => value + (to[k] - value) * blend);
    });
  }

  const portrait = matchMedia('(max-width: 680px)');
  let surface, context, zones, pixels, timer;
  let moonView, loadingMoon = false;
  function paint(sun, [land, sky, water, direct]) {
    // These columns match the original portrait extraction (820..1552 of
    // 1717). Object-fit then applies the same cover crop as the film/poster.
    const left = portrait.matches ? Math.round(zones.width * 820 / 1717) : 0;
    const width = portrait.matches ? Math.round(zones.width * 733 / 1717) : zones.width;
    if (!pixels || pixels.width !== width) {
      surface.width = width;
      surface.height = zones.height;
      pixels = context.createImageData(width, zones.height);
    }
    const solarX = .73 - .23 * sun.east;
    const noon = Math.max(0, Math.min(1, (sun.altitude - 6) / 14));
    const beam = direct.map((value, k) => value - sky[k]);
    // Light coming over the eastern ridge is rose-colored. The western
    // opening gets a broader amber glow, and both reach into the plunge pool.
    const warmth = Math.max(0, beam[0]) * Math.max(0, sun.east);
    beam[0] -= .10 * warmth;
    beam[1] -= .18 * warmth;
    beam[2] += .16 * warmth;
    // Horizontal profiles are shared by every row. Keep the daylight update
    // short enough to finish between frames while a phone is scrolling.
    const skyWindow = new Float64Array(width);
    const plateWindow = new Float64Array(width);
    for (let x = 0; x < width; ++x) {
      const u = (x + left + .5) / zones.width;
      skyWindow[x] = Math.exp(-((u - solarX) ** 2) / .036);
      plateWindow[x] = noon * Math.exp(-((u - .90) ** 2) / .042);
    }
    for (let y = 0, out = 0; y < zones.height; ++y) {
      const v = (y + .5) / zones.height;
      const skyHeight = Math.exp(-((v - .14) ** 2) / .025);
      const plateHorizon = Math.exp(-((v - .145) ** 2) / .045);
      const reflectedX = solarX - .13 * (v - .66);
      const spread = .07 + .24 * Math.max(0, v - .65);
      let p = (y * zones.width + left) * 4;
      for (let x = 0; x < width; ++x, p += 4, out += 4) {
        const u = (x + left + .5) / zones.width;
        const air = zones.data[p] / 255, wet = zones.data[p + 1] / 255;
        const pool = zones.data[p + 2] / 255;
        const horizon = skyHeight * skyWindow[x];
        const reflection = pool > 0 ? pool * Math.exp(-(((u - reflectedX) / spread) ** 2)) : 0;
        const directLight = horizon * (.07 + .93 * air) + .37 * reflection;
        // Remove the original key art's warm western opening under high sun.
        // A broad spectral correction preserves the moving cloud texture.
        const warm = (zones.data[p + 3] - 128) / 127;
        const plateCast = plateWindow[x] * (plateHorizon * (air + warm * (1 - air)) + .85 * pool * warm);
        for (let k = 0; k < 3; ++k) {
          pixels.data[out + k] = land[k] + air * (sky[k] - land[k])
            + wet * (water[k] - land[k]) + directLight * beam[k]
            + plateCast * westernDaylight[k];
        }
        pixels.data[out + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
  }

  function refresh() {
    clearTimeout(timer);
    const now = Date.now();
    const sun = sunAt(now);
    const colors = lighting(sun.altitude);
    const moon = sun.altitude < 0 ? window.riverMoonAt?.(now) : null;
    const moonlight = (moon?.moonlight || 0) * Math.max(0, Math.min(1, (-4 - sun.altitude) / 8));
    for (let i = 0; i < colors.length; ++i) {
      for (let k = 0; k < 3; ++k) colors[i][k] += moonResponse[i][k] * moonlight;
    }
    const ambient = 'rgb(' + colors[0].map(Math.round).join(',') + ')';
    if (surface) surface.style.backgroundColor = ambient;
    else document.documentElement.style.setProperty('--river-ambient', ambient);
    if (document.hidden) return;
    if (zones && context) paint(sun, colors);
    if (moonView) {
      moonView.update(sun.altitude, moon);
    } else if (surface && moon?.altitude > 0 && !loadingMoon) {
      loadingMoon = true;
      import('./moon-disc.js?v=2').then(async ({ mountMoon }) => {
        moonView = await mountMoon(surface.parentElement);
        if (moonView) refresh();
      }).catch(() => {}).finally(() => { loadingMoon = false; });
    }
    // Solar color changes slowly. The field is reused for every video/GPU
    // frame; scrolling never regenerates it or changes its registration.
    timer = setTimeout(refresh, 20000 - now % 20000);
  }

  refresh(); // Set the first paint, even if the window opens at midnight.
  document.addEventListener('DOMContentLoaded', () => {
    surface = document.querySelector('.river-light');
    context = surface.getContext('2d');
    if (context) {
      const mask = new Image();
      mask.onload = () => {
        const sample = document.createElement('canvas');
        sample.width = mask.width;
        sample.height = mask.height;
        const reader = sample.getContext('2d');
        if (!reader) return;
        reader.drawImage(mask, 0, 0);
        zones = reader.getImageData(0, 0, mask.width, mask.height);
        refresh();
      };
      mask.src = 'assets/river-scene/solar-zones.png?v=1';
      surface.addEventListener('contextrestored', refresh);
    }
    portrait.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    refresh();
  });
})();
