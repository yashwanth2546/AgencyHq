// <webgl-shader> — chromatic glass ribbons, ported from the supplied
// three.js component to raw WebGL1. A fullscreen triangle with a raw shader
// needs none of three.js's scene graph, so dropping it removes the whole
// dependency and the import map along with it. Shader source is unchanged.
//
// Attributes (all optional): x-scale, y-scale, distortion, intensity,
// speed, pointer-light. Also settable as JS properties.
(() => {
  if (customElements.get('webgl-shader')) return;

  const VERTEX = `
    attribute vec3 position;
    void main() { gl_Position = vec4(position, 1.0); }
  `;

  const FRAGMENT = `
    precision highp float;

    uniform vec2  resolution;
    uniform float time;
    uniform vec2  pointer;
    uniform float xScale;
    uniform float yScale;
    uniform float distortion;
    uniform float intensity;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

      p.y += 0.14 * sin(p.x * 1.70 - time * 0.35);
      p.x += 0.09 * sin(p.y * 1.25 + time * 0.22);

      p.y += (pointer.y - 0.5) * 0.35;
      p.x += (pointer.x - 0.5) * 0.20;

      float d  = length(p) * distortion;
      float rx = p.x * (1.0 + d);
      float gx = p.x;
      float bx = p.x * (1.0 - d);

      vec3 col = vec3(0.0);

      for (int i = 0; i < 3; i++) {
        float fi    = float(i);
        float phase = fi * 2.10;
        float xs    = xScale * (1.0 + fi * 0.38);
        float ys    = yScale * (1.0 - fi * 0.22);
        float t     = time  * (1.0 + fi * 0.17);
        float amp   = intensity * (1.0 - fi * 0.26);

        col.r += amp / abs(p.y + sin((rx + t) * xs + phase) * ys);
        col.g += amp / abs(p.y + sin((gx + t) * xs + phase) * ys);
        col.b += amp / abs(p.y + sin((bx + t) * xs + phase) * ys);
      }

      col = col / (1.0 + col);

      col += vec3(0.010, 0.014, 0.026) * (1.0 - length(p) * 0.35);

      col *= 1.0 - 0.30 * smoothstep(0.60, 1.70, length(p * vec2(0.70, 1.0)));

      col += (hash(gl_FragCoord.xy + fract(time)) - 0.5) / 255.0;

      gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.90)), 1.0);
    }
  `;

  // One fullscreen fragment shader costs pixels, not bytes: at DPR 3 a phone
  // viewport is ~9x the fragments of DPR 1, which is where mobile GPUs stall.
  // The profile trades resolution and octaves for frame rate, and is resolved
  // once, lazily, so innerWidth is real when it is read.
  let PROFILE = null;
  const profile = () => {
    if (PROFILE) return PROFILE;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
    const cores = navigator.hardwareConcurrency || 8;
    if (coarse && small) PROFILE = { maxDpr: 1.5, scale: 0.62, octaves: 2, prec: 'mediump', fps: 30 };
    else if (cores <= 4) PROFILE = { maxDpr: 1, scale: 0.85, octaves: 3, prec: 'mediump', fps: 60 };
    else PROFILE = { maxDpr: 2, scale: 1, octaves: 3, prec: 'highp', fps: 60 };
    return PROFILE;
  };

  const fragmentFor = p => FRAGMENT
    .replace('precision highp float;', 'precision ' + p.prec + ' float;')
    .replace('i < 3', 'i < ' + p.octaves);

  const DEFAULTS = {
    xScale: 1.0,
    yScale: 0.5,
    distortion: 0.05,
    intensity: 0.035,
    speed: 1.0,
    pointerLight: true,
  };

  const ATTR_MAP = {
    'x-scale': 'xScale',
    'y-scale': 'yScale',
    'distortion': 'distortion',
    'intensity': 'intensity',
    'speed': 'speed',
    'pointer-light': 'pointerLight',
  };

  let styled = false;
  const ensureStyle = () => {
    if (styled) return;
    styled = true;
    const st = document.createElement('style');
    st.textContent = 'webgl-shader{display:block;width:100%;height:100%}webgl-shader>canvas{display:block;width:100%;height:100%}';
    document.head.appendChild(st);
  };

  class WebGLShader extends HTMLElement {
    static get observedAttributes() { return Object.keys(ATTR_MAP); }

    constructor() {
      super();
      this.cfg = Object.assign({}, DEFAULTS);
      this._raf = 0;
      this._clock = 0;
      this._visible = true;
      this._onScreen = true;
      this._target = { x: 0.5, y: 0.5 };
      this._eased = { x: 0.5, y: 0.5 };
      this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      Object.keys(DEFAULTS).forEach(k => {
        Object.defineProperty(this, k, {
          get: () => this.cfg[k],
          set: v => { this.cfg[k] = k === 'pointerLight' ? !!v : Number(v); },
        });
      });
    }

    attributeChangedCallback(name, _old, val) {
      const key = ATTR_MAP[name];
      if (!key || val === null) return;
      this.cfg[key] = key === 'pointerLight' ? val !== 'false' : Number(val);
    }

    // Mount is deliberately cheap: a canvas and an observer. No GL context is
    // created until the element is near the viewport, so the two below-fold
    // instances cost nothing on first paint — they compile while the user is
    // still reading the hero.
    connectedCallback() {
      if (this._canvas) return;
      this.setAttribute('aria-hidden', 'true');
      ensureStyle();

      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'display:block;width:100%;height:100%;opacity:0;transition:opacity .6s linear';
      canvas.width = 1;
      canvas.height = 1;
      this.appendChild(canvas);
      this._canvas = canvas;

      this._io = new IntersectionObserver(([e]) => {
        this._onScreen = e.isIntersecting;
        if (this._onScreen && !this._booted) { this._boot(); return; }
        if (!this._booted) return;
        if (this._reduced) { if (this._onScreen) this._draw(); return; }
        this._sync();
      }, { rootMargin: '250px 0px', threshold: 0 });
      this._io.observe(this);

      this._onVis = () => {
        this._visible = !document.hidden;
        if (!this._booted) return;
        if (this._reduced) { if (this._visible) this._draw(); return; }
        this._sync();
      };
      document.addEventListener('visibilitychange', this._onVis);

      // IntersectionObserver may never deliver in a host that does not
      // composite this element; boot anyway rather than render nothing.
      this._bootTimer = setTimeout(() => { if (!this._booted) this._boot(); }, 1200);
    }

    _boot() {
      if (this._booted || !this._canvas) return;
      this._booted = true;
      // Attributes are not present in the constructor for framework-created
      // elements, so the opt-out is read here instead.
      if (this._reduced && this.getAttribute('force-motion') !== null && this.getAttribute('force-motion') !== 'false') this._reduced = false;
      clearTimeout(this._bootTimer);
      const p = profile();
      this._maxDpr = p.maxDpr;
      this._scale = p.scale;
      this._minDt = p.fps < 60 ? 1000 / p.fps - 2 : 0;
      // Fewer octaves means less accumulated amplitude; hold the look level.
      this._ampBoost = p.octaves === 3 ? 1 : 1.18;

      const canvas = this._canvas;
      // preserveDrawingBuffer: without it the buffer is discarded after each
      // composite, so the single reduced-motion frame vanishes and any canvas
      // capture (screenshot, PNG, PDF) reads black.
      const opts = { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' };
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) return;
      this._gl = gl;

      const prog = this._buildProgram(gl, fragmentFor(p));
      if (!prog) return;
      this._prog = prog;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'position');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      this._buf = buf;

      this._u = {};
      ['resolution', 'time', 'pointer', 'xScale', 'yScale', 'distortion', 'intensity']
        .forEach(n => { this._u[n] = gl.getUniformLocation(prog, n); });

      gl.useProgram(prog);
      gl.clearColor(0, 0, 0, 1);

      this._resize = this._resize.bind(this);
      this._ro = new ResizeObserver(entries => {
        this._resize(entries);
      });
      this._ro.observe(this);
      this._resize();

      this._onPointer = e => {
        const r = this.getBoundingClientRect();
        this._target.x = (e.clientX - r.left) / r.width;
        this._target.y = 1 - (e.clientY - r.top) / r.height;
      };
      if (this.cfg.pointerLight && matchMedia('(pointer: fine)').matches) {
        window.addEventListener('pointermove', this._onPointer, { passive: true });
      }

      this._frame = this._frame.bind(this);
      this._resize();
      if (!this._sized) this._retry();
      if (this._reduced) {
        // One frame is not enough on its own — redraw whenever the element could
        // have been recomposited.
        this._redraw = () => this._draw();
        window.addEventListener('scroll', this._redraw, { passive: true });
        window.addEventListener('resize', this._redraw);
        this._draw();
      } else {
        this._start();
      }

    }

    _buildProgram(gl, fragSrc) {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn('[webgl-shader]', gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, VERTEX);
      const fs = compile(gl.FRAGMENT_SHADER, fragSrc || FRAGMENT);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.warn('[webgl-shader]', gl.getProgramInfoLog(p));
        return null;
      }
      return p;
    }

    // Sized to this element, never to the window. Measures the host, because
    // that is what ResizeObserver reports and the canvas may not have been laid
    // out yet. A zero measurement is never cached — it reschedules, otherwise a
    // 1x1 buffer sticks for the life of the page and the equality guard below
    // swallows every later delivery.
    // Timer-based retry. Backs off, gives up after ~4s, and is cancelled the
    // moment a size commits.
    _retry() {
      if (this._sized || this._retryTimer) return;
      this._retryN = (this._retryN || 0) + 1;
      if (this._retryN > 26) return;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = 0;
        if (!this._sized && this._gl) this._resize();
      }, Math.min(16 * this._retryN, 250));
    }

    _applySize(w, h) {
      const gl = this._gl, c = this._canvas;
      c.width = w;
      c.height = h;
      gl.viewport(0, 0, w, h);
      this._res = [w, h];
      this._sized = true;
      c.style.opacity = '1';
      if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = 0; }
      // Reduced motion draws exactly once, so it must happen the instant a real
      // size exists — not from a callback that may never fire.
      if (this._reduced) this._draw();
    }

    _resize(entries) {
      const gl = this._gl, c = this._canvas;
      if (!gl || !c) return;
      const box = entries && entries[0] && entries[0].contentRect;
      const cw = Math.round((box && box.width) || this.clientWidth || c.clientWidth || 0);
      const ch = Math.round((box && box.height) || this.clientHeight || c.clientHeight || 0);
      if (cw <= 0 || ch <= 0) { this._retry(); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, this._maxDpr) * this._scale;
      const w = Math.max(1, Math.round(cw * dpr));
      const h = Math.max(1, Math.round(ch * dpr));
      if (c.width === w && c.height === h) return;
      this._applySize(w, h);
      if (this._reduced) this._draw();
    }

    _draw() {
      const gl = this._gl, u = this._u, c = this._canvas;
      if (!gl || !u || !c) return;
      const cw = c.clientWidth || 0, ch = c.clientHeight || 0;
      if (cw > 0 && ch > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, this._maxDpr) * this._scale;
        const w = Math.max(1, Math.round(cw * dpr));
        const h = Math.max(1, Math.round(ch * dpr));
        if (c.width !== w || c.height !== h) this._applySize(w, h);
      }
      if (!this._res) return;
      gl.useProgram(this._prog);
      gl.uniform2f(u.resolution, this._res[0], this._res[1]);
      gl.uniform1f(u.time, this._clock);
      gl.uniform2f(u.pointer, this._eased.x, this._eased.y);
      gl.uniform1f(u.xScale, this.cfg.xScale);
      gl.uniform1f(u.yScale, this.cfg.yScale);
      gl.uniform1f(u.distortion, this.cfg.distortion);
      gl.uniform1f(u.intensity, this.cfg.intensity * (this._ampBoost || 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _frame(now) {
      const dt = Math.min((now - this._last) / 1000, 0.05);
      this._last = now;
      this._clock += dt * this.cfg.speed;
      this._eased.x += (this._target.x - this._eased.x) * 0.06;
      this._eased.y += (this._target.y - this._eased.y) * 0.06;
      // The clock advances every frame so motion stays time-correct; only the
      // draw is throttled, so a 30fps cap costs fragments and not tempo.
      if (!this._minDt || now - (this._drawn || 0) >= this._minDt) {
        this._drawn = now;
        this._draw();
      }
      this._raf = this._useTimer
        ? setTimeout(() => this._frame(performance.now()), 33)
        : requestAnimationFrame(this._frame);
    }

    _start() {
      if (this._raf || this._reduced || !this._gl) return;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._frame);
      // Hosts where rAF never services its queue would otherwise stall the loop
      // silently; one check confirms a frame ran.
      clearTimeout(this._loopProbe);
      this._loopProbe = setTimeout(() => {
        if (this._raf && !this._clock) {
          this._useTimer = true;
          this._frame(performance.now());
        }
      }, 400);
    }

    _stop() {
      clearTimeout(this._loopProbe);
      if (!this._raf) return;
      if (this._useTimer) clearTimeout(this._raf); else cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    _sync() { (this._visible && this._onScreen) ? this._start() : this._stop(); }

    disconnectedCallback() {
      this._stop();
      clearTimeout(this._bootTimer);
      if (this._retryTimer) clearTimeout(this._retryTimer);
      if (this._io) this._io.disconnect();
      if (this._ro) this._ro.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('pointermove', this._onPointer);
      if (this._redraw) {
        window.removeEventListener('scroll', this._redraw);
        window.removeEventListener('resize', this._redraw);
      }
      const gl = this._gl;
      if (gl) {
        if (this._buf) gl.deleteBuffer(this._buf);
        if (this._prog) gl.deleteProgram(this._prog);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
      this._gl = this._prog = this._buf = this._u = null;
      if (this._canvas && this._canvas.parentNode === this) this.removeChild(this._canvas);
      this._canvas = null;
    }
  }

  customElements.define('webgl-shader', WebGLShader);
})();
