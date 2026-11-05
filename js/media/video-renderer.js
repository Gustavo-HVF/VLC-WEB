/* VLC Web — renderizador de vídeo com filtros em WebGL
 * Implementa os filtros de "Ferramentas → Efeitos e filtros → Efeitos de vídeo" do VLC:
 * ajuste de imagem, nitidez, remoção de faixas, granulação, corte, extração/limiar de cor, sépia,
 * posterização, inversão, gradiente/bordas/cartoon, transformação, rotação, zoom interativo,
 * parede, clone, quebra‑cabeça, espelho, anaglifo 3D, borrão de movimento, desfoque espacial,
 * ondas, ondulação, psicodélico, redução de ruído, detecção de movimento, arte ASCII,
 * logotipo e letreiro (marquee), além de desentrelaçamento, proporção, corte e zoom. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex, uPrevIn, uPrevOut, uOverlay, uPuzzle, uAscii;
uniform vec2 uSrcSize, uOutSize;
uniform vec4 uCrop;
uniform mat3 uGeo;
uniform float uAngle, uTime, uFrame;
uniform vec3 uZoom;
uniform int uTile, uMirror, uDistort, uDeint;
uniform vec2 uGrid, uPuzzleSel;
uniform float uSharpen, uBlur, uGrain, uDeband, uSepia, uPosterize, uMotionBlur, uDenoise, uAsciiChars;
uniform int uAdjust, uNegate, uGradient, uCartoon, uPsy, uAnaglyph, uMotionDetect, uAsciiOn, uOverlayOn, uPrevOn, uExtractOn, uThreshOn;
uniform float uBright, uContrast, uHue, uSat, uGamma;
uniform vec3 uExtract, uThresh;
uniform vec2 uThreshP, uAsciiCell;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 rgb2yiq(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 yiq2rgb(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }
vec3 hueRotate(vec3 c, float a) {
  vec3 y = rgb2yiq(c);
  float h = atan(y.z, y.y + 1e-6) + a, ch = length(y.yz);
  return yiq2rgb(vec3(y.x, ch * cos(h), ch * sin(h)));
}
vec2 toTex(vec2 uv) { return mix(uCrop.xy, uCrop.zw, uv); }

vec3 rawAt(vec2 t) {
  if (uDeint == 0) return texture2D(uTex, t).rgb;
  float H = uSrcSize.y;
  float row = floor(t.y * H);
  float even = floor(row / 2.0) * 2.0;
  if (uDeint == 1) return texture2D(uTex, vec2(t.x, (even + 0.5) / H)).rgb;
  if (uDeint == 2) return 0.5 * (texture2D(uTex, vec2(t.x, (even + 0.5) / H)).rgb + texture2D(uTex, vec2(t.x, (even + 1.5) / H)).rgb);
  if (uDeint == 3) return texture2D(uTex, vec2(t.x, (even + mod(uFrame, 2.0) + 0.5) / H)).rgb;
  if (mod(row, 2.0) < 0.5) return texture2D(uTex, vec2(t.x, (row + 0.5) / H)).rgb;
  return 0.5 * (texture2D(uTex, vec2(t.x, (row - 0.5) / H)).rgb + texture2D(uTex, vec2(t.x, (row + 1.5) / H)).rgb);
}

vec3 sampleFx(vec2 uv) {
  vec2 t = toTex(uv);
  vec2 o = 1.0 / uSrcSize;
  vec3 c;
  if (uBlur > 0.0) {
    vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = -3; i <= 3; i++) {
      for (int j = -3; j <= 3; j++) {
        vec2 d = vec2(float(i), float(j));
        float w = exp(-dot(d, d) / 4.5);
        acc += rawAt(t + d * o * uBlur) * w; ws += w;
      }
    }
    c = acc / ws;
  } else c = rawAt(t);
  if (uSharpen > 0.0) {
    vec3 n = rawAt(t + vec2(o.x, 0.0)) + rawAt(t - vec2(o.x, 0.0)) + rawAt(t + vec2(0.0, o.y)) + rawAt(t - vec2(0.0, o.y));
    c = c + uSharpen * 2.0 * (c - n * 0.25);
  }
  if (uDeband > 0.0) {
    vec2 r = o * (2.0 + 8.0 * uDeband);
    vec3 a = 0.25 * (rawAt(t + r) + rawAt(t - r) + rawAt(t + vec2(r.x, -r.y)) + rawAt(t + vec2(-r.x, r.y)));
    if (length(a - c) < 0.015 + 0.04 * uDeband) c = mix(c, a, 0.8);
    c += (rand(t * uSrcSize + fract(uTime)) - 0.5) / 128.0;
  }
  return c;
}

float sobel(vec2 uv) {
  vec2 t = toTex(uv); vec2 o = 1.0 / uSrcSize;
  float tl = luma(rawAt(t + o * vec2(-1.0, -1.0))), tc = luma(rawAt(t + o * vec2(0.0, -1.0))), tr = luma(rawAt(t + o * vec2(1.0, -1.0)));
  float ml = luma(rawAt(t + o * vec2(-1.0, 0.0))), mr = luma(rawAt(t + o * vec2(1.0, 0.0)));
  float bl = luma(rawAt(t + o * vec2(-1.0, 1.0))), bc = luma(rawAt(t + o * vec2(0.0, 1.0))), br = luma(rawAt(t + o * vec2(1.0, 1.0)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}

void main() {
  vec2 uv = uZoom.xy + (vUv - 0.5) / uZoom.z;
  vec2 cellLocal = vec2(0.0);
  if (uAsciiOn == 1) {
    vec2 cells = floor(uOutSize / uAsciiCell);
    vec2 c = floor(uv * cells);
    cellLocal = fract(uv * cells);
    uv = (c + 0.5) / cells;
  }
  float edge = 0.0, hilite = 0.0;
  if (uTile == 1) {
    vec2 f = fract(uv * uGrid);
    vec2 bw = 0.004 * uGrid;
    if (f.x < bw.x || f.x > 1.0 - bw.x || f.y < bw.y || f.y > 1.0 - bw.y) edge = 1.0;
  } else if (uTile == 2) {
    uv = fract(uv * uGrid);
  } else if (uTile == 3) {
    vec2 g = uv * uGrid; vec2 cell = floor(g); vec2 f = fract(g);
    vec2 src = floor(texture2D(uPuzzle, (cell + 0.5) / uGrid).rg * 255.0 + 0.5);
    uv = (src + f) / uGrid;
    vec2 bw = 0.006 * uGrid;
    if (f.x < bw.x || f.x > 1.0 - bw.x || f.y < bw.y || f.y > 1.0 - bw.y) edge = 0.7;
    if (cell.x == uPuzzleSel.x && cell.y == uPuzzleSel.y) hilite = 1.0;
  } else if (uTile == 4) {
    if (uMirror == 1 && uv.x > 0.5) uv.x = 1.0 - uv.x;
    if (uMirror == 2 && uv.x < 0.5) uv.x = 1.0 - uv.x;
    if (uMirror == 3 && uv.y > 0.5) uv.y = 1.0 - uv.y;
    if (uMirror == 4 && uv.y < 0.5) uv.y = 1.0 - uv.y;
  }
  if (uDistort == 1) {
    uv.x += sin(uv.y * 20.0 + uTime * 3.0) * 0.012;
    uv.y += sin(uv.x * 14.0 + uTime * 2.1) * 0.006;
  } else if (uDistort == 2) {
    vec2 d = uv - 0.5; float r = length(d);
    uv += (d / (r + 1e-4)) * sin(r * 70.0 - uTime * 5.0) * 0.005 * smoothstep(0.0, 0.15, r);
  }
  if (uAngle != 0.0) {
    float ar = uOutSize.x / uOutSize.y;
    vec2 p = (uv - 0.5) * vec2(ar, 1.0);
    float cs = cos(uAngle), sn = sin(uAngle);
    p = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
    uv = p / vec2(ar, 1.0) + 0.5;
  }
  vec2 suv = (uGeo * vec3(uv, 1.0)).xy;
  if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec3 c;
  if (uAnaglyph > 0) {
    vec3 L = sampleFx(vec2(suv.x * 0.5, suv.y)), R = sampleFx(vec2(0.5 + suv.x * 0.5, suv.y));
    if (uAnaglyph == 1) c = vec3(L.r, R.g, R.b);
    else if (uAnaglyph == 2) c = vec3(luma(L), luma(R), 0.0);
    else if (uAnaglyph == 3) c = vec3(luma(L), 0.0, luma(R));
    else if (uAnaglyph == 4) c = vec3(R.r, L.g, R.b);
    else c = vec3(L.r, R.g, 0.5 * (L.b + R.b));
  } else c = sampleFx(suv);

  if (uAdjust == 1) {
    c = hueRotate(c, uHue);
    c = mix(vec3(luma(c)), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    c += uBright - 1.0;
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / uGamma));
  }
  if (uThreshOn == 1) {
    vec3 a = rgb2yiq(c), b = rgb2yiq(uThresh);
    float sat = length(a.yz);
    float ang = acos(clamp(dot(normalize(a.yz + 1e-6), normalize(b.yz + 1e-6)), -1.0, 1.0));
    if (!(sat > uThreshP.x && ang < uThreshP.y)) c = vec3(luma(c));
  }
  if (uExtractOn == 1) {
    vec3 a = rgb2yiq(c), b = rgb2yiq(uExtract);
    vec2 d = normalize(b.yz + 1e-6);
    c = yiq2rgb(vec3(a.x, d * max(dot(a.yz, d), 0.0)));
  }
  if (uSepia > 0.0) {
    vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
    c = mix(c, s, uSepia);
  }
  if (uPosterize > 1.0) c = floor(c * (uPosterize - 1.0) + 0.5) / (uPosterize - 1.0);
  if (uGradient > 0) {
    float m = sobel(suv);
    if (uCartoon == 1) c = floor(c * 5.0 + 0.5) / 5.0 * (m > 0.35 ? 0.0 : 1.0);
    else if (uGradient == 1) c = vec3(m) * vec3(0.6, 0.85, 1.0) * 1.6;
    else c = vec3(m > 0.3 ? 0.0 : 1.0);
  }
  if (uNegate == 1) c = 1.0 - c;
  if (uPsy == 1) { c = hueRotate(c, uTime * 2.0 + luma(c) * 6.2831); c = mix(vec3(luma(c)), c, 1.8); }
  if (uGrain > 0.0) c += (rand(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * uGrain * 0.08;
  if (uMotionDetect == 1) {
    vec2 t = toTex(suv);
    float d = length(texture2D(uTex, t).rgb - texture2D(uPrevIn, t).rgb);
    if (d > 0.12) c = mix(c, vec3(1.0, 0.1, 0.1), 0.65);
  }
  if (uPrevOn == 1) {
    vec3 p = texture2D(uPrevOut, gl_FragCoord.xy / uOutSize).rgb;
    if (uDenoise > 0.0) { float d = length(c - p); c = mix(c, p, uDenoise * 0.85 * (1.0 - smoothstep(0.02, 0.12, d))); }
    if (uMotionBlur > 0.0) c = mix(c, p, uMotionBlur);
  }
  if (uAsciiOn == 1) {
    float l = clamp(luma(c), 0.0, 1.0);
    float idx = floor(l * (uAsciiChars - 1.0) + 0.5);
    float m = texture2D(uAscii, vec2((idx + cellLocal.x) / uAsciiChars, cellLocal.y)).r;
    c = clamp(c * 1.5, 0.0, 1.0) * m;
  }
  c = mix(c, vec3(0.0), edge);
  if (hilite > 0.0) c = mix(c, vec3(1.0, 0.55, 0.0), 0.35);
  if (uOverlayOn == 1) { vec4 o = texture2D(uOverlay, vUv); c = mix(c, o.rgb, o.a); }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  const COPY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y)); }`;

  const ASCII_RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

  const UNIFORMS = ['uTex', 'uPrevIn', 'uPrevOut', 'uOverlay', 'uPuzzle', 'uAscii', 'uSrcSize', 'uOutSize', 'uCrop', 'uGeo', 'uAngle', 'uTime', 'uFrame', 'uZoom',
    'uTile', 'uMirror', 'uDistort', 'uDeint', 'uGrid', 'uPuzzleSel', 'uSharpen', 'uBlur', 'uGrain', 'uDeband', 'uSepia', 'uPosterize', 'uMotionBlur', 'uDenoise', 'uAsciiChars',
    'uAdjust', 'uNegate', 'uGradient', 'uCartoon', 'uPsy', 'uAnaglyph', 'uMotionDetect', 'uAsciiOn', 'uOverlayOn', 'uPrevOn', 'uExtractOn', 'uThreshOn',
    'uBright', 'uContrast', 'uHue', 'uSat', 'uGamma', 'uExtract', 'uThresh', 'uThreshP', 'uAsciiCell'];

  function defaultParams() {
    return {
      adjust: false, hue: 0, brightness: 1, contrast: 1, saturation: 1, gamma: 1,
      sharpen: false, sharpenSigma: 0.05,
      deband: false, debandStrength: 0.5,
      grain: false, grainVariance: 2,
      cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
      extract: false, extractColor: '#ff0000',
      threshold: false, thresholdColor: '#ff0000', thresholdSat: 20, thresholdSim: 15,
      sepia: false, sepiaIntensity: 120,
      posterize: false, posterizeLevels: 6,
      negate: false,
      gradient: false, gradientMode: 'gradient', cartoon: false,
      transform: false, transformType: '90',
      rotate: false, rotateAngle: 0,
      izoom: false,
      wall: false, wallCols: 3, wallRows: 3,
      clone: false, cloneCount: 2,
      puzzle: false, puzzleCols: 4, puzzleRows: 4,
      mirror: false, mirrorMode: 'vertical-lr',
      anaglyph: false, anaglyphScheme: 'red-cyan',
      motionBlur: false, motionBlurFactor: 80,
      spatialBlur: false, blurSigma: 2,
      waves: false, ripple: false, psychedelic: false,
      denoise: false, denoiseStrength: 0.5,
      motionDetect: false,
      ascii: false, asciiCols: 120,
      deinterlace: 'off',
      logo: false, logoX: -1, logoY: -1, logoPos: 'top-right', logoOpacity: 255, logoScale: 100,
      marquee: false, marqueeText: 'VLC Web — $t', marqueePos: 'bottom-left', marqueeColor: '#ffffff', marqueeSize: 0, marqueeOpacity: 255, marqueeTimeout: 0, marqueeX: 0, marqueeY: 0
    };
  }

  const RATIO = s => { if (!s || s === 'default') return 0; const p = String(s).split(':'); return p.length === 2 ? (+p[0] / +p[1]) : parseFloat(s); };

  class VideoRenderer extends U.Emitter {
    constructor(stage, canvas, log) {
      super();
      this.stage = stage;
      this.canvas = canvas;
      this.log = log;
      this.source = null;
      this.p = defaultParams();
      this.view = { aspect: 'default', crop: 'default', zoom: 'fit' };
      this.iz = { scale: 1, cx: 0.5, cy: 0.5 };
      this.puzzle = { cols: 0, rows: 0, perm: [], sel: null };
      this.mode = 'webgl';
      this.frame = 0;
      this.dirty = true;
      this.outW = 0; this.outH = 0;
      this.logoImg = null;
      this.overlayDirty = true;
      this.overlayStart = performance.now();
      this.marqueeVars = () => ({});
      this.hidden = true;
      this.fps = 0;
      this.cssMode = false;
      this.tainted = false;
      // desempenho: resolução máxima de processamento e exibição direta (sem WebGL) quando não há efeitos
      this.maxRes = 'auto';        // 'auto' (tamanho da tela) | 'original' | altura máxima: '2160' '1440' '1080' '720' '480' '360'
      this.directIdle = true;
      this.direct = false;         // exibindo o <video> diretamente (sem efeitos)
      this.natW = 0; this.natH = 0;
      this.newFrame = true; this.lastFrameCb = 0;
      this.loopFps = 60; this._loopT = 0; this._loopN = 0;
      if (!this.initGL()) this.mode = 'css';
      this.overlayCanvas = document.createElement('canvas');
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(stage);
      this.bindPointer();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    /* ---------------- inicialização WebGL ---------------- */
    initGL() {
      if (!U.supports.webgl) return false;
      const gl = this.gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) ||
        this.canvas.getContext('experimental-webgl');
      if (!gl) return false;
      try {
        this.prog = this.makeProgram(VERT, FRAG);
        this.copyProg = this.makeProgram(VERT, COPY_FRAG);
      } catch (e) {
        this.log.error('video', 'Falha ao compilar shaders: ' + e.message);
        return false;
      }
      this.loc = {};
      for (const u of UNIFORMS) this.loc[u] = gl.getUniformLocation(this.prog, u);
      this.copyLoc = gl.getUniformLocation(this.copyProg, 'uTex');
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const mk = (filter) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        return t;
      };
      this.mkTex = mk;
      this.srcTex = [mk(), mk()];
      this.srcIdx = 0;
      this.overlayTex = mk();
      this.puzzleTex = mk(gl.NEAREST);
      this.asciiTex = mk();
      this.dummyTex = mk();
      this.fbo = null;
      this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.log.warn('video', 'Contexto WebGL perdido'); this.glLost = true; });
      this.canvas.addEventListener('webglcontextrestored', () => { this.log.info('video', 'Contexto WebGL restaurado'); this.glLost = false; this.initGL(); this.dirty = true; });
      this.buildAscii();
      return true;
    }

    makeProgram(vs, fs) {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    buildAscii() {
      const n = ASCII_RAMP.length, cw = 16, ch = 24;
      const c = document.createElement('canvas');
      c.width = n * cw; c.height = ch;
      const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff'; x.font = 'bold 20px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let i = 0; i < n; i++) x.fillText(ASCII_RAMP[i], i * cw + cw / 2, ch / 2 + 1);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.asciiTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    }

    /* ---------------- fonte ---------------- */
    setSource(el) {
      this.source = el;
      this.dirty = true;
      this.overlayDirty = true;
      this.iz = { scale: 1, cx: 0.5, cy: 0.5 };
      this.tainted = false;
      this.newFrame = true;
      this.updateMode(true);
      if (el && el.tagName === 'VIDEO' && U.supports.rvfc) this._watchFrames(el);
    }

    setTainted(t) {
      this.tainted = !!t;
      this.updateMode(true);
    }

    /** Algum efeito que só o WebGL faz está ativo? (sem nenhum, o vídeo pode ser exibido diretamente) */
    needsGL() {
      const p = this.p;
      if (p.adjust || p.sharpen || p.deband || p.grain || p.extract || p.threshold || p.sepia || p.posterize || p.negate || p.gradient ||
        p.transform || (p.rotate && p.rotateAngle) || p.izoom || p.wall || p.clone || p.puzzle || p.mirror || p.anaglyph || p.motionBlur ||
        p.spatialBlur || p.waves || p.ripple || p.psychedelic || p.denoise || p.motionDetect || p.ascii || (p.deinterlace && p.deinterlace !== 'off') ||
        p.logo || p.marquee || p.cropTop || p.cropBottom || p.cropLeft || p.cropRight) return true;
      // corte da proporção: no modo direto depende de object-view-box
      if (this.view.crop !== 'default' && !(window.CSS && CSS.supports && CSS.supports('object-view-box', 'inset(0% 0% 0% 0%)'))) return true;
      return false;
    }

    /** Decide entre WebGL e exibição direta do elemento de vídeo. */
    updateMode(force) {
      const src = this.source;
      const direct = !this.tainted && this.mode !== 'css' && this.directIdle && !!src && src.tagName === 'VIDEO' && !this.needsGL();
      const css = this.mode === 'css' || this.tainted || direct;
      if (!force && css === this.cssMode && direct === this.direct) return;
      const was = this.cssMode;
      this.cssMode = css;
      this.direct = direct;
      if (was && !css && src && src.style) { src.style.filter = ''; src.style.transform = ''; }
      this.dirty = true;
      this.updateDisplayMode();
      this.layout();
      if (was !== css) this.emit('mode', { css, direct });
    }

    setDirectIdle(on) { this.directIdle = !!on; this.updateMode(); }
    setMaxRes(v) { this.maxRes = String(v || 'auto'); this.layout(); this.emit('resolution', this.resolutionInfo()); }

    /** Resolução original × resolução de processamento (para a barra de status e as informações). */
    resolutionInfo() {
      return { srcW: this.srcW, srcH: this.srcH, outW: this.cssMode ? this.srcW : this.outW, outH: this.cssMode ? this.srcH : this.outH, direct: this.direct, css: this.cssMode, capped: !this.cssMode && this.outH < this.natH - 1, maxRes: this.maxRes };
    }

    _watchFrames(el) {
      let last = null;
      const cb = (now, meta) => {
        if (this.source !== el) return;
        if (last && meta.presentedFrames > last.presentedFrames && meta.mediaTime > last.mediaTime) {
          const dt = (meta.mediaTime - last.mediaTime) / (meta.presentedFrames - last.presentedFrames);
          if (dt > 0.004 && dt < 0.5) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        }
        last = meta;
        this.frameMeta = meta;
        this.newFrame = true;
        this.lastFrameCb = performance.now();
        el.requestVideoFrameCallback(cb);
      };
      el.requestVideoFrameCallback(cb);
    }

    get srcW() { const s = this.source; return s ? (s.videoWidth || s.naturalWidth || 0) : 0; }
    get srcH() { const s = this.source; return s ? (s.videoHeight || s.naturalHeight || 0) : 0; }
    get hasVideo() { return this.srcW > 0 && this.srcH > 0; }

    updateDisplayMode() {
      const showCanvas = !this.hidden && this.hasVideo && !this.cssMode;
      this.canvas.style.display = showCanvas ? 'block' : 'none';
      for (const v of this.stage.querySelectorAll('video.media-el')) v.classList.toggle('visible', !this.hidden && this.cssMode && v === this.source);
    }

    show(on) { this.hidden = !on; this.updateDisplayMode(); this.layout(); this.dirty = true; }

    /* ---------------- parâmetros ---------------- */
    set(key, value) {
      const old = this.p[key];
      this.p[key] = value;
      if (key.startsWith('logo') || key.startsWith('marquee')) { this.overlayDirty = true; if (key === 'marquee' && value) this.overlayStart = performance.now(); }
      if (key === 'puzzle' || key === 'puzzleCols' || key === 'puzzleRows') this.shufflePuzzle();
      if (key === 'izoom' && !value) this.iz = { scale: 1, cx: 0.5, cy: 0.5 };
      if (key.startsWith('crop') || key.startsWith('transform') || key === 'ascii') this.layout();
      if (key === 'deinterlace' || key === 'izoom') this.emit('change');
      this.dirty = true;
      this.updateMode();
      this.applyCss();
      this.emit('params', key, value, old);
      this.updateMiniMap();
    }
    setMany(obj) { for (const k in obj) this.set(k, obj[k]); }
    reset() {
      const keepDeint = this.p.deinterlace;
      this.p = defaultParams();
      this.p.deinterlace = keepDeint;
      this.iz = { scale: 1, cx: 0.5, cy: 0.5 };
      this.overlayDirty = true; this.dirty = true;
      this.layout(); this.applyCss();
      this.emit('params', '*');
    }
    setView(patch) { Object.assign(this.view, patch); this.updateMode(); this.layout(); this.dirty = true; this.emit('view', this.view); }

    setLogo(img) { this.logoImg = img; this.overlayDirty = true; this.dirty = true; }

    shufflePuzzle() {
      const cols = U.clamp(this.p.puzzleCols | 0, 2, 16), rows = U.clamp(this.p.puzzleRows | 0, 2, 16);
      const n = cols * rows;
      const perm = [...Array(n).keys()];
      do {
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      } while (perm.every((v, i) => v === i));
      this.puzzle = { cols, rows, perm, sel: null };
      this.uploadPuzzle();
    }
    uploadPuzzle() {
      if (!this.gl) return;
      const { cols, rows, perm } = this.puzzle;
      const data = new Uint8Array(cols * rows * 4);
      perm.forEach((src, i) => { data[i * 4] = src % cols; data[i * 4 + 1] = Math.floor(src / cols); data[i * 4 + 3] = 255; });
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.puzzleTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this.dirty = true;
    }

    /* ---------------- geometria / layout ---------------- */
    get rotated() { return this.p.transform && ['90', '270', 'transpose', 'antitranspose'].includes(this.p.transformType); }

    geoMatrix() {
      // linhas [a b c; d e f]: suv.x = a*x + b*y + c ; suv.y = d*x + e*y + f
      let m = [1, 0, 0, 0, 1, 0];
      if (this.p.transform) {
        m = {
          '90': [0, 1, 0, -1, 0, 1], '180': [-1, 0, 1, 0, -1, 1], '270': [0, -1, 1, 1, 0, 0],
          hflip: [-1, 0, 1, 0, 1, 0], vflip: [1, 0, 0, 0, -1, 1], transpose: [0, 1, 0, 1, 0, 0], antitranspose: [0, -1, 1, -1, 0, 1]
        }[this.p.transformType] || m;
      }
      return new Float32Array([m[0], m[3], 0, m[1], m[4], 0, m[2], m[5], 1]);
    }

    computeCrop() {
      const sw = this.srcW, sh = this.srcH;
      const p = this.p;
      let x0 = U.clamp(p.cropLeft, 0, sw - 16), y0 = U.clamp(p.cropTop, 0, sh - 16);
      let cw = Math.max(16, sw - x0 - U.clamp(p.cropRight, 0, sw)), ch = Math.max(16, sh - y0 - U.clamp(p.cropBottom, 0, sh));
      const r = RATIO(this.view.crop);
      if (r > 0) {
        if (cw / ch > r) { const nw = ch * r; x0 += (cw - nw) / 2; cw = nw; }
        else { const nh = cw / r; y0 += (ch - nh) / 2; ch = nh; }
      }
      return { x0, y0, cw, ch, rect: [x0 / sw, y0 / sh, (x0 + cw) / sw, (y0 + ch) / sh] };
    }

    layout() {
      const W = this.stage.clientWidth, H = this.stage.clientHeight;
      if (!this.hasVideo || this.hidden) {
        this.displayRect = { x: 0, y: 0, w: W, h: H };
        this.emit('layout', this.displayRect);
        this.updateDisplayMode();
        return;
      }
      const c = this.computeCrop();
      this.cropRect = c.rect;
      const ar = RATIO(this.view.aspect);
      let dar = ar > 0 ? ar : c.cw / c.ch;
      if (ar > 0 && RATIO(this.view.crop) > 0) dar = RATIO(this.view.crop);
      const rot = this.rotated;
      if (rot) dar = 1 / dar;
      let outH = Math.round(rot ? c.cw : c.ch), outW = Math.round(outH * dar);
      const maxDim = 3840;
      if (Math.max(outW, outH) > maxDim) { const k = maxDim / Math.max(outW, outH); outW = Math.round(outW * k); outH = Math.round(outH * k); }
      let dw, dh;
      if (this.view.zoom === 'fit') {
        if (W / H > dar) { dh = H; dw = H * dar; } else { dw = W; dh = W / dar; }
      } else {
        const z = +this.view.zoom || 1;
        dh = (rot ? c.cw : c.ch) * z; dw = dh * dar;
      }
      this.natW = outW; this.natH = outH;
      // resolução de processamento: sem sentido processar 4K para exibir numa janela pequena
      if (!this._fullRes) {
        let k = 1;
        if (this.maxRes === 'auto') {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          k = Math.min(1, (dw * dpr) / outW);
          k = Math.max(k, Math.min(1, 360 / Math.min(outW, outH)));   // nunca abaixo de 360p
        } else if (+this.maxRes > 0) {
          const short = Math.min(outW, outH);
          if (short > +this.maxRes) k = +this.maxRes / short;
        }
        if (k < 0.98) {
          outW = Math.round(outW * k / 2) * 2; outH = Math.round(outH * k / 2) * 2;
          if (this.maxRes === 'auto') { outW = Math.ceil(outW / 16) * 16; outH = Math.max(2, Math.round(outW / (this.natW / this.natH) / 2) * 2); }
        }
      }
      this.outW = Math.max(2, Math.min(outW, this.natW || outW)); this.outH = Math.max(2, Math.min(outH, this.natH || outH));
      const x = (W - dw) / 2, y = (H - dh) / 2;
      this.cssRect = { x, y, w: dw, h: dh };
      const cs = this.canvas.style;
      cs.left = x + 'px'; cs.top = y + 'px'; cs.width = dw + 'px'; cs.height = dh + 'px';
      if (this.canvas.width !== this.outW || this.canvas.height !== this.outH) {
        this.canvas.width = this.outW; this.canvas.height = this.outH;
        this.overlayDirty = true; this.fbo = null;
      }
      const vx = Math.max(0, x), vy = Math.max(0, y);
      this.displayRect = { x: vx, y: vy, w: Math.min(W, x + dw) - vx, h: Math.min(H, y + dh) - vy };
      this.applyCss();
      this.updateDisplayMode();
      this.dirty = true;
      this.emit('layout', this.displayRect);
      const key = this.outW + 'x' + this.outH + (this.cssMode ? 'c' : '');
      if (key !== this._resKey) { this._resKey = key; this.emit('resolution', this.resolutionInfo()); }
    }

    /** Modo de compatibilidade (vídeo de outra origem sem CORS): filtros via CSS. */
    applyCss() {
      if (!this.cssMode || !this.source || this.source.tagName !== 'VIDEO') return;
      const v = this.source, p = this.p, r = this.cssRect;
      if (!r) return;
      const f = [];
      if (p.adjust) f.push(`brightness(${p.brightness})`, `contrast(${p.contrast})`, `saturate(${p.saturation})`, `hue-rotate(${p.hue}deg)`);
      if (p.sepia) f.push(`sepia(${p.sepiaIntensity / 255})`);
      if (p.negate) f.push('invert(1)');
      if (p.spatialBlur) f.push(`blur(${p.blurSigma}px)`);
      if (p.threshold || p.extract) f.push('grayscale(0.6)');
      v.style.filter = f.join(' ');
      let tr = '';
      let w = r.w, h = r.h;
      if (p.transform) {
        tr = { '90': 'rotate(90deg)', '180': 'rotate(180deg)', '270': 'rotate(270deg)', hflip: 'scaleX(-1)', vflip: 'scaleY(-1)', transpose: 'rotate(90deg) scaleY(-1)', antitranspose: 'rotate(270deg) scaleY(-1)' }[p.transformType] || '';
        if (this.rotated) { w = r.h; h = r.w; }
      }
      if (p.rotate && p.rotateAngle) tr += ` rotate(${p.rotateAngle}deg)`;
      Object.assign(v.style, { left: (r.x + (r.w - w) / 2) + 'px', top: (r.y + (r.h - h) / 2) + 'px', width: w + 'px', height: h + 'px', transform: tr, objectFit: 'fill' });
      const cr = this.cropRect || [0, 0, 1, 1];
      if (CSS.supports && CSS.supports('object-view-box', 'inset(0% 0% 0% 0%)')) {
        v.style.objectViewBox = `inset(${cr[1] * 100}% ${(1 - cr[2]) * 100}% ${(1 - cr[3]) * 100}% ${cr[0] * 100}%)`;
      }
    }

    /* ---------------- sobreposição (logotipo + letreiro) ---------------- */
    expandMarquee(text) {
      const vars = this.marqueeVars() || {};
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return String(text)
        .replace(/\$([a-zA-Z])/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
        .replace(/%([YymdHMSD])/g, (m, k) => ({ Y: d.getFullYear(), y: p(d.getFullYear() % 100), m: p(d.getMonth() + 1), d: p(d.getDate()), H: p(d.getHours()), M: p(d.getMinutes()), S: p(d.getSeconds()), D: d.toLocaleDateString() }[k]));
    }

    get marqueeDynamic() { return this.p.marquee && /[$%]/.test(this.p.marqueeText); }

    drawOverlay() {
      const W = this.outW, H = this.outH;
      const oc = this.overlayCanvas;
      if (oc.width !== W || oc.height !== H) { oc.width = W; oc.height = H; }
      const x = oc.getContext('2d');
      x.clearRect(0, 0, W, H);
      const place = (pos, w, h, margin) => {
        let px = (W - w) / 2, py = (H - h) / 2;
        if (pos.includes('left')) px = margin; if (pos.includes('right')) px = W - w - margin;
        if (pos.includes('top')) py = margin; if (pos.includes('bottom')) py = H - h - margin;
        return [px, py];
      };
      const p = this.p;
      if (p.logo && this.logoImg) {
        const k = (H / 720) * (p.logoScale / 100);
        const w = this.logoImg.naturalWidth * k, h = this.logoImg.naturalHeight * k;
        let [lx, ly] = place(p.logoPos, w, h, H * 0.03);
        if (p.logoX >= 0) lx = p.logoX * W / 100; if (p.logoY >= 0) ly = p.logoY * H / 100;
        x.globalAlpha = p.logoOpacity / 255;
        x.drawImage(this.logoImg, lx, ly, w, h);
        x.globalAlpha = 1;
      }
      const expired = p.marqueeTimeout > 0 && performance.now() - this.overlayStart > p.marqueeTimeout;
      if (p.marquee && !expired) {
        const size = p.marqueeSize > 0 ? p.marqueeSize * H / 720 : H * 0.045;
        x.font = `600 ${size}px system-ui, sans-serif`;
        x.textBaseline = 'top';
        const lines = this.expandMarquee(p.marqueeText).split('\n');
        const w = Math.max(...lines.map(l => x.measureText(l).width)), h = lines.length * size * 1.25;
        let [mx, my] = place(p.marqueePos, w, h, H * 0.03);
        if (p.marqueeX > 0) mx = p.marqueeX * W / 100; if (p.marqueeY > 0) my = p.marqueeY * H / 100;
        x.globalAlpha = p.marqueeOpacity / 255;
        x.lineJoin = 'round'; x.lineWidth = Math.max(2, size * 0.12); x.strokeStyle = 'rgba(0,0,0,.85)';
        x.fillStyle = p.marqueeColor;
        lines.forEach((l, i) => { x.strokeText(l, mx, my + i * size * 1.25); x.fillText(l, mx, my + i * size * 1.25); });
        x.globalAlpha = 1;
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
      this.overlayDirty = false;
      this.lastOverlay = performance.now();
    }

    /* ---------------- desenho ---------------- */
    ensureFbo() {
      const gl = this.gl;
      if (this.fbo && this.fbo.w === this.outW && this.fbo.h === this.outH) return;
      const mk = () => {
        const t = this.mkTex();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.outW, this.outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { t, f };
      };
      this.fbo = { w: this.outW, h: this.outH, a: mk(), b: mk() };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    draw() {
      const gl = this.gl;
      if (!gl || this.glLost || !this.hasVideo || this.cssMode || this.hidden) return;
      const p = this.p, src = this.source;
      // envio do quadro atual (com troca de texturas para a detecção de movimento)
      if (p.motionDetect) this.srcIdx ^= 1;
      const tex = this.srcTex[this.srcIdx];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.tagName === 'VIDEO' || src.tagName === 'IMG' ? src : src.img);
      } catch (e) {
        if (e.name === 'SecurityError') {
          this.log.warn('video', 'Vídeo de outra origem sem CORS: usando modo de compatibilidade (filtros limitados).');
          this.setTainted(true);
          this.emit('tainted');
          return;
        }
        return;
      }
      if (this.overlayDirty || (this.marqueeDynamic && performance.now() - (this.lastOverlay || 0) > 250) ||
        (p.marquee && p.marqueeTimeout > 0 && performance.now() - this.overlayStart > p.marqueeTimeout && !this._marqueeExpired)) {
        this._marqueeExpired = p.marquee && p.marqueeTimeout > 0 && performance.now() - this.overlayStart > p.marqueeTimeout;
        this.drawOverlay();
      }
      const needPrev = (p.motionBlur || p.denoise);
      gl.useProgram(this.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const L = this.loc;
      const bindTex = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(L[name], unit); };
      bindTex(0, tex, 'uTex');
      bindTex(1, p.motionDetect ? this.srcTex[this.srcIdx ^ 1] : this.dummyTex, 'uPrevIn');
      let target = null;
      if (needPrev) {
        this.ensureFbo();
        const cur = this.fbo.a, prev = this.fbo.b;
        bindTex(2, prev.t, 'uPrevOut');
        target = cur;
      } else bindTex(2, this.dummyTex, 'uPrevOut');
      bindTex(3, this.overlayTex, 'uOverlay');
      bindTex(4, this.puzzleTex, 'uPuzzle');
      bindTex(5, this.asciiTex, 'uAscii');

      const tile = p.puzzle ? 3 : p.wall ? 1 : p.clone ? 2 : p.mirror ? 4 : 0;
      const grid = p.puzzle ? [this.puzzle.cols, this.puzzle.rows] : p.wall ? [p.wallCols, p.wallRows] : p.clone ? cloneGrid(p.cloneCount) : [1, 1];
      const hex = h => { const m = String(h).match(/^#?(..)(..)(..)$/); return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 0, 0]; };
      const cr = this.cropRect || [0, 0, 1, 1];
      const asciiCellW = this.outW / U.clamp(p.asciiCols, 20, 400);
      gl.uniform2f(L.uSrcSize, this.srcW, this.srcH);
      gl.uniform2f(L.uOutSize, this.outW, this.outH);
      gl.uniform4f(L.uCrop, cr[0], cr[1], cr[2], cr[3]);
      gl.uniformMatrix3fv(L.uGeo, false, this.geoMatrix());
      gl.uniform1f(L.uAngle, p.rotate ? p.rotateAngle * Math.PI / 180 : 0);
      gl.uniform1f(L.uTime, performance.now() / 1000);
      gl.uniform1f(L.uFrame, this.frame++);
      gl.uniform3f(L.uZoom, p.izoom ? this.iz.cx : 0.5, p.izoom ? this.iz.cy : 0.5, p.izoom ? this.iz.scale : 1);
      gl.uniform1i(L.uTile, tile);
      gl.uniform1i(L.uMirror, p.mirror ? ({ 'vertical-lr': 1, 'vertical-rl': 2, 'horizontal-tb': 3, 'horizontal-bt': 4 }[p.mirrorMode] || 1) : 0);
      gl.uniform1i(L.uDistort, p.waves ? 1 : p.ripple ? 2 : 0);
      gl.uniform1i(L.uDeint, { off: 0, discard: 1, blend: 2, mean: 2, bob: 3, linear: 4 }[p.deinterlace] || 0);
      gl.uniform2f(L.uGrid, grid[0], grid[1]);
      const sel = this.puzzle.sel;
      gl.uniform2f(L.uPuzzleSel, sel ? sel[0] : -1, sel ? sel[1] : -1);
      gl.uniform1f(L.uSharpen, p.sharpen ? p.sharpenSigma : 0);
      gl.uniform1f(L.uBlur, p.spatialBlur ? p.blurSigma * 0.7 : 0);
      gl.uniform1f(L.uGrain, p.grain ? p.grainVariance : 0);
      gl.uniform1f(L.uDeband, p.deband ? p.debandStrength : 0);
      gl.uniform1f(L.uSepia, p.sepia ? p.sepiaIntensity / 255 : 0);
      gl.uniform1f(L.uPosterize, p.posterize ? U.clamp(p.posterizeLevels, 2, 256) : 0);
      gl.uniform1f(L.uMotionBlur, p.motionBlur ? U.clamp(p.motionBlurFactor / 128, 0, 0.98) : 0);
      gl.uniform1f(L.uDenoise, p.denoise ? p.denoiseStrength : 0);
      gl.uniform1f(L.uAsciiChars, ASCII_RAMP.length);
      gl.uniform2f(L.uAsciiCell, asciiCellW, asciiCellW * 1.6);
      gl.uniform1i(L.uAdjust, p.adjust ? 1 : 0);
      gl.uniform1i(L.uNegate, p.negate ? 1 : 0);
      gl.uniform1i(L.uGradient, p.gradient ? (p.gradientMode === 'edge' ? 2 : 1) : 0);
      gl.uniform1i(L.uCartoon, p.gradient && p.cartoon ? 1 : 0);
      gl.uniform1i(L.uPsy, p.psychedelic ? 1 : 0);
      gl.uniform1i(L.uAnaglyph, p.anaglyph ? ({ 'red-cyan': 1, 'red-green': 2, 'red-blue': 3, trioscopic: 4, 'magenta-cyan': 5 }[p.anaglyphScheme] || 1) : 0);
      gl.uniform1i(L.uMotionDetect, p.motionDetect ? 1 : 0);
      gl.uniform1i(L.uAsciiOn, p.ascii ? 1 : 0);
      gl.uniform1i(L.uOverlayOn, (p.logo && this.logoImg) || p.marquee ? 1 : 0);
      gl.uniform1i(L.uPrevOn, needPrev ? 1 : 0);
      gl.uniform1i(L.uExtractOn, p.extract ? 1 : 0);
      gl.uniform1i(L.uThreshOn, p.threshold ? 1 : 0);
      gl.uniform1f(L.uBright, p.brightness);
      gl.uniform1f(L.uContrast, p.contrast);
      gl.uniform1f(L.uHue, p.hue * Math.PI / 180);
      gl.uniform1f(L.uSat, p.saturation);
      gl.uniform1f(L.uGamma, Math.max(0.01, p.gamma));
      gl.uniform3fv(L.uExtract, hex(p.extractColor));
      gl.uniform3fv(L.uThresh, hex(p.thresholdColor));
      gl.uniform2f(L.uThreshP, p.thresholdSat / 255 * 0.6, (p.thresholdSim / 255) * Math.PI);

      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
      gl.viewport(0, 0, this.outW, this.outH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(this.copyProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.t);
        gl.uniform1i(this.copyLoc, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const t = this.fbo.a; this.fbo.a = this.fbo.b; this.fbo.b = t;
      }
      this.dirty = false;
    }

    _loop(now) {
      requestAnimationFrame(this._loop);
      // taxa de atualização da página (detecção de travamentos)
      this._loopN++;
      if (now - this._loopT >= 1000) { if (this._loopT) this.loopFps = this._loopN * 1000 / (now - this._loopT); this._loopT = now; this._loopN = 0; }
      if (!this.source || this.cssMode || this.hidden || !this.hasVideo) return;
      const s = this.source;
      const playing = s.tagName === 'VIDEO' && !s.paused && !s.ended;
      const p = this.p;
      const animated = p.waves || p.ripple || p.psychedelic || p.grain || p.deinterlace === 'bob' || p.motionBlur || p.denoise || this.marqueeDynamic || (p.marquee && p.marqueeTimeout > 0 && !this._marqueeExpired);
      // só desenha quando há um quadro novo (um vídeo de 24 qps numa tela de 60 Hz não precisa de 60 envios por segundo)
      const frameReady = this.newFrame || !U.supports.rvfc || s.tagName !== 'VIDEO' || now - this.lastFrameCb > 250;
      if (this.dirty || animated || (playing && frameReady)) { this.newFrame = false; this.draw(); }
    }

    /* ---------------- captura ---------------- */
    async snapshot(type = 'image/png', quality = 0.92) {
      if (!this.hasVideo) throw new Error('Nenhum vídeo em reprodução');
      if (!this.cssMode) {
        // a captura usa a resolução original, mesmo com a resolução de processamento reduzida
        const reduced = this.outW < this.natW - 1;
        if (reduced) { this._fullRes = true; this.layout(); }
        this.draw();
        const p = new Promise((res, rej) => this.canvas.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar imagem')), type, quality));
        if (reduced) { this._fullRes = false; this.layout(); this.draw(); }
        return await p;
      }
      const c = document.createElement('canvas');
      c.width = this.srcW; c.height = this.srcH;
      c.getContext('2d').drawImage(this.source, 0, 0);
      return await new Promise((res, rej) => {
        try { c.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar imagem')), type, quality); }
        catch (e) { rej(new Error('Captura bloqueada: o vídeo é de outra origem sem CORS')); }
      });
    }

    captureStream(fps = 30) {
      if (!this.cssMode && this.canvas.captureStream) return this.canvas.captureStream(fps);
      const s = this.source;
      if (s && (s.captureStream || s.mozCaptureStream)) return (s.captureStream || s.mozCaptureStream).call(s);
      throw new Error('Captura de vídeo indisponível');
    }

    /* ---------------- interação: quebra‑cabeça e zoom interativo ---------------- */
    uvFromEvent(e) {
      const r = this.canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    }

    bindPointer() {
      const cv = this.canvas;
      cv.addEventListener('click', e => {
        if (!this.p.puzzle) return;
        e.stopPropagation();
        const [u, v] = this.uvFromEvent(e);
        const { cols, rows, perm } = this.puzzle;
        const cell = [Math.floor(u * cols), Math.floor(v * rows)];
        if (!this.puzzle.sel) this.puzzle.sel = cell;
        else {
          const a = this.puzzle.sel[1] * cols + this.puzzle.sel[0], b = cell[1] * cols + cell[0];
          [perm[a], perm[b]] = [perm[b], perm[a]];
          this.puzzle.sel = null;
          this.uploadPuzzle();
          if (perm.every((v2, i) => v2 === i)) this.emit('puzzle-solved');
        }
        this.dirty = true;
      });
      cv.addEventListener('dblclick', e => { if (this.p.puzzle) e.stopPropagation(); });
      cv.addEventListener('wheel', e => {
        if (!this.p.izoom) return;
        e.preventDefault(); e.stopPropagation();
        const [u, v] = this.uvFromEvent(e);
        const old = this.iz.scale;
        const ns = U.clamp(old * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 12);
        const px = this.iz.cx + (u - 0.5) / old, py = this.iz.cy + (v - 0.5) / old;
        this.iz.scale = ns;
        this.iz.cx = px - (u - 0.5) / ns; this.iz.cy = py - (v - 0.5) / ns;
        this.clampZoom();
      }, { passive: false });
      let drag = null;
      cv.addEventListener('pointerdown', e => {
        if (!this.p.izoom || e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, cx: this.iz.cx, cy: this.iz.cy, moved: false };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const r = cv.getBoundingClientRect();
        const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
        if (Math.abs(dx) + Math.abs(dy) > 0.003) drag.moved = true;
        this.iz.cx = drag.cx - dx / this.iz.scale; this.iz.cy = drag.cy - dy / this.iz.scale;
        this.clampZoom();
      });
      const end = e => { if (drag && drag.moved) { e.stopPropagation(); this._suppressClick = true; setTimeout(() => { this._suppressClick = false; }, 50); } drag = null; };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }

    clampZoom() {
      const h = 0.5 / this.iz.scale;
      this.iz.cx = U.clamp(this.iz.cx, h, 1 - h);
      this.iz.cy = U.clamp(this.iz.cy, h, 1 - h);
      this.dirty = true;
      this.updateMiniMap();
    }

    updateMiniMap() {
      const mm = this.miniMap;
      if (!mm) return;
      const on = this.p.izoom && this.hasVideo && !this.cssMode;
      mm.style.display = on ? 'block' : 'none';
      if (!on) return;
      const box = mm.firstElementChild;
      const s = this.iz.scale;
      Object.assign(box.style, { left: ((this.iz.cx - 0.5 / s) * 100) + '%', top: ((this.iz.cy - 0.5 / s) * 100) + '%', width: (100 / s) + '%', height: (100 / s) + '%' });
      const dar = this.outW / this.outH || 16 / 9;
      mm.style.height = (140 / dar) + 'px';
    }
  }

  function cloneGrid(n) {
    n = U.clamp(n | 0, 1, 16);
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    return [cols, rows];
  }

  VideoRenderer.defaultParams = defaultParams;
  VideoRenderer.RATIO = RATIO;
  VW.VideoRenderer = VideoRenderer;
})(window.VW = window.VW || {});
