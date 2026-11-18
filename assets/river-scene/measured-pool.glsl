uniform sampler2D uMeasuredPool;

// Height is in metres; the other channels are its world-space x and y slopes.
// Each 64 by 64 frame has a one-texel wrapping guard on every side. The image
// begins at the top-left, and the renderer flips images for WebGL on upload.
vec3 measuredPoolFrame(vec2 withinTile, float frame) {
    float index = mod(frame, 64.0);
    vec2 tile = vec2(mod(index, 8.0), floor(index / 8.0));
    vec2 uv = (tile * 66.0 + withinTile * 64.0 + 1.0) / 528.0;
    vec3 code = texture2D(uMeasuredPool, vec2(uv.x, 1.0 - uv.y)).rgb * 255.0 - 128.0;
    return code * (vec3(.16, 1.20, 1.20) / 127.0);
}

vec3 measuredPoolWave(vec2 worldXY, float sceneSeconds) {
    vec2 patch = fract(worldXY / 4.0);
    float position = fract(sceneSeconds / 16.0) * 64.0;
    float frame = floor(position);
    float t = position - frame;
    // Interpolate through the recorded states with continuous temporal
    // velocity, including when the last state passes into the first.
    vec3 a = measuredPoolFrame(patch, frame - 1.0);
    vec3 b = measuredPoolFrame(patch, frame);
    vec3 c = measuredPoolFrame(patch, frame + 1.0);
    vec3 d = measuredPoolFrame(patch, frame + 2.0);
    return b + .5 * t * (c - a + t * (2.0*a - 5.0*b + 4.0*c - d
                            + t * (-a + 3.0*b - 3.0*c + d)));
}
