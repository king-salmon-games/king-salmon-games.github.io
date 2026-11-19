uniform sampler2D uImpactResponse;
// Lower bound on every decoded depth texel, checked by bake_pool_response.py.
const float impactMinDepth = .12;

// 128 x 64 screen-registered tiles, 8 columns x 25 rows. Three groups of
// eight rows hold causal Green's functions; the last row holds bathymetry.
vec2 impactLocal(vec2 world) {
    return clamp((poolToPixel(world)-vec2(480.,672.))/vec2(1237.,244.),0.,1.);
}

vec3 impactTexel(vec2 local, vec2 tile) {
    vec2 texel = tile*vec2(128.,64.) + .5 + local*vec2(127.,63.);
    vec2 uv = texel/vec2(1024.,1600.);
    return texture2D(uImpactResponse,vec2(uv.x,1.-uv.y)).rgb;
}

vec3 impactFrame(vec2 local, float source, float frame) {
    vec2 tile = vec2(mod(frame,8.),source*8.+floor(frame/8.));
    vec3 encoded = (255.*impactTexel(local,tile)-128.)/127.;
    return encoded*abs(encoded)*vec3(.18,.26,.58);
}

// Signed elevation (m), d elevation / d X, d elevation / d downstream Z.
// The faint residual after several pool crossings dies out smoothly. The
// terminal sample never wraps around to the beginning of the pressure pulse.
vec3 impactResponse(vec2 world, float source, float age) {
    if (age <= 0. || age >= 8.) return vec3(0.);
    vec2 local = impactLocal(world);
    float at = min(63.,age*8.);
    float frame = floor(at);
    return (1.-smoothstep(6.8,8.,age)) * mix(impactFrame(local,source,frame),
        impactFrame(local,source,min(frame+1.,63.)),fract(at));
}

// Undisturbed water depth (m), signed bank distance (m, positive in water),
// and inward bank normal in X/Z. The open downstream edge is not a bank.
vec4 impactBoundary(vec2 world, out vec2 depthGradient) {
    vec2 local = impactLocal(world);
    vec3 depthBank = impactTexel(local,vec2(0.,24.));
    vec3 shore = impactTexel(local,vec2(1.,24.));
    vec2 normal = (255.*shore.rg-128.)/127.;
    depthGradient = (255.*vec2(depthBank.b,shore.b)-128.)/254.;
    return vec4(depthBank.x, (255.*depthBank.y-128.)*(2.5/127.),
                normal/max(.001,length(normal)));
}

vec4 impactBoundary(vec2 world) {
    vec2 depthGradient;
    return impactBoundary(world,depthGradient);
}
