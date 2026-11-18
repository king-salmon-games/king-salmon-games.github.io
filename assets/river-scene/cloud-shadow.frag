precision highp float;

varying vec2 vUv;
uniform sampler2D uCloudShadow;
uniform sampler2D uWeatherMask;
uniform vec4 uCrop;
uniform float uTime;

#include "wind.glsl"

void main() {
    vec2 uv = uCrop.xy + vUv * uCrop.zw;
    vec3 matte = texture2D(uWeatherMask, uv).rgb;
    // Skylight already passes through the upper clouds and the low valley bank.
    float receiver = (1.0 - matte.r) * (1.0 - 0.88 * matte.b);
    float depth = 1.0 / max(0.23, 1.06 - uv.y);
    vec2 ground = vec2((uv.x - 0.63) * depth * 0.49, depth * 0.18);
    float drift = valleyWind(uv, mod(uTime, 48.0)).y;
    float direct = texture2D(uCloudShadow, ground - vec2(drift, 0.0)).r;
    // Indirect skylight fills the penumbra, especially on distant ridges.
    float shade = (1.0 - direct) * receiver * mix(1.0, 0.35, smoothstep(0.60, 0.95, uv.y));
    gl_FragColor = vec4(1.0 - shade * vec3(0.23, 0.18, 0.12), 1.0);
}
