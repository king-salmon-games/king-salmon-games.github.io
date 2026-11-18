(() => {
  const rad = Math.PI / 180;
  const earthRadiusKm = 6378.137;
  const latitude = 43.5492 * rad;
  const longitude = -75.9423;
  const sinLat = Math.sin(latitude), cosLat = Math.cos(latitude);
  const earthEccentricitySq = 0.00669437999;
  const primeVertical = earthRadiusKm / Math.sqrt(1 - earthEccentricitySq * sinLat ** 2);

  // Perturbed lunar and solar orbits in the ecliptic of date, after Schlyter.
  // https://stjarnhimlen.se/comp/ppcomp.html
  function orbit(meanAnomaly, eccentricity, semimajor) {
    let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
    for (let i = 0; i < 2; i++) {
      eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
        / (1 - eccentricity * Math.cos(eccentricAnomaly));
    }
    const x = Math.cos(eccentricAnomaly) - eccentricity;
    const y = Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly);
    return { anomaly: Math.atan2(y, x), radius: semimajor * Math.hypot(x, y) };
  }

  function moonAt(time) {
    const daysUTC = time / 86400000 - 10957.5; // J2000 noon
    const days = daysUTC + 1.5 + 69.184 / 86400; // orbital epoch 1999-12-31 TT
    const sunMean = (356.0470 + 0.9856002585 * days) * rad;
    const sunPeri = (282.9404 + 4.70935e-5 * days) * rad;
    const sunOrbit = orbit(sunMean, 0.016709 - 1.151e-9 * days, 149597870.7);
    const sunLon = sunPeri + sunOrbit.anomaly;

    const node = (125.1228 - 0.0529538083 * days) * rad;
    const peri = (318.0634 + 0.1643573223 * days) * rad;
    const mean = (115.3654 + 13.0649929509 * days) * rad;
    const inclination = 5.1454 * rad;
    const moonOrbit = orbit(mean, 0.0549, 60.2666);
    const arg = moonOrbit.anomaly + peri;
    const f = mean + peri; // mean argument of latitude
    const d = node + f - sunMean - sunPeri; // mean elongation
    const { sin, cos } = Math;
    const lon = node + Math.atan2(sin(arg) * cos(inclination), cos(arg)) + rad * (
      -1.274 * sin(mean - 2 * d) + .658 * sin(2 * d) - .186 * sin(sunMean)
      - .059 * sin(2 * mean - 2 * d) - .057 * sin(mean - 2 * d + sunMean)
      + .053 * sin(mean + 2 * d) + .046 * sin(2 * d - sunMean) + .041 * sin(mean - sunMean)
      - .035 * sin(d) - .031 * sin(mean + sunMean) - .015 * sin(2 * f - 2 * d)
      + .011 * sin(mean - 4 * d));
    const lat = Math.asin(sin(arg) * sin(inclination)) + rad * (
      -.173 * sin(f - 2 * d) - .055 * sin(mean - f - 2 * d) - .046 * sin(mean + f - 2 * d)
      + .033 * sin(f + 2 * d) + .017 * sin(2 * mean + f));
    const radiusKm = earthRadiusKm * (moonOrbit.radius - .58 * cos(mean - 2 * d) - .46 * cos(2 * d));

    const tilt = (23.4393 - 3.563e-7 * days) * rad;
    const sidereal = (280.46061837 + 360.98564736629 * daysUTC + longitude) * rad;
    function localAxes(x, y, z) {
      const equatorY = y * cos(tilt) - z * sin(tilt);
      const equatorZ = y * sin(tilt) + z * cos(tilt);
      const meridian = x * cos(sidereal) + equatorY * sin(sidereal);
      return [equatorY * cos(sidereal) - x * sin(sidereal),
        equatorZ * cosLat - meridian * sinLat, equatorZ * sinLat + meridian * cosLat];
    }
    const moon = localAxes(radiusKm * cos(lat) * cos(lon), radiusKm * cos(lat) * sin(lon), radiusKm * sin(lat));
    const sun = localAxes(sunOrbit.radius * cos(sunLon), sunOrbit.radius * sin(sunLon), 0);
    // Translate from Earth's center to a WGS84 observer at the Falls. Lunar
    // parallax shifts the disk by nearly a degree as it crosses the horizon.
    const east = moon[0];
    const north = moon[1] + primeVertical * earthEccentricitySq * sinLat * cosLat;
    const up = moon[2] - primeVertical * (1 - earthEccentricitySq * sinLat ** 2);
    const distanceKm = Math.hypot(east, north, up);
    const az = Math.atan2(east, north);
    const alt = Math.atan2(up, Math.hypot(east, north));
    const geometricAltitude = alt / rad;
    // Standard-atmosphere refraction near the visible horizon. Taper below
    // -1 degree where weather dominates the apparent position.
    const h = Math.max(-1, geometricAltitude);
    const refraction = Math.max(0, 1.02 / (60 * Math.tan((h + 10.3 / (h + 5.11)) * rad)));
    const altitude = geometricAltitude + refraction * Math.max(0, Math.min(1, geometricAltitude + 2));

    // Project a direction onto the plane of the disk. Positive x is toward
    // increasing azimuth, positive y toward zenith, positive z toward us.
    function diskAxes([e, n, u]) {
      const forward = e * sin(az) + n * cos(az);
      return [e * cos(az) - n * sin(az), u * cos(alt) - forward * sin(alt),
        -u * sin(alt) - forward * cos(alt)];
    }
    const sunlight = sun.map((value, axis) => value - moon[axis]);
    const sunDistance = Math.hypot(...sunlight);
    const [lightX, lightY, lightZ] = diskAxes(sunlight).map(value => value / sunDistance);
    const illumination = (1 + lightZ) / 2;
    // The Moon's spin pole and orbital pole precess together on opposite
    // sides of the ecliptic pole (Cassini's laws). Orient the maria accordingly.
    const poleTilt = 1.543 * rad;
    const pole = localAxes(-sin(poleTilt) * sin(node), sin(poleTilt) * cos(node), cos(poleTilt));
    const [poleX, poleY] = diskAxes(pole);

    return {
      altitude, geometricAltitude, azimuth: (az / rad + 360) % 360, distanceKm,
      angularRadius: Math.asin(1737.4 / distanceKm) / rad,
      illumination, waxing: sin(lon - sunLon) > 0, lightX, lightY, lightZ,
      poleAngle: Math.atan2(poleX, poleY), // radians clockwise from screen-up
      moonlight: Math.max(0, sin(altitude * rad)) * illumination ** 2
    };
  }

  window.riverMoonAt = moonAt;
})();
