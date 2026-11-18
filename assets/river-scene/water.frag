precision highp float;

varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform sampler2D uDynamics;
uniform sampler2D uWeather;
uniform vec4 uCrop;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPoolDetail;

const vec2 plateSize = vec2(1717.0, 916.0);
const float gravity = 9.81;
const float tau = 6.2831853;
const vec3 luminance = vec3(0.2126, 0.7152, 0.0722);

// Half-speed water gives the pool one complete cycle per 16-second film.
// Atmospheric gusts and the reflected sky keep the scene's wall clock.
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

// Sample the high frequency structure of a real patch of broken water in the
// source artwork in parcel coordinates. Mirrored edges are continuous. Two
// scales sample separate patches with different orientations and travel speeds.
float whitewaterDetail(vec2 parcel, float disorder) {
    vec2 a = abs(fract(parcel * vec2(.36, 1.38) + vec2(disorder*.13, parcel.x*.037))*2.0-1.0);
    vec2 b = abs(fract(parcel * vec2(.87, 2.71) + vec2(disorder*.24, -.13*parcel.x))*2.0-1.0);
    vec2 uv1 = vec2(0.0, 1.0) + uvOffset(vec2(1270.0,410.0) + a * vec2(80.0,92.0));
    vec2 uv2 = vec2(0.0, 1.0) + uvOffset(vec2(1426.0,409.0) + b * vec2(47.0,75.0));
    return dot(texture2D(uScene,uv1).rgb,luminance) - .66
         + .47*(dot(texture2D(uScene,uv2).rgb,luminance) - .65);
}

// Top edges of the main shelf and its three lower lateral ledges, in plate pixels.
float ledge(float x, float tier) {
    if (tier > 2.5) return 570.0 + .16*(x-743.0) + .00055*(x-765.0)*(x-765.0);
    if (tier > 1.5) return 487.0 - .14*(x-785.0);
    if (tier > .5) return 409.0 - .07*(x-868.0);
    float right = max(x-1155.0,0.0);
    return 370.0 - .068*(x-1150.0) - .00017*right*right
           + 3.9*sin((x-1060.0)*.023);
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
    vec2 parcel = vec2(lane, flight - flowTime());
    float braid = noise(parcel*vec2(1.15,1.82));
    float breakup = smoothstep(.36,1.05,flight);
    parcel.x += (.075+.10*breakup)*(braid-.5) + .035*sin(lane*1.12 + parcel.y*4.2);
    parcel.x -= breakup*gust*.085;
    float folds = noise(vec2(parcel.x*6.5, parcel.y*3.8 + 1.25*braid));
    float aeration = smoothstep(.02,.95,flight+.25*braid);
    // q=v*h conserves the flux of a ribbon as gravity thins it.
    float flux = .038+.064*noise(vec2(lane*2.9,.7));
    float halfThickness = .5*flux/speed;
    vec2 sheet = vec2(parcel.x, parcel.y*1.6);
    vec3 kx = vec3(6.8,15.4,-23.8);
    vec3 ky = vec3(2.8,-4.0,6.3);
    vec3 amplitude = vec3(.027,.009,.0038) * (.79+.42*braid);
    vec3 bend = vec3(.87,-1.3,.64)*sin(lane*1.53+parcel.y*2.05) + folds*.66;
    vec3 ray = normalize(vec3(.21,.24,-1.0));
    vec3 point = vec3(sheet-ray.xy*(.15/-ray.z),.15);
    // Conservative signed distance to the two faces of the folded, thinning
    // liquid ribbon. Its upper zero crossing sets parallax and the optical path.
    for (int i=0; i<5; ++i) {
        vec3 phase = kx*point.x+ky*point.y+bend;
        float height = dot(amplitude,sin(phase));
        float distanceToSheet = (abs(point.z-height)-halfThickness)*.73;
        point += ray*distanceToSheet;
    }
    vec3 derivative = amplitude*cos(kx*point.x+ky*point.y+bend);
    vec2 slope = vec2(dot(derivative,kx), dot(derivative,ky)*1.6/speed);
    vec3 N = normalize(vec3(-slope,1.0));
    vec2 parallax = (point.xy-sheet)/metresPerPixel;
    // Air shear shreds the sheet into shorter clusters nearer the plunge pool.
    // Their material coordinates continue to fall with the parent jet.
    float clusters = noise(vec2(parcel.x*4.6+.72*braid,parcel.y*10.2+.63*folds));
    float grains = whitewaterDetail(parcel,folds+.31*breakup*clusters);
    grains = mix(grains, .58*grains+.11*(clusters-.5), breakup);
    float chop = smoothstep(.42,.80,folds+.47*grains);
    vec2 offset = parallax+N.xy*vec2(6.2,3.2)+vec2((braid-.5)*3.2, (folds-.5)*3.0);
    vec3 refracted = wetSample(uv,offset,vec2(1,0),base);
    // Remove stationary fine foam from the key art. Retain its broad lighting
    // and channels; the detailed whitewater travelling through them is formed above.
    vec2 axis = normalize(vec2(lateral,entry+gravity*flight));
    vec2 across = vec2(axis.y,-axis.x);
    vec3 local = .29*refracted
        + .25*wetSample(uv,offset+axis*10.7+across*3.6,vec2(1,0),base)
        + .23*wetSample(uv,offset-axis*10.1+across*2.8,vec2(1,0),base)
        + .23*wetSample(uv,offset-axis*1.7-across*7.3,vec2(1,0),base);
    float ln = dot(local,luminance);
    float light = dot(N,normalize(vec3(.68,-.28,.70)));
    float bubbles = clamp(.14+.27*aeration+.27*(folds-.5)+.82*grains,0.0,1.0);
    // Beer-Lambert extinction in a bubble-laden sheet. Dense breaking ribbons
    // scatter the sky; thinner filaments transmit the shadow of the basalt.
    float path = (2.0*halfThickness+.025)/max(.28,dot(N,-ray));
    float scatter = 1.0-exp(-path*(8.0+25.0*bubbles));
    vec3 diffuse = local*(.88+.19*light);
    vec3 clouded = vec3(.66,.81,.91)*(.44+.69*ln+.14*chop);
    diffuse = mix(diffuse,clouded,scatter*(.24+.22*aeration));
    float contrast = .66*grains+.07*(folds-.50)+.04*(braid-.5);
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

vec4 poolState(vec2 world, float frame) {
    vec2 local = clamp((poolToPixel(world)-vec2(480.0,672.0))/vec2(1237.0,244.0),0.0,1.0);
    float a = floor(frame);
    vec4 state = mix(dynamicsTile(local,a),dynamicsTile(local,mod(a+1.0,64.0)),fract(frame));
    vec3 surface = (state.rgb-.5) * vec3(.5,1.2,1.2);
    vec3 measured = measuredPoolWave(world, uTime);
    return vec4(.70 * surface + .75 * measured, clamp((state.a-.5)*2.0,0.0,1.0));
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
    float run = sin(p.x*.83+p.y*.95-t*.88);
    vec3 phase=kx*(p.x-current.x*t)+ky*(p.y-current.y*t)-omega*t
              +vec3(1.6,-1.13,1.22)*run;
    vec3 a = vec3(.0021,.0010,.0006)*(.74+.53*gust);
    vec3 ca = a*cos(phase);
    return vec3(dot(a,sin(phase)),dot(ca,kx),dot(ca,ky));
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
vec2 carriedFoam(vec2 p, float s) {
    vec2 crossBar = (p.x - vec2(-1.6, 3.0)) / vec2(1.2, 1.7);
    vec2 alongBar = (p.y - vec2(4.15, 5.45) - .55) / vec2(1.15, 1.4);
    vec2 wake = exp(-crossBar*crossBar - alongBar*alongBar);
    float across = p.x - .24*p.y - .44*dot(crossBar, wake);
    float along = p.y + .24*(wake.x + wake.y) - .55*flowTime();
    vec2 parcel = vec2(across, along);
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

vec3 riverPool(vec2 px, vec2 uv, vec3 base, float gust) {
    float s=clamp((px.y-672.0)/244.0,0.0,1.0);
    vec2 target=vec2((px.x-1100.0)/(58.0+50.0*s),7.2*s/(.55+.45*s));
    float frame=mod(flowTime()*8.0,64.0);
    // Trace the upper face of the simulated water column. Its signed vertical
    // residual divided by the slope norm is the local tangent distance. The
    // directional derivative intersects the grazing ray with that tangent.
    vec3 ray=normalize(vec3(.035,-.79,-mix(.43,.70,s)));
    vec3 point=vec3(target,0.0);
    float detail = clamp(uPoolDetail,0.0,1.0);
    PoolPacket packet;
    if (detail > 0.0) packet = poolPacket(target,s,gust,detail);
    for (int i=0;i<5;++i) {
        if (i>=3 && detail==0.0) break;
        vec4 sim=poolState(point.xy,frame);
        vec3 ripple=capillary(point.xy,gust);
        if (detail > 0.0) ripple += packetSurface(packet,point.xy-target);
        vec3 n=normalize(vec3(-sim.gb-ripple.yz,1.0));
        float distanceToSurface=(point.z-sim.r-ripple.x)*n.z;
        float correction=clamp(distanceToSurface/max(.21,-dot(n,ray)),-.13,.13);
        point+=ray*(i<3 ? correction : detail*correction);
    }
    vec4 sim=poolState(point.xy,frame);
    vec3 ripple=capillary(point.xy,gust);
    vec3 fine=vec3(0.0);
    if (detail > 0.0) fine=packetSurface(packet,point.xy-target);
    ripple+=fine;
    vec2 gradient=sim.gb+ripple.yz;
    vec3 N=normalize(vec3(-gradient,1.0));
    vec3 view=-ray;
    vec3 reflected=reflect(ray,N);
    float face=clamp(dot(view,N),0.0,1.0);
    // Refract the ray at an air/freshwater interface. The finite depth of the
    // optically active surface layer bounds displacement on the scene plate.
    // Foam scatters near the surface. Applying the full clear-water optical
    // path to a breaking crest makes its bright edges fracture into a grid.
    float coolCrest = smoothstep(.29,.63,dot(base,luminance))
                    * smoothstep(-.045,.115,base.b-base.r);
    float air = clamp(.52*coolCrest+.68*smoothstep(.13,.52,sim.a),0.0,1.0);
    vec3 opticalNormal=normalize(vec3(-sim.gb-ripple.yz*(.84-.20*air),1.0));
    vec3 transmitted=refract(ray,opticalNormal,1.0/1.333);
    vec3 flatT=refract(ray,vec3(0,0,1),1.0/1.333);
    float depth=(.18+.11*s)*(1.0-.68*air);
    vec2 bent=(transmitted.xy/max(.30,-transmitted.z)-flatT.xy/-flatT.z)*depth;
    vec2 offset=poolToPixel(point.xy+bent)-px;
    vec3 refracted=wetSample(uv,offset,vec2(0,1),base);
    vec3 local=.59*refracted
        +.225*wetSample(uv,offset+vec2(5.3,2.3),vec2(0,1),base)
        +.185*wetSample(uv,offset-vec2(4.7,2.6),vec2(0,1),base);
    local=mix(local,refracted,detail*(.10+.15*s)*(1.0-.5*air));
    float fresnel=.0204+.9796*pow(1.0-face,5.0);
    vec2 skyUv=vec2(uv.x+.18*reflected.x,.615+.38*clamp(reflected.z,0.,1.));
    vec3 sky=environment(skyUv);
    vec3 water=mix(local,sky,fresnel*.79);
    vec3 halfVector=normalize(view+normalize(vec3(.68,-.65,.37)));
    float glint=pow(max(dot(N,halfVector),0.0),42.0);
    water+=vec3(.98,.77,.61)*glint*(.045+.075*gust);
    water*=1.0+.16*clamp(dot(gradient,vec2(-.55,-.85)),-.65,.65);
    vec2 carried = carriedFoam(point.xy,s);
    float foam=smoothstep(.14,.72,sim.a*(.69+.68*carried.x));
    // Short breaking crests produce fresh foam. The remaining, longer-lived
    // filaments travel downstream through water already aerated by the falls.
    float crest=smoothstep(.12,.69,84.0*fine.x-dot(fine.yz,vec2(.71,.34)));
    float whitecap=crest*smoothstep(.08,.42,sim.a);
    float bubbles = smoothstep(.075,.37,sim.a+.105*coolCrest)*(.38+.32*s+.38*coolCrest);
    foam += (1.0-foam) * ((.29+.13*detail)*carried.y*bubbles + .19*detail*whitecap);
    vec3 froth=mix(vec3(.55,.67,.72),vec3(.80,.85,.86),.36+.43*carried.x+.12*carried.y);
    water=mix(water,froth,.56*foam);
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
    float opacity=.04+.18*density+.08*droplets;
    return mix(underlying,mistLight,opacity)+droplets*vec3(.27,.33,.37);
}

void main() {
    vec2 uv=uCrop.xy+vUv*uCrop.zw;
    vec3 mask=texture2D(uMask,uv).rgb;
    float coverage=max(mask.r,max(mask.g,mask.b));
    if (coverage<.004) { gl_FragColor=vec4(0.0); return; }
    vec2 px=vec2(uv.x,1.0-uv.y)*plateSize;
    vec3 base=texture2D(uScene,uv).rgb;
    float gust=valleyWind(uv,uTime).x;
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
