precision highp float;

varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform sampler2D uDynamics;
uniform sampler2D uWeather;
uniform vec4 uCrop;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWindTime;
uniform float uPoolDetail;

const vec2 plateSize = vec2(1717.0, 916.0);
const float gravity = 9.81;
const float tau = 6.2831853;
const vec3 luminance = vec3(0.2126, 0.7152, 0.0722);

// Water has an independent, continuous clock. The local gust stays in step
// with the visible clouds even when the atmospheric film wraps.
float flowTime() {
    return 0.5 * uTime;
}

float hash(vec2 p) {
    vec3 h = fract(p.xyx * vec3(.1031, .1030, .0973));
    h += dot(h, h.yxz + 33.33);
    return fract((h.x + h.y) * h.z);
}

float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
}

#include "wind.glsl"

vec2 uvOffset(vec2 pixels) {
    return pixels * vec2(1.0, -1.0) / plateSize;
}

vec3 environment(vec2 uv) {
    vec2 lookup = clamp(uv, .001, .999);
    vec4 weather = texture2D(uWeather, lookup);
    return mix(texture2D(uScene, lookup).rgb, weather.rgb, weather.a);
}

vec3 wetSample(vec2 uv, vec2 offset, vec2 material, vec3 fallback) {
    vec2 src = uv + uvOffset(offset);
    float coverage = dot(texture2D(uMask, src).rg, material);
    return mix(fallback, texture2D(uScene, src).rgb, smoothstep(.015, .34, coverage));
}

#include "measured-falls.glsl"

// Top edges of the main shelf and its three lower lateral ledges, in plate pixels.
float ledge(float x, float tier) {
    if (tier > 2.5) return 570.0 + .16*(x-743.0) + .00055*(x-765.0)*(x-765.0);
    if (tier > 1.5) return 487.0 - .14*(x-785.0);
    if (tier > .5) return 409.0 - .07*(x-868.0);
    float right = max(x-1155.0,0.0);
    return 370.0 - .068*(x-1150.0) - .00017*right*right
           + 3.9*sin((x-1060.0)*.023);
}

// Onsets are defined at the plunge pool, on the water's clock in model seconds.
// Two intervals span at least (2 - .36) * 5.13 > 8.4 s, so the last two
// arrivals include every still-active 8 s response at each landing zone.
vec2 impactEvent(float source, float modelTime, float previous) {
    float spacing = 5.13 + .37*source;
    float laneTime = modelTime/spacing + .319 + .37*source;
    float slot = floor(laneTime);
    float offset = .19 + .36*hash(vec2(source+28.1,slot));
    slot -= (1.-step(offset,fract(laneTime))) + previous;
    float onset = slot + .19 + .36*hash(vec2(source+28.1,slot));
    float age = (laneTime-onset)*spacing;
    float strength = .68 + .78*hash(vec2(slot+.73,source+12.4));
    return vec2(age,strength);
}

// Sample the load of the nearest of the three pressure patches baked in
// tools/bake_pool_response.py. A falling parcel queries its arrival time;
// the spray queries its launch time. Both use the same pulse as the pool.
float impactLoad(float landingX, float modelTime) {
    float source = step(1022.5,landingX) + step(1245.,landingX);
    float center = source < .5 ? 900. : (source < 1.5 ? 1145. : 1345.);
    vec2 event = impactEvent(source,modelTime,0.);
    if (event.x < 0. || event.x >= .60) return 0.;
    float pulse = sin(3.14159265*event.x/.60);
    // At this waterline the solver's .54 m cross-stream radius is 35 pixels.
    float reach = (landingX-center)/35.;
    return event.y*pulse*pulse*exp(-.5*reach*reach);
}

// Uneven notches along the lip gather the upstream flow. A pulse can divide
// around a notch into two neighboring ropes, then rejoin the continuous sheet.
// Evaluate discharge at release time so the split travels down with the water.
float feederStreams(float lane, float launch, float flight, float tier) {
    float spacing = tier < .5 ? 1.54 : .92;
    float x = lane/spacing;
    float bank = floor(x);
    float spread = smoothstep(.14,.83,flight);
    float streams = 0.0;
    for (int j=-1; j<=1; j++) {
        float id = bank + float(j);
        float seed = hash(vec2(id,tier+2.7));
        float beat = launch*(.26+.36*seed) + 11.0*seed;
        float turn = floor(beat);
        float opening = mix(hash(vec2(id+3.5*tier,turn)),
                            hash(vec2(id+3.5*tier,turn+1.0)),smoothstep(0.,1.,fract(beat)));
        float center = id + .18+.64*seed + .27*(opening-.5)
                     + spread*.11*sin(launch*(.86+.57*seed)+18.4*seed);
        float split = spread*smoothstep(.30,.79,opening)*(.20+.13*seed);
        float width = (.13+.23*opening)*(1.0+.14*spread);
        vec2 distance = (x-center + vec2(-split,.68*split))/width;
        vec2 profile = max(vec2(0.),1.0-distance*distance);
        streams += (.18+.82*opening)*dot(profile*profile,vec2(.40,.60));
    }
    return streams;
}

vec2 fallBacktrace(float elapsed, float lateral, float vertical) {
    return vec2(-lateral*elapsed,elapsed*(.5*gravity*elapsed-vertical))/.0165;
}

// The gravity jet's launch time labels parcels along a streamline. A feature
// born at time T reaches the pixel at T+flight. Unlike scrolling a photograph,
// its apparent speed and longitudinal stretching rise continuously as it drops.
vec3 fallingWater(vec2 px, vec2 uv, vec3 base, float gust) {
    float tier = 0.0;
    if (px.x < 995.0 && px.y > 568.0) tier = 3.0;
    else if (px.x < 975.0 && px.y > 464.0) tier = 2.0;
    else if (px.x < 947.0) tier = 1.0;
    float metresPerPixel = .0165;
    float lateral = mix(-1.34, .64, step(2.5,tier));
    lateral *= .88+.23*noise(vec2(px.x*.009,4.0));
    float entry = .62;
    float rootX = px.x;
    float flight = 0.0;
    for (int i=0; i<3; ++i) {
        float drop = max(0.0,px.y-ledge(rootX,tier))*metresPerPixel;
        flight = (sqrt(entry*entry + 2.0*gravity*drop) - entry)/gravity;
        rootX = px.x - lateral*flight/metresPerPixel;
    }
    float speed = max(1.35, length(vec2(lateral, entry+gravity*flight)));
    float lane = rootX*metresPerPixel;
    float clock = flowTime();
    float launch = clock-flight;
    float surge = 0.;
    if (tier < .5 || tier > 2.5) {
        // Follow a parcel to the waterline before sampling its discharge.
        // The shorter ledges above the steps have their own ongoing flow.
        float toeHeight = max(0.,704. - ledge(rootX,tier))*metresPerPixel;
        float toeFlight = (sqrt(entry*entry + 2.*gravity*toeHeight)-entry)/gravity;
        float landingX = rootX + lateral*toeFlight/metresPerPixel;
        surge = impactLoad(landingX,launch+toeFlight);
    }
    vec2 parcel = vec2(lane, -launch);
    float streams = feederStreams(lane,launch,flight,tier);
    float feed = noise(vec2(lane*.56+.12*launch,launch*.31+6.4*tier));
    float braid = noise(parcel*vec2(1.15,1.82));
    float breakup = smoothstep(.36,1.05,flight);
    parcel.x += (.09+.14*breakup)*(braid-.5) + (.10+.21*breakup)*(feed-.5)
              + .055*sin(lane*1.12 + parcel.y*4.2);
    parcel.x -= breakup*gust*.085;
    float folds = noise(vec2(parcel.x*6.5, parcel.y*3.8 + 1.25*braid));
    // The main shelf releases a broad continuous sheet. The narrow ledges
    // shear into smaller threads and entrain air sooner in their shorter drop.
    float ledgeJet = step(.5,tier);
    float breadth = mix(3.60,1.85,ledgeJet);
    float fallBand = mix(1.25,2.0,ledgeJet);
    vec2 fieldUv = vec2(parcel.x/breadth,parcel.y*fallBand);
    fieldUv += vec2(.14*(feed-.5)+.065*(folds-.5)+.41*tier,
                    .32*(feed-.5)+.17*streams+.10*(braid-.5)+.23*tier);
    // Slower shape changes ride the jet. The measured recording supplies the
    // evolving fine folds while the release time determines their bulk travel.
    float materialTime = .83*launch + .34*flight + 3.7*feed + 1.37*tier;
    vec3 observed = measuredFallsMaterial(fieldUv,materialTime);
    // Strands compress sharply at the lip. Filter features that would cross
    // multiple source texels per display pixel there, particularly on mobile.
    vec2 pixel = plateSize*uCrop.zw/uResolution;
    float texels = max(128.0*metresPerPixel*pixel.x/breadth,
                       96.0*fallBand*metresPerPixel*pixel.y/(entry+gravity*flight));
    observed.gb *= 1.0/(1.0+.14*texels*texels);
    float aeration = smoothstep(.02,.95,flight*(1.0+.42*ledgeJet)+.25*braid);
    // Single-view relief is art-directed into the modeled sheet. The source
    // field supplies fold placement and optical contrast, not metric depth.
    float relief = observed.r*mix(.034,.020,ledgeJet)*(1.0-.23*breakup);
    float lean = observed.b*mix(.38,.28,ledgeJet);
    // q=v*h conserves the flux of a ribbon as gravity thins it.
    float flux = .035+.026*feed+.081*streams+.062*surge;
    float halfThickness = .5*flux/speed*(1.0-.26*ledgeJet)
        * (1.0+.29*observed.r+.13*observed.g);
    vec2 sheet = vec2(parcel.x, parcel.y*1.6);
    vec3 kx = vec3(6.8,15.4,-23.8);
    vec3 ky = vec3(2.8,-4.0,6.3);
    vec3 amplitude = vec3(.027,.009,.0038) * (.67+.36*braid+.52*streams);
    vec3 bend = vec3(.87,-1.3,.64)*sin(lane*1.53+parcel.y*2.05) + folds*.66 + 2.1*(feed-.5);
    vec3 ray = normalize(vec3(.21,.24,-1.0));
    vec3 point = vec3(sheet-ray.xy*(.15/-ray.z),.15);
    // Conservative signed distance to the two faces of the folded, thinning
    // liquid ribbon. Its upper zero crossing sets parallax and the optical path.
    for (int i=0; i<5; ++i) {
        vec3 phase = kx*point.x+ky*point.y+bend;
        float height = dot(amplitude,sin(phase)) + relief + lean*(point.x-sheet.x);
        float distanceToSheet = (abs(point.z-height)-halfThickness)*.73;
        point += ray*distanceToSheet;
    }
    vec3 derivative = amplitude*cos(kx*point.x+ky*point.y+bend);
    vec2 slope = vec2(dot(derivative,kx)+lean, dot(derivative,ky)*1.6/speed);
    vec3 N = normalize(vec3(-slope,1.0));
    vec2 parallax = (point.xy-sheet)/metresPerPixel;
    // Air shear shreds the sheet into shorter clusters nearer the plunge pool.
    // Their material coordinates continue to fall with the parent jet.
    float clusters = noise(vec2(parcel.x*4.6+.72*braid,parcel.y*10.2+.63*folds));
    float ribbons = .22*observed.r + mix(.125,.18,ledgeJet)*observed.g;
    ribbons = mix(ribbons,.64*ribbons+.083*(clusters-.5),breakup);
    float chop = smoothstep(.42,.80,folds+.50*ribbons);
    vec2 offset = parallax+N.xy*vec2(6.2,3.2)+vec2((braid-.5)*3.2, (folds-.5)*3.0);
    // Backtrace highlights along the accelerating jet. Two staggered exposure
    // windows pass through zero weight before restarting. Stagger their clocks
    // across the ledge so the entire curtain never pulses in unison.
    float phase = fract(clock/.79 + .43*sin(.84*lane) + .13*lane + .38*feed);
    float weight = .5-.5*cos(tau*phase);
    float travel = min(.79,1.02/(.54+.13*speed))*smoothstep(0.,.18,flight);
    vec2 fromA = fallBacktrace(travel*(phase-.5), lateral, entry+gravity*flight);
    vec2 fromB = fallBacktrace(travel*(fract(phase+.5)-.5), lateral, entry+gravity*flight);
    vec3 transported = mix(wetSample(uv,offset+fromB,vec2(1,0),base),
                           wetSample(uv,offset+fromA,vec2(1,0),base),weight);
    // Keep broad, stationary light from the cliff and carry the smaller-scale
    // plate texture downstream. Sample only inside the existing water mask.
    vec2 axis = normalize(vec2(lateral,entry+gravity*flight));
    vec2 across = vec2(axis.y,-axis.x);
    vec3 local = .55*transported
        + .23*wetSample(uv,offset+axis*15.1+across*6.7,vec2(1,0),base)
        + .22*wetSample(uv,offset-axis*16.5-across*5.4,vec2(1,0),base);
    float ln = dot(local,luminance);
    float light = dot(N,normalize(vec3(.68,-.28,.70)));
    float bubbles = clamp(.10+.25*aeration+.31*streams+.23*(folds-.5)+.64*ribbons+.15*aeration*surge
                          +(.085+.075*ledgeJet)*observed.g,0.0,1.0);
    // Beer-Lambert extinction in a bubble-laden sheet. Dense breaking ribbons
    // scatter the sky; thinner filaments transmit the shadow of the basalt.
    float path = (2.0*halfThickness+.025)/max(.28,dot(N,-ray));
    float scatter = 1.0-exp(-path*(8.0+25.0*bubbles));
    vec3 diffuse = local*(.88+.19*light);
    vec3 clouded = vec3(.66,.81,.91)*(.44+.69*ln+.14*chop);
    diffuse = mix(diffuse,clouded,scatter*(.24+.22*aeration));
    float contrast = .87*ribbons+.061*(folds-.50)+.033*(braid-.5)
                   + (.056+.095*aeration)*(streams-.21) + .075*surge*(.45+.55*aeration);
    diffuse += vec3(.84,.93,1.0)*contrast*(.46+.52*ln);
    float fresnel = .0204+.9796*pow(1.0-max(0.0,dot(N,-ray)),5.0);
    vec3 sky = environment(vec2(uv.x+N.x*.095,.85+N.y*.095));
    return mix(diffuse,sky,fresnel*(.67-.27*bubbles));
}

vec4 dynamicsTile(vec2 local, float frame) {
    vec2 cell = vec2(mod(frame,8.0),7.0-floor(frame/8.0));
    vec2 st = (vec2(.5)+vec2(local.x,1.0-local.y)*vec2(191.0,95.0))/vec2(192.0,96.0);
    return texture2D(uDynamics,(cell+st)*.125);
}

vec2 poolToPixel(vec2 world) {
    float s = (.55*world.y)/max(7.2-.45*world.y,.2);
    return vec2(1100.0+world.x*(58.0+50.0*s),672.0+244.0*s);
}

#include "measured-pool.glsl"
#include "impact-response.glsl"

// Responses are signed. Crossing crests can reinforce one another, and an
// incoming crest can cancel a reflected trough before either affects light.
vec3 impactWaves(vec2 world, float t) {
    vec3 wave = vec3(0.);
    for (int i=0; i<3; ++i) {
        float source = float(i);
        for (int j=0; j<2; ++j) {
            vec2 emission = impactEvent(source,t,float(j));
            wave += emission.y * impactResponse(world,source,emission.x);
        }
    }
    return wave;
}

vec3 nearBankRipple(vec3 wave, vec3 fade) {
    // Product rule for the damped height: its normal still describes its
    // actual surface where the small wave dies away against the bank.
    return vec3(fade.x*wave.x, fade.x*wave.yz + wave.x*fade.yz);
}

vec3 shoreFade(vec4 bed, vec2 displacement) {
    float s=clamp((bed.y+dot(bed.zw,displacement))/.65,0.,1.);
    return vec3(s*s*(3.-2.*s),bed.zw*(6.*s*(1.-s)/.65));
}

// Keep the total free surface above the bed in an exceptionally deep trough.
// Above the last quarter of the still-water column the response is linear.
vec3 wetColumnSurface(vec3 surface, vec2 point, vec2 target, float referenceDepth,
                      vec2 referenceSlope, out float depth) {
    vec2 displacement=point-target;
    depth=referenceDepth+dot(referenceSlope,displacement);
    if (surface.x >= -.75*impactMinDepth) return surface;
    // Only a deep trough needs additional bathymetry reads along the ray.
    vec2 bedSlope=referenceSlope;
    if (any(notEqual(point,target))) depth=impactBoundary(point,bedSlope).x;
    float q=surface.x/depth;
    if (q >= -.75) return surface;
    // F(q) and F'(q) join the unmodified surface continuously at q=-.75.
    // The remaining column tends to 2% of the local resting depth.
    float factor=1./(1.-(q+.75)/.23);
    float limited=-.98+.23*factor;
    float derivative=factor*factor;
    return vec3(depth*limited,derivative*surface.yz+(limited-q*derivative)*bedSlope);
}

vec4 poolState(vec2 world, float frame, vec2 drift, float recordedTime, vec3 fade) {
    vec2 local = clamp((poolToPixel(world)-vec2(480.0,672.0))/vec2(1237.0,244.0),0.0,1.0);
    float a = floor(frame);
    vec4 state = mix(dynamicsTile(local,a),dynamicsTile(local,mod(a+1.0,64.0)),fract(frame));
    vec3 surface = (state.rgb-.5) * vec3(.5,1.2,1.2);
    vec3 measured = nearBankRipple(measuredPoolWave(world + drift, recordedTime),fade);
    return vec4(.58 * surface + .69 * measured, clamp((state.a-.5)*2.0,0.0,1.0));
}

// Downstream flow splits at the two submerged gravel bars in the depth bake.
// The displaced water turns back into their lee. The velocity stays bounded
// even after hours of playback; it is never multiplied by the session age.
vec3 poolCurrent(vec2 p) {
    vec2 x = (p.x - vec2(-1.6,3.0)) / vec2(1.2,1.7);
    vec2 y = (p.y - vec2(4.15,5.45) - .26) / vec2(.92,1.10);
    vec2 bar = exp(-x*x-y*y);
    vec2 lee = exp(-x*x-(y-.95)*(y-.95));
    float side = dot(x*bar,vec2(.94,.76)) - dot(x*lee,vec2(.52,.42));
    float speed = .52+.11*sin(.63*p.x+.19*p.y) - dot(lee,vec2(.43,.39));
    return vec3(.10+side,speed,min(1.,dot(bar,vec2(1.))));
}

// Gravity-capillary dispersion for the short ripples below the fluid grid.
// World x is right and y downstream, in metres; z is height above equilibrium.
vec3 capillary(vec2 p, float gust) {
    vec3 kx=vec3(16.0,-24.0,43.0);
    vec3 ky=vec3(20.0,32.0,36.0);
    vec3 k=sqrt(kx*kx+ky*ky);
    vec3 omega=sqrt(gravity*k+.000073*k*k*k);
    vec2 current=vec2(.21,.49);
    float t = flowTime();
    float carrier = p.x*.83+p.y*.95-t*.88;
    vec3 bend = vec3(1.6,-1.13,1.22);
    vec3 phase=kx*(p.x-current.x*t)+ky*(p.y-current.y*t)-omega*t
              +bend*sin(carrier);
    vec3 a = vec3(.0021,.0010,.0006)*(.74+.53*gust);
    vec3 ca = a*cos(phase);
    vec3 turn = bend*cos(carrier);
    return vec3(dot(a,sin(phase)),dot(ca,kx+.83*turn),dot(ca,ky+.95*turn));
}

// Three directional packets resolve successively shorter surface waves
// (about 16, 10 and 7 cm). Their phases follow gravity-capillary dispersion.
// Build the packet once per ray, then evaluate it at each SDF intersection.
struct PoolPacket {
    vec3 phase;
    vec3 kx;
    vec3 ky;
    vec3 amplitude;
    vec3 harmonic;
};

vec3 trainHash(vec3 n) {
    vec3 h = fract(n * vec3(.1031,.0973,.1099));
    return fract(h*(h+33.33)*(h+19.19));
}

PoolPacket poolPacket(vec2 p, float s, float gust, float detail) {
    vec3 kx = vec3(35.0,-55.0,78.0);
    vec3 ky = vec3(19.0,31.0,-36.0);
    vec3 k = sqrt(kx*kx+ky*ky);
    vec3 omega = sqrt(gravity*k+.000073*k*k*k);
    float t = flowTime();
    vec2 parcel = p-vec2(.21,.49)*t;
    // Crests bend around longer waves and travel in groups. These local
    // wave vectors include the derivative of the bend over the ray segment.
    vec3 gx = vec3(1.1,-1.65,2.17);
    vec3 gy = vec3(1.8,1.37,-2.04);
    vec3 group = gx*parcel.x+gy*parcel.y-vec3(.85,1.18,1.37)*t+vec3(.3,2.7,1.8);
    vec3 turn = vec3(2.2,1.65,1.91);
    vec3 deflection = turn*cos(group);
    vec3 sx = vec3(-2.7,3.4,2.8);
    vec3 sy = vec3(3.3,2.8,-3.6);
    vec3 shear = sx*parcel.x+sy*parcel.y-vec3(.53,.86,.67)*t;
    PoolPacket packet;
    packet.phase = kx*parcel.x+ky*parcel.y-omega*t+turn*sin(group)+.92*sin(shear);
    packet.kx = kx+deflection*gx+.92*cos(shear)*sx;
    packet.ky = ky+deflection*gy+.92*cos(shear)*sy;
    // Analytic pixel footprint through the inverse pool projection. Filter
    // the slope as well as the height, including each sharper crest harmonic.
    vec2 pixel = uCrop.zw*plateSize/uResolution;
    float width = 58.0+50.0*s;
    float depth = .55+.45*s;
    vec3 dx = packet.kx*pixel.x/width;
    vec3 dy = (-50.0*p.x/width*packet.kx+3.96/(depth*depth)*packet.ky)*pixel.y/244.0;
    vec3 footprint = max(abs(dx),abs(dy));
    vec3 resolved = 1.0-smoothstep(vec3(.95),vec3(2.75),footprint);
    vec3 bands = smoothstep(vec3(0.,.08,.23),vec3(.64,.86,1.),vec3(detail));
    vec3 envelope = .60+.32*cos(group*.82+vec3(.5,1.4,.9))
                       +.08*sin(shear*.61+vec3(2.8,.9,1.6));
    packet.amplitude = vec3(.0044,.00235,.0014)*envelope*bands*resolved
                     * (.68+.32*s)*(.82+.34*gust);
    packet.harmonic = .125*(1.0-smoothstep(vec3(.95),vec3(2.75),2.0*footprint));
    return packet;
}

vec3 packetSurface(PoolPacket packet, vec2 displacement) {
    vec3 phase = packet.phase+packet.kx*displacement.x+packet.ky*displacement.y;
    vec3 crest = sin(phase);
    vec3 slope = cos(phase);
    // A bounded second harmonic raises and narrows each crest without
    // introducing a second independent frequency or reversing the current.
    vec3 shape = crest-packet.harmonic*(1.0-2.0*crest*crest);
    vec3 tangent = packet.amplitude*slope*(1.0+4.0*packet.harmonic*crest);
    return vec3(dot(packet.amplitude,shape),dot(tangent,packet.kx),dot(tangent,packet.ky));
}

// A bubble drifts with surface current after its parent wave rolls past.
// In steady streamline coordinates the speed stays bounded even on long visits.
// These two shoals are the same submerged bars used in the shallow-water bake.
vec2 carriedFoam(vec2 p, float s, vec2 current, float variation) {
    vec2 crossBar = (p.x - vec2(-1.6, 3.0)) / vec2(1.2, 1.7);
    vec2 alongBar = (p.y - vec2(4.15, 5.45) - .55) / vec2(1.15, 1.4);
    vec2 wake = exp(-crossBar*crossBar - alongBar*alongBar);
    float across = p.x - .24*p.y - .44*dot(crossBar, wake);
    float along = p.y + .24*(wake.x + wake.y) - .55*flowTime();
    vec2 parcel = vec2(across, along) - current * (.65*variation);
    float patch = noise(parcel*vec2(1.75, 1.30));
    float bend = noise(parcel*vec2(3.3, 2.15) + vec2(.8, 3.6));
    vec2 q = parcel*vec2(7.5, 3.1) + vec2(1.23*bend, .95*patch);

    // The edge of an advected patch stretches into a thin irregular filament.
    // Use its analytic gradient to resolve its width in metres at any crop.
    vec2 cell = floor(q);
    vec2 f = fract(q);
    vec2 w = f*f*(3.0-2.0*f);
    float a = hash(cell);
    float b = hash(cell+vec2(1,0));
    float c = hash(cell+vec2(0,1));
    float d = hash(cell+1.0);
    float value = mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
    vec2 derivative = 6.0*f*(1.0-f)
        * vec2(mix(b-a,d-c,w.y)*7.5, mix(c-a,d-b,w.x)*3.1);
    float magnitude = max(length(derivative), .65);
    float distance = abs(value - (.46 + .13*(patch-.5))) / magnitude;
    vec2 normal = derivative / magnitude;
    float width = 58.0+50.0*s;
    float depth = .55+.45*s;
    vec2 pixel = uCrop.zw*plateSize/uResolution;
    float footprint = abs(normal.x)*pixel.x/width
        + abs(3.96*normal.y/(depth*depth)-50.0*p.x*normal.x/width)*pixel.y/244.0;
    float radius = .009 + .013*bend;
    float halfPixel = max(.005, .5*footprint);
    float overlap = min(distance+halfPixel, radius) - max(distance-halfPixel, -radius);
    float filament = max(0.0, overlap)/(2.0*halfPixel);
    float torn = noise(1.7*q+vec2(3.6,-1.9));
    filament *= smoothstep(.23,.74,.67*torn+.33*patch);
    return vec2(patch, filament);
}

vec3 poolParcelColor(vec2 uv, vec2 offset, vec3 fallback) {
    vec2 path=uvOffset(offset);
    vec2 src=uv+path;
    vec2 edge=min(src,1.-src)*plateSize;
    float inside=smoothstep(0.,4.,min(edge.x,edge.y));
    // A long trace can have water at both ends and a rock in between.
    float through=min(texture2D(uMask,uv+path*.33).g,texture2D(uMask,uv+path*.67).g);
    through=min(through,texture2D(uMask,src).g);
    return mix(fallback,texture2D(uScene,src).rgb,inside*smoothstep(.12,.58,through));
}

vec3 riverPool(vec2 px, vec2 uv, vec3 base, float gust) {
    float s=clamp((px.y-672.0)/244.0,0.0,1.0);
    vec2 target=vec2((px.x-1100.0)/(58.0+50.0*s),7.2*s/(.55+.45*s));
    float t=flowTime();
    vec2 bedSlope;
    vec4 bed=impactBoundary(target,bedSlope);
    vec3 fade=shoreFade(bed,vec2(0.));
    vec3 current=poolCurrent(target);
    // The solver reflects waves normally at solid banks. Bubbles and the
    // background current slide along those same banks without crossing them.
    current.xy -= (1.-fade.x)*dot(current.xy,bed.zw)*bed.zw;
    // The baked inflow remains attached to its riverbanks. The measured
    // small waves ride through it on an independent playhead and current.
    vec2 eddy = vec2(noise(target*.29+vec2(-.081*t,9.1)),
                     noise(target.yx*.38+vec2(13.7,-.093*t)))-.5;
    // Each solved state has one time throughout the connected basin. A
    // spatially varying playhead would displace a front from its reflection.
    float frame=mod(t*8.,64.);
    float recordedTime=1.91*t;
    vec2 drift=-vec2(.073,.19)*t;
    vec3 impact=impactWaves(target,t);
    // Trace the upper face of the simulated water column. Its signed vertical
    // residual divided by the slope norm is the local tangent distance. The
    // directional derivative intersects the grazing ray with that tangent.
    vec3 ray=normalize(vec3(.035,-.79,-mix(.43,.70,s)));
    vec3 point=vec3(target,0.0);
    bool metBank=false;
    float detail = clamp(uPoolDetail,0.0,1.0);
    PoolPacket packet;
    if (detail > 0.0) packet = poolPacket(target,s,gust,detail);
    for (int i=0;i<5;++i) {
        if (i>=3 && detail==0.0) break;
        fade=shoreFade(bed,point.xy-target);
        vec4 sim=poolState(point.xy,frame,drift,recordedTime,fade);
        vec3 ripple=capillary(point.xy,gust);
        if (detail > 0.0) ripple += packetSurface(packet,point.xy-target);
        ripple=nearBankRipple(ripple,fade)+impact;
        ripple.x+=dot(impact.yz,point.xy-target);
        float rayDepth;
        vec3 surface=wetColumnSurface(sim.rgb+ripple,point.xy,target,bed.x,bedSlope,rayDepth);
        vec3 n=normalize(vec3(-surface.yz,1.0));
        float distanceToSurface=(point.z-surface.x)*n.z;
        float correction=clamp(distanceToSurface/max(.21,-dot(n,ray)),-.13,.13);
        vec3 stepAlong=ray*(i<3 ? correction : detail*correction);
        float bankStep=dot(stepAlong.xy,bed.zw);
        float clearance=max(0.,bed.y+dot(point.xy-target,bed.zw));
        if (bankStep < -clearance) {
            stepAlong*=clearance/(-bankStep);
            metBank=true;
        }
        point+=stepAlong;
    }
    fade=shoreFade(bed,point.xy-target);
    vec4 sim=poolState(point.xy,frame,drift,recordedTime,fade);
    // The march uses a local tangent. Evaluate the actual intersected wave
    // again for the visible normal, including curved and reflected fronts.
    impact=impactWaves(point.xy,t);
    vec3 ripple=capillary(point.xy,gust);
    vec3 fine=vec3(0.0);
    if (detail > 0.0) fine=packetSurface(packet,point.xy-target);
    ripple=nearBankRipple(ripple+fine,fade)+impact;
    float localDepth;
    vec3 surface=wetColumnSurface(sim.rgb+ripple,point.xy,target,bed.x,bedSlope,localDepth);
    vec2 gradient=surface.yz;
    vec3 N=normalize(vec3(-gradient,1.0));
    vec3 view=-ray;
    vec3 reflected=reflect(ray,N);
    float face=clamp(dot(view,N),0.0,1.0);
    // Refract the ray at an air/freshwater interface. The finite depth of the
    // optically active surface layer bounds displacement on the scene plate.
    // Foam scatters near the surface. Applying the full clear-water optical
    // path to a breaking crest makes its bright edges fracture into a grid.
    vec3 longSurface=sim.rgb+impact;
    float head=min(longSurface.x,surface.x)/max(.12,localDepth);
    float steep=min(length(longSurface.yz),length(gradient));
    // Fresh foam needs an elevated, steep or depth-limited crest. Adding
    // signed displacements before this test keeps cancelling waves smooth.
    float breaks=smoothstep(.025,.17,head)*max(smoothstep(.27,.49,steep),smoothstep(.32,.46,head));
    float air = clamp(.52*breaks+.68*smoothstep(.13,.52,sim.a),0.0,1.0);
    vec3 opticalNormal=normalize(vec3(-gradient*(.96-.24*air),1.0));
    vec3 transmitted=refract(ray,opticalNormal,1.0/1.333);
    vec3 flatT=refract(ray,vec3(0,0,1),1.0/1.333);
    float depth=min((.18+.11*s)*(1.0-.68*air),max(0.,localDepth+surface.x));
    vec2 bent=(transmitted.xy/max(.30,-transmitted.z)-flatT.xy/-flatT.z)*depth;
    // Transport the photograph's foam with the current. Two staggered
    // backtraces hand off only at zero weight, so a parcel can travel tens
    // of plate pixels without stretching forever or jumping at its reset.
    // A bounded wander varies the renewal interval across the channel. Its
    // maximum time derivative (.28 * 1.5 / 3.2) is below 1 / 5.7, so every
    // backtrace advances downstream even while the local cadence changes.
    float region=.18*target.x+.09*target.y+7.4;
    float travel=t/5.7+.065*target.x-.078*target.y
                +.28*(noise(vec2(t/3.2,region))-.5);
    vec2 cycles=travel+vec2(0.,.5);
    vec2 age=fract(cycles)-.5;
    float blend=smoothstep(0.,1.,1.-abs(2.*age.x));
    // At the open outlet, trace both parcels upstream into visible water.
    // A trace past the image edge would stretch its last row into a streak.
    vec2 outletDrift=vec2(.09,.52)*(3.58*clamp(target.y/7.2,0.,1.));
    vec2 material=point.xy+bent+.20*eddy-outletDrift;
    // Successive parcels pick up foam at different points across and upstream
    // of the streamline. An anchor changes only when its weight reaches zero.
    vec2 event=2.*floor(cycles)+vec2(1.,0.);
    vec3 across=trainHash(vec3(event,0.)+12.31)-.5;
    vec3 upstream=trainHash(vec3(event,0.)+37.91);
    vec2 a=poolToPixel(material-current.xy*(age.x*5.7)
                      +vec2(.63*across.x,-.51*upstream.x))-px;
    vec2 b=poolToPixel(material-current.xy*(age.y*5.7)
                      +vec2(.63*across.y,-.51*upstream.y))-px;
    vec3 first=poolParcelColor(uv,a,base);
    vec3 second=poolParcelColor(uv,b,base);
    vec3 local=mix(second,first,blend);
    float coolCrest=smoothstep(.29,.63,dot(local,luminance))*smoothstep(-.045,.115,local.b-local.r);
    float fresnel=.0204+.9796*pow(1.0-face,5.0);
    vec2 skyUv=vec2(uv.x+.18*reflected.x,.615+.38*clamp(reflected.z,0.,1.));
    vec3 sky=environment(skyUv);
    vec3 water=mix(local,sky,fresnel*.79);
    vec3 halfVector=normalize(view+normalize(vec3(.68,-.65,.37)));
    float glint=pow(max(dot(N,halfVector),0.0),42.0);
    water+=vec3(.98,.77,.61)*glint*(.045+.075*gust);
    water*=1.0+.22*clamp(dot(gradient,vec2(-.55,-.85)),-.70,.70);
    vec2 carried = carriedFoam(point.xy,s,current.xy,eddy.y);
    float foam=smoothstep(.14,.72,sim.a*(.69+.68*carried.x));
    // Short breaking crests produce fresh foam. The remaining, longer-lived
    // filaments travel downstream through water already aerated by the falls.
    float crest=smoothstep(.12,.69,84.0*fine.x-dot(fine.yz,vec2(.71,.34)));
    float whitecap=crest*breaks;
    // Only a steep, elevated wave face overturns. Its bright lip exists
    // during that crest's passage and the residual bubbles travel downstream.
    foam += (1.-foam)*breaks*(.10+.19*current.z+.19*carried.x);
    float bubbles = smoothstep(.075,.37,sim.a+.105*coolCrest)*(.38+.32*s+.38*coolCrest);
    foam += (1.0-foam) * ((.29+.13*detail)*carried.y*bubbles + .19*detail*whitecap);
    vec3 froth=mix(vec3(.55,.67,.72),vec3(.80,.85,.86),.36+.43*carried.x+.12*carried.y);
    water=mix(water,froth,.56*foam);
    // At an exposed wall a very deep trough can be hidden behind the bank.
    // A reflected crest with a valid wet intersection remains fully visible.
    if (metBank) {
        float clearance=max(0.,bed.y+dot(point.xy-target,bed.zw));
        float residual=(point.z-surface.x)*N.z;
        float towardWall=-dot(ray.xy,bed.zw)*residual/max(.21,-dot(N,ray));
        float blocked=smoothstep(.002,.02,towardWall-clearance);
        vec2 bankUv=uv+uvOffset(poolToPixel(point.xy)-px);
        water=mix(water,texture2D(uScene,bankUv).rgb,blocked);
    }
    return water;
}

float impactLine(float x) {
    return 689.0-.00078*pow(max(x-1200.0,0.0),2.0)+3.8*sin(.016*x);
}

float flyingDrops(vec2 px, float gust) {
    float pitch=11.5;
    float column=floor(px.x/pitch);
    float light=0.0;
    for (int j=-1;j<=1;++j) {
        float id=column+float(j);
        float seed=hash(vec2(id,5.0));
        float emission=flowTime()*.91+seed;
        float pulse=floor(emission);
        float age=fract(emission)/.91;
        float roll=hash(vec2(id,pulse));
        float x0=(id+.15+.70*roll)*pitch;
        float up=97.0+86.0*hash(vec2(id+8.0,pulse));
        float gravityPx=476.0;
        float vx=(seed-.45)*17.0+gust*9.0;
        vec2 center=vec2(x0+vx*age,impactLine(x0)-up*age+.5*gravityPx*age*age);
        vec2 velocity=vec2(vx,gravityPx*age-up);
        vec2 offset=px-center;
        // Capsule SDF integrated over a short shutter, anti-aliased in plate pixels.
        vec2 exposure=velocity/85.0;
        float along=clamp(dot(offset,exposure)/max(.001,dot(exposure,exposure)),-.5,.5);
        float radius=mix(.48,1.08,roll);
        float d=length(offset-exposure*along)-radius;
        float aa=max(.5,.55*uCrop.w*plateSize.y/uResolution.y);
        light+= (.14+.21*roll)*(1.0-smoothstep(-aa,aa,d))
              * smoothstep(0.0,.07,age)*(1.0-smoothstep(1.6*up/gravityPx,2.0*up/gravityPx,age));
    }
    return min(light,.44);
}

vec3 spray(vec2 px, vec2 uv, vec3 underlying, float gust) {
    float height=max(0.0,impactLine(px.x)-px.y);
    // Lift an entrained parcel through the spray cloud before drag and wind
    // disperse it. Fine droplets travel ballistically near the foot of the falls.
    float age=height/(31.0+.13*height);
    vec2 air=vec2(px.x*.011-(.17+.15*gust)*age,age*.64-flowTime()*.81);
    float coarse=noise(air);
    float fine=noise(2.93*air+vec2(coarse,-coarse*.62));
    float density=smoothstep(.24,.83,.66*coarse+.34*fine);
    vec3 scattered=environment(vec2(uv.x,.86));
    vec3 mistLight=mix(vec3(.74,.84,.91),scattered,.18);
    float droplets=flyingDrops(px,gust);
    float surge = impactLoad(px.x,flowTime()-age);
    float opacity=.04+.18*density+.08*droplets+.095*surge*(.45+.55*density);
    return mix(underlying,mistLight,opacity)+droplets*vec3(.27,.33,.37);
}

void main() {
    vec2 uv=uCrop.xy+vUv*uCrop.zw;
    vec3 mask=texture2D(uMask,uv).rgb;
    float coverage=max(mask.r,max(mask.g,mask.b));
    if (coverage<.004) { gl_FragColor=vec4(0.0); return; }
    vec2 px=vec2(uv.x,1.0-uv.y)*plateSize;
    vec3 base=texture2D(uScene,uv).rgb;
    float gust=valleyWind(uv,uWindTime).x;
    vec3 water=base;
    if (mask.r>.01) water=fallingWater(px,uv,base,gust);
    if (mask.g>.01) {
        vec3 pool=riverPool(px,uv,base,gust);
        water=mix(water,pool,mask.g/max(.001,mask.r+mask.g));
    }
    float wet=max(mask.r,mask.g);
    water=mix(base,water,clamp(wet/coverage,0.,1.));
    if (mask.b>.012) {
        vec3 mist=spray(px,uv,water,gust);
        water=mix(water,mist,mask.b/coverage);
    }
    gl_FragColor=vec4(water,smoothstep(.003,.94,coverage));
}
