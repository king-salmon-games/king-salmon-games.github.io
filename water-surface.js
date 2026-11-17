(() => {
  const canvas = document.querySelector('[data-water-surface]');
  if (!canvas) return;

  const hero = canvas.closest('.river-hero');
  const portrait = window.matchMedia('(max-width: 680px)');
  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false
    });
  } catch {
    // Browser privacy settings can prevent context creation.
    return;
  }
  if (!gl) return;

  const vertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;

  // The portrait poster is cropped from columns [820, 1553) of the same landscape.
  const sceneWidth = 1717;
  const sceneHeight = 916;
  const frameInterval = 1000 / 30;
  let uniforms;
  let assets;
  let generation = 0;
  let frame = 0;
  let nextFrame = 0;
  let onScreen = true;
  let retired = false;
  let quality = 1;
  let sampleStart = 0;
  let samples = 0;
  let slowWindows = 0;
  const start = performance.now();

  function showSurface(ready) {
    if (canvas.hasAttribute('data-ready') === ready) return;
    canvas.toggleAttribute('data-ready', ready);
    canvas.dispatchEvent(new Event('water-renderer-change'));
  }

  function resize() {
    if (retired || !uniforms) return;
    const { width, height } = hero.getBoundingClientRect();
    if (width < 1 || height < 1) return;

    const pixelBudget = portrait.matches ? 480000 : 980000;
    const density = Math.min(window.devicePixelRatio || 1, 1.6, Math.sqrt(pixelBudget / (width * height)));
    const w = Math.max(1, Math.round(width * density * quality));
    const h = Math.max(1, Math.round(height * density * quality));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    // Match the CSS picture's centered object-fit: cover, including its mobile crop.
    const sourceWidth = portrait.matches ? 733 : sceneWidth;
    const sourceLeft = portrait.matches ? 820 : 0;
    const scale = Math.max(width / sourceWidth, height / sceneHeight);
    const visibleWidth = width / scale;
    const visibleHeight = height / scale;
    gl.uniform4f(uniforms.crop,
      (sourceLeft + (sourceWidth - visibleWidth) / 2) / sceneWidth,
      (1 - visibleHeight / sceneHeight) / 2,
      visibleWidth / sceneWidth, visibleHeight / sceneHeight);
    gl.uniform2f(uniforms.resolution, w, h);
  }

  function useFilm() {
    retired = true;
    uniforms = null;
    cancelAnimationFrame(frame);
    frame = 0;
    showSurface(false);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (now + 0.5 < nextFrame) return;
    nextFrame = Math.max(now, nextFrame) + frameInterval;
    gl.uniform1f(uniforms.time, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!canvas.hasAttribute('data-ready')) {
      if (gl.isContextLost()) return;
      if (gl.getError() !== gl.NO_ERROR) { useFilm(); return; }
      showSurface(true);
    }

    // Measure sustained delivery, excluding start-up and time spent offscreen.
    if (!sampleStart) sampleStart = now;
    samples++;
    const elapsed = now - sampleStart;
    if (elapsed < 2400) return;
    const fps = samples * 1000 / elapsed;
    samples = 0;
    sampleStart = now;
    slowWindows = fps < 21 ? slowWindows + 1 : 0;
    if (slowWindows < 2) return;
    slowWindows = 0;
    if (quality > 0.56) {
      quality = Math.max(0.55, quality * 0.74);
      resize();
    } else {
      useFilm();
    }
  }

  function syncFrames() {
    cancelAnimationFrame(frame);
    frame = 0;
    nextFrame = 0;
    sampleStart = 0;
    samples = 0;
    slowWindows = 0;
    if (!retired && uniforms && onScreen && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load ' + url));
      image.src = url;
    });
  }

  function uploadTexture(unit, image, sampler) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(sampler, unit);
  }

  async function initialize() {
    const attempt = ++generation;
    if (retired) return;
    try {
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!precision?.precision || gl.getParameter(gl.MAX_TEXTURE_SIZE) < sceneWidth) {
        useFilm();
        return;
      }
      assets ??= Promise.all([
        fetch('assets/river-scene/water.frag?v=1').then(response => {
          if (!response.ok) throw new Error('Could not load the waterfall shader');
          return response.text();
        }),
        loadImage('assets/river-scene/river-desktop.webp'),
        loadImage('assets/river-scene/water-mask.png?v=1')
      ]);
      const [fragmentSource, scene, mask] = await assets;
      if (attempt !== generation || gl.isContextLost()) return;

      const program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      const parallel = gl.getExtension('KHR_parallel_shader_compile');
      while (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (attempt !== generation || gl.isContextLost()) return;
      }
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const details = gl.getAttachedShaders(program).map(shader => gl.getShaderInfoLog(shader)).join(' ');
        throw new Error(gl.getProgramInfoLog(program) + ' ' + details);
      }
      gl.useProgram(program);

      // A single oversized triangle covers the viewport without an interior seam.
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      const location = name => gl.getUniformLocation(program, name);
      uploadTexture(0, scene, location('uScene'));
      uploadTexture(1, mask, location('uMask'));
      uniforms = { time: location('uTime'), crop: location('uCrop'), resolution: location('uResolution') };
      resize();
      syncFrames();
    } catch (error) {
      if (attempt !== generation || gl.isContextLost()) return;
      console.warn('Waterfall film selected:', error.message);
      useFilm();
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(hero);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncFrames();
  });
  visibilityObserver.observe(hero);
  document.addEventListener('visibilitychange', syncFrames);
  portrait.addEventListener('change', resize);
  canvas.addEventListener('webglcontextlost', event => {
    if (retired) return;
    event.preventDefault();
    generation++;
    uniforms = null;
    syncFrames();
    showSurface(false);
  });
  canvas.addEventListener('webglcontextrestored', initialize);
  initialize();
})();
