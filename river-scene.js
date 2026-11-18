const root = new URL('assets/river-scene/', import.meta.url);

const vertex = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }`;

const blit = `
  precision highp float;
  varying vec2 vUv;
  uniform vec4 uCrop;
  uniform sampler2D uImage;
  void main() {
    gl_FragColor = texture2D(uImage, uCrop.xy + vUv * uCrop.zw);
  }`;

const fullLandscape = new Float32Array([0, 0, 1, 1]);
export const landscape = { width: 1717, height: 916, portraitLeft: 820, portraitWidth: 733 };
export const sceneStartTime = 4;
let assetPromise;

async function fetchAsset(file) {
  const response = await fetch(new URL(file, root));
  if (!response.ok) throw new Error('Could not load ' + file);
  return response;
}

async function textureImage(file, packed = false) {
  // The atlas stores slopes in RGB and foam in alpha. Decode without losing
  // precision through premultiplication. ImageBitmap applies its own Y flip.
  if (packed && typeof createImageBitmap === 'function') {
    const blob = await (await fetchAsset(file)).blob();
    try {
      return await createImageBitmap(blob, {
        imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none'
      });
    } catch {
      // Fall through to the browser image decoder if these options are unavailable.
    }
  }
  const image = new Image();
  image.src = new URL(file, root).href;
  await image.decode();
  return image;
}

function loadAssets() {
  assetPromise ??= Promise.all([
    fetchAsset('weather.frag?v=2').then(r => r.text()),
    fetchAsset('water.frag?v=6').then(r => r.text()),
    fetchAsset('wind.glsl?v=1').then(r => r.text()),
    fetchAsset('measured-pool.glsl?v=1').then(r => r.text()),
    fetchAsset('measured-falls.glsl?v=1').then(r => r.text()),
    fetchAsset('cloud-shadow.frag?v=1').then(r => r.text()),
    textureImage('river-desktop.webp'), textureImage('water-mask.png?v=1'),
    textureImage('water-dynamics.webp?v=1', true),
    textureImage('weather-mask.png?v=2'), textureImage('cloud-noise.png?v=2'),
    textureImage('measured-pool.webp?v=1', true), textureImage('measured-falls.webp?v=1', true),
    textureImage('cloud-shadow.png?v=1')
  ]);
  return assetPromise;
}

function makeProgram(gl, fragment) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  return program;
}

function setFiltering(gl, wrap) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

export function openSceneContext(canvas) {
  return canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false
  });
}

// Both the homepage and the film encoder call this renderer. All passes use
// the same landscape coordinates and simulation clock, including reflections.
export async function createRiverScene(gl, isCurrent = () => !gl.isContextLost()) {
  if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ||
      gl.getParameter(gl.MAX_TEXTURE_SIZE) < landscape.width) {
    throw new Error('Insufficient precision or texture size for the river scene');
  }
  const [weatherSource, waterSource, windSource, measuredPoolSource, measuredFallsSource,
    shadowSource, ...images] = await loadAssets();
  if (!isCurrent()) return null;

  const materialSource = waterSource.replace('#include "measured-pool.glsl"', measuredPoolSource)
    .replace('#include "measured-falls.glsl"', measuredFallsSource);
  const programs = [weatherSource, materialSource, blit, shadowSource].map(source =>
    makeProgram(gl, source.replace('#include "wind.glsl"', windSource)));
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  while (parallel && programs.some(p => !gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR))) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (!isCurrent()) return null;
  }

  const [weather, water, copy, shadows] = programs.map(program => {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const details = gl.getAttachedShaders(program).map(shader => gl.getShaderInfoLog(shader)).join(' ');
      throw new Error(gl.getProgramInfoLog(program) + ' ' + details);
    }
    gl.useProgram(program);
    for (const [name, unit] of Object.entries({
      uScene: 0, uMask: 1, uDynamics: 2, uWeatherMask: 3, uCloudNoise: 4, uMeasuredPool: 5,
      uMeasuredFalls: 6, uWeather: 7, uCloudShadow: 7
    })) {
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }
    return {
      program, crop: gl.getUniformLocation(program, 'uCrop'),
      size: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'), image: gl.getUniformLocation(program, 'uImage'),
      detail: gl.getUniformLocation(program, 'uPoolDetail')
    };
  });

  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const textures = images.map((image, unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    setFiltering(gl, unit === 4 || unit === 7 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return texture;
  });
  const cloudShadow = textures[7];

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const environment = gl.createTexture();
  const environmentTarget = gl.createFramebuffer();
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, environment);
  setFiltering(gl, gl.CLAMP_TO_EDGE);
  let envWidth = 0;
  let envHeight = 0;
  let weatherTime;

  function drawPass(pass, time, crop, width, height, imageUnit = 0, poolDetail = 0) {
    gl.useProgram(pass.program);
    gl.uniform4fv(pass.crop, crop);
    gl.uniform2f(pass.size, width, height);
    gl.uniform1f(pass.time, time);
    gl.uniform1f(pass.detail, poolDetail);
    gl.uniform1i(pass.image, imageUnit);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(time, crop = fullLandscape, backdrop = false, poolDetail = 0) {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    // The sky/forest map also supplies incident light to the river. Keep the
    // entire landscape in this map, including sky outside the phone's crop.
    const targetWidth = Math.max(1, Math.min(landscape.width, Math.round(width / crop[2])));
    gl.activeTexture(gl.TEXTURE7);
    // Both pool detail levels of a film frame see exactly the same weather.
    if (targetWidth !== envWidth || weatherTime !== time) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, environmentTarget);
      if (targetWidth !== envWidth) {
        envWidth = targetWidth;
        envHeight = Math.max(1, Math.round(envWidth * landscape.height / landscape.width));
        gl.bindTexture(gl.TEXTURE_2D, environment);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, envWidth, envHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, environment, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('The environment buffer is unavailable');
        }
      }
      // Never sample an attachment while writing into it.
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.viewport(0, 0, envWidth, envHeight);
      gl.disable(gl.BLEND);
      drawPass(weather, time, fullLandscape, envWidth, envHeight);
      weatherTime = time;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, environment);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    if (backdrop) drawPass(copy, time, crop, width, height, 0);
    // Shader outputs are straight RGBA. Store a correctly premultiplied
    // composition for the browser or draw on the opaque plate when encoding.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawPass(copy, time, crop, width, height, 7);
    drawPass(water, time, crop, width, height, 0, poolDetail);
    // Weather and water are finished using the environment. Reuse its sampler
    // for the projected light so the scene fits WebGL 1's eight texture units.
    gl.bindTexture(gl.TEXTURE_2D, cloudShadow);
    gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
    drawPass(shadows, time, crop, width, height);
  }
  return { render };
}
