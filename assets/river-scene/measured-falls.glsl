uniform sampler2D uMeasuredFalls;

// Each 128 x 96 frame has a one-texel periodic border. UVs are material
// coordinates across the falling sheet and down its streamlines.
vec3 measuredFallsFrame(vec2 uv, float index) {
    float frame = mod(index, 64.0);
    vec2 tile = vec2(mod(frame, 8.0), floor(frame/8.0));
    vec2 texel = tile*vec2(130.0,98.0) + fract(uv)*vec2(128.0,96.0) + 1.0;
    vec2 st = texel/vec2(1040.0,784.0);
    vec3 encoded = texture2D(uMeasuredFalls,vec2(st.x,1.0-st.y)).rgb;
    return (255.0*encoded-128.0)/127.0;
}

// Signed optical relief, fine ribbon coverage and cross-sheet relief slope.
// The recorded bulk travel is removed during fitting. Interpolation gives
// the remaining changes in material appearance a continuous time derivative.
vec3 measuredFallsMaterial(vec2 uv, float sceneSeconds) {
    float time = fract(sceneSeconds/8.0)*64.0;
    float i = floor(time);
    float t = time-i;
    vec3 a = measuredFallsFrame(uv,i-1.0);
    vec3 b = measuredFallsFrame(uv,i);
    vec3 c = measuredFallsFrame(uv,i+1.0);
    vec3 d = measuredFallsFrame(uv,i+2.0);
    return clamp(b+.5*t*(c-a+t*(2.0*a-5.0*b+4.0*c-d+t*(-a+3.0*b-3.0*c+d))),-1.,1.);
}
