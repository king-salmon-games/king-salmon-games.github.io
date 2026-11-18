#!/usr/bin/env python3
"""Bake direct lunar transmission from the same weather shader as the river films.

With the optional Playwright and Pillow dependencies used by render_river.py:
    python tools/bake_moon_clouds.py --browser-channel chrome

Every third sample shares one RGB texel. Lossless WebP preserves the independent
channels. Only the area containing sky is stored. Coordinates and packing match
river-moon-clouds.js.
"""

import argparse
import base64
import functools
from http.server import ThreadingHTTPServer
from io import BytesIO
from math import sqrt
from pathlib import Path
from threading import Thread

from PIL import Image
from playwright.sync_api import sync_playwright
from render_river import ROOT, SceneFiles

BAKE = r"""async () => {
    const width = 384, height = 72, columns = 8, rows = 5, seconds = 48;
    const surface = document.createElement('canvas');
    surface.width = width * columns;
    surface.height = height * rows;
    const gl = surface.getContext('webgl', {alpha: false, antialias: false, depth: false});
    if (!gl) throw Error('WebGL is required for the moon cloud baker');
    const base = '/assets/river-scene/';
    const [weather, wind] = await Promise.all(['weather.frag', 'wind.glsl'].map(
        async file => (await fetch(base + file)).text()));
    const fragment = '#define LUNAR_TRANSMISSION 1\n' +
        weather.replace('#include "wind.glsl"', wind);
    const vertex = 'attribute vec2 a; varying vec2 vUv; void main() {' +
        'vUv=a*.5+.5; gl_Position=vec4(a,0.,1.);}';
    const program = gl.createProgram();
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(kind);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, 'a');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const [unit, [name, file, wrap]] of [
        ['uWeatherMask','weather-mask.png',gl.CLAMP_TO_EDGE],
        ['uCloudNoise','cloud-noise.png',gl.REPEAT]
    ].entries()) {
        const img = new Image();
        img.src = base + file;
        await img.decode();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }
    gl.disable(gl.DITHER);
    gl.uniform4f(gl.getUniformLocation(program, 'uCrop'), .30, .76, .70, .24);
    const time = gl.getUniformLocation(program, 'uTime');
    const frames = columns * rows * 3;
    for (let frame = 0; frame < frames; frame++) {
        const tile = Math.floor(frame / 3);
        const channel = frame % 3;
        gl.viewport((tile % columns) * width, (rows - 1 - Math.floor(tile / columns)) * height,
                    width, height);
        gl.colorMask(channel === 0, channel === 1, channel === 2, false);
        gl.uniform1f(time, frame * seconds / frames);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw Error('Transmission bake failed');
    return surface.toDataURL('image/png').split(',')[1];
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-channel', help='Use an installed browser (chrome or msedge).')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/river-scene/moon-clouds.webp')
    args = parser.parse_args()
    handler = functools.partial(SceneFiles, directory=ROOT)
    with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=args.browser_channel,
                                                      args=['--enable-unsafe-swiftshader'])
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/__encode')
                png = base64.b64decode(page.evaluate(BAKE))
                browser.close()
        finally:
            server.shutdown()
            thread.join()
    with Image.open(BytesIO(png)) as atlas:
        # Thirty-two perceptually spaced transmission levels keep faint rays
        # distinct in dense cloud. Lossless encoding keeps opaque terrain black.
        levels = [round(255 * (round(sqrt(i / 255) * 31) / 31) ** 2) for i in range(256)]
        atlas.convert('RGB').point(levels * 3).save(args.output, lossless=True, method=6)


if __name__ == '__main__':
    main()
