import assert from 'node:assert/strict';

globalThis.window = {};
await import('../river-moon.js');

// NASA/JPL Horizons DE441 observer tables: https://ssd-api.jpl.nasa.gov/doc/horizons.html
// Query each UTC instant below for COMMAND=301 (Moon) and 10 (Sun), CENTER=coord@399,
// COORD_TYPE=GEODETIC, SITE_COORD='-75.9423,43.5492,0', TIME_TYPE=UT, APPARENT=AIRLESS,
// QUANTITIES='4,10,23'. Azimuth is clockwise from north. /T is waxing and /L is waning.
// For the horizon-up bright limb, use both Horizons directions. With dAz = sunAz - moonAz,
// right = cos(sunAlt)*sin(dAz), up = sin(sunAlt)*cos(moonAlt) - cos(sunAlt)*cos(dAz)*sin(moonAlt).
// atan2(right, up) measures the Sun's direction on the disk clockwise from vertical.
// UTC                        az (deg)   airless alt   lit fraction  limb (deg)  waxing
const samples = [
  ['2026-03-08T06:59:00Z',     154.81841,   21.14559,    .7756689,   -130.74403, false],
  ['2026-11-01T06:01:00Z',      87.16694,   29.20630,    .5625482,   -153.89980, false],
  ['2026-11-18T23:40:00Z',     170.36132,   40.37193,    .6462117,    105.25258, true],
  ['2026-11-19T08:00:00Z',     285.03282,  -20.17149,    .6746438,    156.80357, true],
  ['2026-11-24T03:00:00Z',     135.32170,   64.39035,    .9949281,     36.63914, true],
];

const degrees = 180 / Math.PI;
const angleError = (a, b) => ((a - b + 540) % 360) - 180;
for (const [utc, azimuth, altitude, illumination, limb, waxing] of samples) {
  const moon = window.riverMoonAt(Date.parse(utc));
  const limbAngle = Math.atan2(moon.lightX, moon.lightY) * degrees;
  assert.ok(Math.abs(angleError(moon.azimuth, azimuth)) < .15, `${utc} azimuth ${moon.azimuth}`);
  assert.ok(Math.abs(moon.geometricAltitude - altitude) < .06, `${utc} altitude ${moon.geometricAltitude}`);
  assert.ok(Math.abs(moon.illumination - illumination) < .0006, `${utc} illumination ${moon.illumination}`);
  assert.ok(Math.abs(angleError(limbAngle, limb)) < .4, `${utc} bright limb ${limbAngle}`);
  assert.equal(moon.waxing, waxing, `${utc} waxing`);
}

console.log(`Matched ${samples.length} JPL Horizons lunar samples at Salmon River Falls.`);
