precision highp float;

varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform vec4 uCrop;
uniform vec2 uResolution;
uniform float uTime;

const vec2 plateSize = vec2(1717.0, 916.0);
const vec3 frothColor = vec3(0.79, 0.89, 0.94);

float hash(vec2 p) {
    vec3 n = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
    n += dot(n, n.yxz + 33.33);
    return fract((n.x + n.y) * n.z);
}

float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
}

// x and y lie across and along a sheet. z is its local surface normal.
// Falling curtains have deep longitudinal folds; the pool has transverse waves.
struct Waves {
    vec3 kx;
    vec3 ky;
    vec3 phase;
    vec3 amplitude;
};

Waves waveField(float pool, vec2 coords) {
    Waves w = Waves(
        mix(vec3(7.7, 13.1, -3.5), vec3(1.7, -2.6, 4.3), pool),
        mix(vec3(1.9, 3.3, 6.1), vec3(5.3, 9.7, 13.7), pool),
        uTime * mix(vec3(-0.46, -0.81, -3.7), vec3(-2.0, -3.65, -5.4), pool),
        mix(vec3(0.033, 0.013, 0.024), vec3(0.043, 0.021, 0.012), pool)
    );
    // A third wave radiates away from the foot of the main cascade. Linearize
    // its expanding, elliptical front within this ray's short tracing interval.
    const vec2 impact = vec2(0.34, -0.23);
    vec2 radial = (coords - impact) * vec2(0.73, 1.0);
    vec2 k = 10.3 * vec2(0.73, 1.0) * radial / max(length(radial), 0.045);
    w.kx.z = mix(w.kx.z, k.x, pool);
    w.ky.z = mix(w.ky.z, k.y, pool);
    w.phase.z -= pool * dot(k, impact);
    return w;
}

const vec3 bend = vec3(0.92, -0.65, 1.26);
const vec2 bendDirection = vec2(1.37, 1.06);

vec3 wavePhases(vec2 p, Waves w) {
    float curl = sin(dot(p, bendDirection) - uTime * 0.48);
    return w.kx * p.x + w.ky * p.y + w.phase + bend * curl;
}

float waterDistance(vec3 p, Waves w) {
    float height = dot(sin(wavePhases(p.xy, w)), w.amplitude);
    // Signed slab field with half-thickness 0.018. The scale bounds distance
    // conservatively after bending, keeping a march step outside the front face.
    return (abs(p.z - height) - 0.018) * 0.75;
}

// Analytic normal of the field's upper zero surface. Include the derivative of
// the coordinate bend so reflected light follows the curling geometry.
vec3 surfaceNormal(vec2 p, Waves w, vec3 phases) {
    vec3 slope = w.amplitude * cos(phases);
    float bendSlope = cos(dot(p, bendDirection) - uTime * 0.48) * dot(slope, bend);
    vec2 gradient = vec2(dot(slope, w.kx), dot(slope, w.ky)) + bendDirection * bendSlope;
    return normalize(vec3(-gradient, 1.0));
}

vec2 plateUv(vec2 pixelOffset) {
    return pixelOffset * vec2(1.0, -1.0) / plateSize;
}

// Hand-traced banks and rock islands gate both the receiver and the texture
// source, so water doesn't pull a neighboring slab of dark basalt downstream.
vec3 flowSample(vec2 uv, vec2 offset, float pool, vec3 base) {
    vec2 source = uv + plateUv(offset);
    vec2 material = texture2D(uMask, source).rg;
    float wet = mix(material.r, material.g, pool);
    return mix(base, texture2D(uScene, source).rgb, smoothstep(0.006, 0.32, wet));
}

void main() {
    vec2 uv = uCrop.xy + vUv * uCrop.zw;
    vec3 mask = texture2D(uMask, uv).rgb;
    float coverage = max(max(mask.r, mask.g), mask.b);
    if (coverage < 0.004) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec3 base = texture2D(uScene, uv).rgb;
    // Map the foreground into receding perspective. Distant crests converge
    // near the impact pool and spread apart as the brook approaches the camera.
    vec2 pixel = vec2(uv.x, 1.0 - uv.y) * plateSize;
    vec2 p = pixel * 0.01;
    float pool = smoothstep(-0.10, 0.10, mask.g - mask.r);
    float nearBank = max(p.y - 6.84, 0.0);
    vec2 poolCoords = vec2((p.x - 11.6) / (0.92 + 0.39 * nearBank),
                            nearBank * 2.55 / (0.62 + 0.42 * nearBank));
    vec2 sheetCoords = mix(p, poolCoords, pool);

    Waves waves = waveField(pool, sheetCoords);
    vec3 ray = normalize(mix(vec3(0.14, 0.20, -1.0), vec3(-0.12, 0.78, -0.88), pool));
    vec3 point = vec3(sheetCoords, 0.23);
    // Trace an oblique viewing ray through the finite-thickness sheet. Both
    // the displaced intersection and its normal drive the material below.
    for (int i = 0; i < 6; ++i) {
        point += ray * waterDistance(point, waves);
    }
    vec3 phases = wavePhases(point.xy, waves);
    vec3 normal = surfaceNormal(point.xy, waves, phases);
    vec2 rayShift = (point.xy - sheetCoords) - ray.xy * (0.212 / -ray.z);

    float lane = noise(vec2(p.x * 1.6 + p.y * 0.31, p.y * 0.48));
    // The brook falls right over the small near ledge and left over the upper tiers.
    float fallSlant = mix(13.0, -16.0, smoothstep(8.9, 11.4, p.x));
    vec2 curtainFlow = vec2(fallSlant + 9.0 * (lane - 0.5),
                             53.0 + 20.0 * lane + max(p.y - 3.3, 0.0) * 5.4);
    vec2 streamFlow = vec2(-12.0 + 23.0 * sin(p.x * 0.36 + lane * 2.5),
                             10.0 + nearBank * 11.5);
    streamFlow.x += clamp(p.x - 11.8, -1.0, 1.0) * 12.0 / (1.0 + 2.0 * nearBank);
    vec2 flow = mix(curtainFlow, streamFlow, pool);
    // Pin the entry and exit of each sheet. Otherwise a moving copy of the
    // bright crest at the lip creates a second ledge inside the curtain.
    vec2 along = plateUv(flow * 0.63);
    vec2 room = min(texture2D(uMask, uv - along).rg, texture2D(uMask, uv + along).rg);
    float freedom = mix(0.055, 1.0, smoothstep(0.04, 0.80, mix(room.r, room.g, pool)));
    flow *= freedom;
    vec2 refraction = normal.xy * mix(vec2(4.5, 6.0), vec2(5.8, 4.2), pool)
                      + rayShift * mix(42.0, 35.0, pool);
    refraction *= mix(0.24, 1.0, freedom);
    float phase = fract(uTime * mix(0.92, 0.67, pool) + lane * 0.69);
    float secondPhase = fract(phase + 0.5);
    float blend = 1.0 - abs(phase * 2.0 - 1.0);
    blend = blend * blend * (3.0 - 2.0 * blend);
    vec3 a = flowSample(uv, refraction - flow * (phase - 0.5), pool, base);
    vec3 b = flowSample(uv, refraction - flow * (secondPhase - 0.5), pool, base);
    vec3 water = mix(b, a, blend);

    // Silver-blue sky in the film of water, with warmer light to the right.
    vec3 light = normalize(vec3(0.46, -0.62, 0.71));
    float lightChange = dot(normal, light) - light.z;
    float fresnel = pow(1.0 - clamp(dot(normal, -ray), 0.0, 1.0), 2.5);
    vec2 skyUv = clamp(vec2(uv.x + normal.x * 0.09, 0.86 + normal.y * 0.13), 0.01, 0.99);
    vec3 sky = texture2D(uScene, skyUv).rgb;
    water *= 1.0 + lightChange * mix(0.27, 0.33, pool);
    water = mix(water, sky, fresnel * mix(0.16, 0.37, pool));
    float glint = pow(max(dot(normal, normalize(light - ray)), 0.0), 26.0);
    water += vec3(0.79, 0.87, 0.92) * glint * mix(0.044, 0.075, pool);

    // Foam collects on high curvature crests, then twists into fine strands.
    // Vary the strand threshold spatially so the crests break into patches.
    float crest = dot(sin(phases), vec3(0.45, 0.33, 0.22));
    float turbulence = noise(sheetCoords * vec2(3.2, 2.5) - vec2(0.12, 0.59) * uTime);
    float filament = sin(phases.y + sin(phases.x) * 1.25 + turbulence * 4.0);
    float lineWidth = clamp(uCrop.w * plateSize.y / uResolution.y * 0.05, 0.055, 0.17);
    float strand = 1.0 - smoothstep(lineWidth, lineWidth + 0.21, abs(filament));
    float foam = strand * smoothstep(0.07, 0.58, crest) * smoothstep(0.26, 0.68, turbulence);
    water = mix(water, frothColor, foam * mix(0.16, 0.30, pool));

    float wet = max(mask.r, mask.g);
    vec3 color = mix(base, water, clamp(wet / coverage, 0.0, 1.0));
    if (mask.b > 0.014) {
        // Two scales of spray move upward from the impact. Refracting the
        // underlying highlights preserves the shape and depth of the mist plume.
        float billow = noise(p * 2.3 + vec2(-0.16, 0.84) * uTime);
        float wisp = noise(p * 5.7 + vec2(0.21, 1.45) * uTime + billow);
        vec2 drift = vec2(billow - 0.5, wisp - 0.5) * 6.0;
        vec3 mist = texture2D(uScene, uv + plateUv(drift)).rgb;
        float air = smoothstep(0.27, 0.82, billow * 0.66 + wisp * 0.34);
        mist = mix(mist, frothColor, 0.25 * air);
        color = mix(color, mist, clamp(mask.b / coverage, 0.0, 1.0) * (0.24 + 0.45 * air));
    }
    gl_FragColor = vec4(color, smoothstep(0.002, 0.94, coverage));
}
