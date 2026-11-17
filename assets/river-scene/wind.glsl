// The same travelling pressure fronts pass over the cloud deck, forest and
// river. X is local gust strength. Y is the continuous downwind position
// of an airborne parcel, in cloud-volume periods (one period per 48 s).
vec2 valleyWind(vec2 uv, float t) {
    const float turn = 6.28318530718;
    float front = turn * (uv.x * 1.45 + uv.y * .24 - t / 12.0);
    float eddy = turn * (3.0 * uv.x - t / 8.0) + .7;
    float harmonic = 2.0 * front - .85;
    float gust = .50 + .32 * sin(front) + .12 * sin(harmonic) + .06 * sin(eddy);
    // Integrate the gust about its mean. The high cloud deck responds more
    // gently than branches and spray, and continues downwind between gusts.
    float excursion = (.32 * 12.0 * cos(front) + .12 * 6.0 * cos(harmonic)
                       + .06 * 8.0 * cos(eddy)) / turn;
    return vec2(gust, (t + .70 * excursion) / 48.0);
}
