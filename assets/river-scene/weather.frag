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
    vec2 a = texture2D(uCloudNoise, (volumeTile(z0) + pixel) / vec2(1024.,512.)).rg;
    vec2 b = texture2D(uCloudNoise, (volumeTile(mod(z0 + 1.0, 64.0)) + pixel) / vec2(1024.,512.)).rg;
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
    float a = texture2D(uCloudNoise, vec2(.5,1.)*clamp(mapUv - travel*(p-.5), .002, .998)).b;
    float b = texture2D(uCloudNoise, vec2(.5,1.)*clamp(mapUv - travel*(q-.5), .002, .998)).b;
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

vec3 highVeil(vec3 clear, vec3 view, float wind, float warmth) {
    // A higher, wind-sheared sheet remains visible through holes in the
    // cumulus. Integrate three thin strata with different depth and parallax.
    vec3 ray = view / max(view.y, .11);
    float tau = 0.;
    for (int i = 0; i < 3; i++) {
        float h = 2.45 + .065*float(i);
        vec3 parcel = ray*h*vec3(.074,.53,.21) + vec3(-wind*2., .28, .13);
        vec2 stria = volumeNoise(parcel);
        tau += .16*smoothstep(.39,.68,stria.x+.15*(stria.y-.5));
    }
    vec3 light = mix(vec3(.79,.82,.89),vec3(.97,.815,.75),warmth);
    return mix(clear, light, 1.-exp(-tau));
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
    vec3 clear = highVeil(mix(zenith, horizon, pow(low,1.28)), view, wind, warmth);
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

vec2 valleyTile(vec2 px, float clearLayer) {
    vec2 local = clamp((px - vec2(800.,75.)) / vec2(917.,293.), 0., 1.);
    return vec2((513.5 + 509.*local.x)/1024., (254.5 + clearLayer*256. - 253.*local.y)/512.);
}

float vaporColumn(vec2 px, float wind, vec2 travel) {
    float a = fract(wind);
    float b = fract(wind+.5);
    float blend = 1.-abs(2.*a-1.);
    blend *= blend*(3.-2.*blend);
    float first = texture2D(uCloudNoise,valleyTile(px - (a-.5)*travel,0.)).r;
    float second = texture2D(uCloudNoise,valleyTile(px - (b-.5)*travel,0.)).r;
    return mix(second,first,blend);
}

vec3 valleyMist(vec3 land, vec2 uv, vec2 sourceUv, float wind, float mist) {
    vec2 px = vec2(uv.x,1.-uv.y)*plate;
    vec2 sourcePx = vec2(sourceUv.x,1.-sourceUv.y)*plate;
    vec3 terrain = texture2D(uCloudNoise,valleyTile(sourcePx,1.)).rgb;
    // Lift and advect the recovered optical depth over an immobile hillside.
    // Lower spray rises while the higher banks flow along the valley's grade.
    float crest = smoothstep(278.,337.,px.y);
    vec2 travel = mix(vec2(117.,22.),vec2(60.,-35.),crest);
    float guide = vaporColumn(px,wind,travel);
    float optical = -log(max(.08,1.-.94*guide));
    vec3 plume = vec3(px.x*.0032, px.y*.0074, .42) + vec3(-wind,0.,0.);
    float transmittance = 1.;
    vec3 scatter = vec3(0.);
    float east = smoothstep(1050.,1600.,px.x) * (1.-crest);
    vec3 shaded = mix(vec3(.55,.63,.73),vec3(.69,.64,.72),east);
    vec3 lit = mix(vec3(.83,.87,.94),vec3(.99,.82,.79),east);
    for (int i = 0; i < 6; i++) {
        float depth = (float(i)+.5)/6.;
        vec3 point = plume + vec3(.15,.09,.67)*depth;
        vec2 eddy = volumeNoise(point);
        float billow = smoothstep(.23,.72,eddy.x+.19*(eddy.y-.5));
        float density = (.094+1.32*optical)*(.22+1.63*billow);
        float absorbed = 1.-exp(-density/6.);
        float sun = clamp(.47 + .53*depth + .65*(.55-eddy.x),.20,1.);
        scatter += transmittance*absorbed*mix(shaded,lit,sun);
        transmittance *= 1.-absorbed;
    }
    return mix(land, terrain*transmittance + scatter, mist);
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
    // The crown follows the arriving pressure front with a delayed recovery.
    // Each branch adds a faster secondary oscillation under the same gust.
    float lagged = valleyWind(uv,t-1.0).x;
    float limb = TAU*(uv.x*4.1 + uv.y*1.15 - t/8.0);
    float needles = TAU*(uv.x*19.4 - uv.y*6.3 - t/2.4);
    float bend = 18.*(.7*gust+.3*lagged-.44) +
                 (3.3+3.8*gust)*sin(limb+.58*sin(TAU*t/12.)) + 1.55*gust*sin(needles);
    float nearTrees = 1.0 - .18*smoothstep(.42,.88,uv.x);
    vec2 shift = mask.g*nearTrees*vec2(bend,
        .19*bend + (1.0+gust)*.92*sin(limb+.82));
    vec2 sourceUv = clamp(uv - shift/plate, .0001, .9999);
    vec3 sourceMask = texture2D(uWeatherMask, sourceUv).rgb;
    vec3 land = texture2D(uScene,sourceUv).rgb;
    if (sourceMask.g > .01) {
        float tilt = sin(limb) * (.40+.60*gust);
        land *= 1.0 + sourceMask.g*(.065*tilt + .027*(.5-gust));
    }
    if (sourceMask.b > .008) land = valleyMist(land,uv,sourceUv,wind.y,sourceMask.b);
    if (sourceMask.r > .003) land = mix(land,renderSky(uv,t,wind.y),sourceMask.r);
    // Fade only the very outside of the influence region. Moving silhouettes
    // replace both the needles and the tiny sky openings between them.
    gl_FragColor=vec4(land,smoothstep(.004,.085,weight));
}
