precision highp float;

varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uWeatherMask;
uniform sampler2D uCloudNoise;
uniform vec4 uCrop;
uniform vec2 uResolution;
uniform float uTime;

const float TAU = 6.28318530718;
const vec2 plate = vec2(1717.0, 916.0);

#include "wind.glsl"

// Trilinear 3D Perlin-Worley density and cellular erosion. Each slice includes
// a one-texel wrapping border so interpolation cannot spill into the next slice.
vec2 volumeTile(float z) {
    return vec2(mod(z, 8.0), floor(z / 8.0)) * 64.0;
}

vec2 volumeNoise(vec3 p) {
    vec3 cell = fract(p) * vec3(62.0, 62.0, 64.0);
    float z0 = floor(cell.z);
    vec2 pixel = cell.xy + 1.5;
    vec2 a = texture2D(uCloudNoise, (volumeTile(z0) + pixel) / 512.0).rg;
    vec2 b = texture2D(uCloudNoise, (volumeTile(mod(z0 + 1.0, 64.0)) + pixel) / 512.0).rg;
    return mix(a, b, fract(cell.z));
}

// Blue is a separate weather map, derived from cloud cover in the original sky.
// Advect column coverage more slowly than fine billows. Two columns overlap
// as a map tile crosses the valley so the photographed mountain rim stays put.
float columnMap(vec2 uv, float cycle) {
    vec2 mapUv = vec2(uv.x, (uv.y - (1.0 - 232.0 / 916.0)) * (916.0 / 232.0));
    vec2 travel = vec2(.129,.056);
    float p = fract(cycle);
    float q = fract(cycle + .5);
    float t = 1.0 - abs(2.0*p - 1.0);
    t = t*t*(3.0-2.0*t);
    float a = texture2D(uCloudNoise, clamp(mapUv - travel*(p-.5), .002, .998)).b;
    float b = texture2D(uCloudNoise, clamp(mapUv - travel*(q-.5), .002, .998)).b;
    return mix(b, a, t);
}

float density(vec3 p, float cover, vec3 drift) {
    float h = (p.y - .74) / 1.08;
    float profile = smoothstep(0.0,.24,h) * (1.0-smoothstep(.55,1.0,h));
    vec2 fields = volumeNoise(p * vec3(.224, .37, .149) - drift);
    float body = fields.x + .66 * (cover - .48);
    float eroded = body - mix(.24, .47, fields.y) - .16*(1.0-profile);
    return smoothstep(-.08,.39,eroded) * profile;
}

vec3 renderSky(vec2 uv, float t, float wind) {
    float cycle = t / 48.0;
    vec3 drift = vec3(wind, .012*sin(TAU*cycle), .017*sin(TAU*cycle-.4));
    vec3 view = normalize(vec3((uv.x-.63)*2.03, .092+(uv.y-.74)*1.22, 1.0));
    vec3 sun = normalize(vec3(.85,.18,.72));
    float low = clamp((1.02-uv.y)/.24,0.0,1.0);
    float east = smoothstep(.54,1.02,uv.x);
    float warmDistance = (uv.x-.91)/.208;
    float gapHeight = (uv.y-.814)/.040;
    float warmth = exp(-warmDistance*warmDistance);
    float clearing = warmth * exp(-gapHeight*gapHeight);
    vec3 zenith = mix(vec3(.48,.57,.72),vec3(.67,.61,.73),east);
    vec3 horizon = mix(vec3(.70,.73,.82),vec3(1.0,.853,.749),warmth);
    vec3 clear = mix(zenith, horizon, pow(low,1.28));
    float cover = clamp(columnMap(uv,wind) + .035 - .29*clearing, .03, .95);

    // Trace a shallow cloud deck from its base to its top. At a grazing angle
    // the ray travels farther through the cloud than it does overhead.
    const int STEPS = 12;
    float dy = max(view.y,.105);
    float entry = .74/dy;
    float stepLength = 1.08/(dy*float(STEPS));
    vec3 point = view * (entry + .52*stepLength);
    vec3 radiance = vec3(0.0);
    float through = 1.0;
    float cosine = clamp(dot(view,sun),0.0,1.0);
    // Henyey-Greenstein phase plus diffuse multiple scattering from the sky.
    const float g = .48;
    float phase = (1.0-g*g) / pow(1.0+g*g-2.0*g*cosine,1.5);
    vec3 shadow = mix(vec3(.346,.401,.53),vec3(.503,.432,.534),east);
    vec3 sunlit = mix(vec3(.82,.845,.914),vec3(1.0,.828,.742),warmth);
    for (int i=0;i<STEPS;i++) {
        float rho = density(point,cover,drift);
        if (rho > .012) {
            float optical = rho * stepLength * 2.55;
            float scatter = 1.0-exp(-optical);
            // Secondary samples toward the low sun estimate in-cloud extinction.
            float lightDepth = .44*density(point+.40*sun,cover,drift)
                             + .61*density(point+1.07*sun,cover,drift);
            float beam = exp(-3.65*lightDepth);
            float silver = min(1., beam*(.62+.15*phase) + .09*(point.y-.74));
            vec3 source = mix(shadow,sunlit,silver);
            radiance += through*scatter*pow(source,vec3(2.2));
            through *= 1.0-scatter;
        }
        point += view*stepLength;
    }
    return pow(radiance+through*pow(clear,vec3(2.2)),vec3(1.0/2.2));
}

vec3 valleyMist(vec3 land, vec2 uv, float t, float wind, float mist) {
    // This thin, lower bank sits behind the nearest trees. Its short optical
    // path is distinct from the upper deck and its eddies drift more slowly.
    vec3 p = vec3(uv.x*2.4 - wind, uv.y*3.0, .35+.024*sin(TAU*t/48.));
    float air = volumeNoise(p).x;
    float fine = volumeNoise(p*vec3(2.,1.7,1.4)+vec3(.21,.40,0.)).y;
    float tau = mist * ( .09 + .46*smoothstep(.25,.74,air+.18*(fine-.5)) );
    vec3 mistColor = mix(vec3(.58,.67,.77),vec3(.79,.72,.757),smoothstep(.63,1.,uv.x));
    return mix(land,mistColor,1.-exp(-tau));
}

void main() {
    vec2 uv = uCrop.xy + vUv*uCrop.zw;
    vec3 mask = texture2D(uWeatherMask,uv).rgb;
    float weight = max(max(mask.r,mask.g),mask.b);
    if (weight < .004) { gl_FragColor=vec4(0.0); return; }

    float t = mod(uTime,48.);
    vec2 wind = valleyWind(uv,t);
    float gust = wind.x;
    // Tips lag the arriving gust and shiver around its sustained bend. The
    // flexibility map goes to zero at rooted trunks and exposed rock.
    float limb = TAU*(uv.x*4.1 + uv.y*1.7 - t/6.0);
    float needles = TAU*(uv.x*19.4 - uv.y*6.3 - t/2.4);
    float bend = 6.8*(gust-.30) + (1.1+1.9*gust)*sin(limb+.58*sin(TAU*t/12.))
                                + .80*gust*sin(needles);
    float nearTrees = 1.0 - .40*smoothstep(.44,.74,uv.x);
    vec2 shift = mask.g*nearTrees*vec2(bend,
        .17*bend + (1.0+gust)*.53*sin(limb+.82));
    vec2 sourceUv = clamp(uv - shift/plate, .0001, .9999);
    vec3 sourceMask = texture2D(uWeatherMask, sourceUv).rgb;
    vec3 land = texture2D(uScene,sourceUv).rgb;
    if (sourceMask.g > .01) {
        float tilt = sin(limb) * (.40+.60*gust);
        land *= 1.0 + sourceMask.g*(.032*tilt + .025*(.5-gust));
    }
    if (sourceMask.b > .008) land = valleyMist(land,uv,t,wind.y,sourceMask.b);
    if (sourceMask.r > .003) land = mix(land,renderSky(uv,t,wind.y),sourceMask.r);
    // Fade only the very outside of the influence region. Moving silhouettes
    // replace both the needles and the tiny sky openings between them.
    gl_FragColor=vec4(land,smoothstep(.004,.085,weight));
}
