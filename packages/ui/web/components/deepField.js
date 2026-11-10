// 和「全鲸封锁」皮肤 client.js 里的 createDeepField 是同一份，改一处记得同步另一处
// 3D 背景：星点、节点和连线放进一个有纵深的盒子里做透视投影，近大远小、远处更淡；
// 镜头缓慢漂移，跟鼠标做轻微视差（近处的动得多）。原生 WebGL1，不引依赖，每帧两次绘制。
// 连线不用 gl.LINES（大多数显卡只有 1 像素宽），每段拆成两个三角形，在屏幕上按像素撑开宽度。
// 拿不到 WebGL 时返回 null，调用方退回 2D。
export function createDeepField(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;

  // 两个着色器共用的漂移与投影：节点在 xy 上做小幅正弦漂移，透视按 w = 深度
  const COMMON = `
    uniform float uT, uAspect, uF; uniform vec3 uCam;
    vec4 project(vec3 pos, vec4 drift, float ph) {
      vec3 p = pos + vec3(drift.x * sin(uT * drift.z + ph), drift.y * cos(uT * drift.w + ph), 0.0);
      vec3 v = p - uCam;
      return vec4(v.x * uF / uAspect, v.y * uF, 0.0, max(-v.z, 0.05));
    }
    float fade(float d) { return clamp(1.3 - d / 6.0, 0.25, 1.0); }`;

  // 点：位置 3 · 漂移 4 · 相位、大小、透明度、闪烁速度 4 · 种类 1（0 星点 · 1 节点 · 2 亮节点）
  const POINT_VS = COMMON + `
    attribute vec3 aPos; attribute vec4 aDrift; attribute vec4 aLook; attribute float aKind;
    uniform float uDpr, uPulse;
    varying float vA; varying float vKind;
    void main() {
      vec4 c = project(aPos, aDrift, aLook.x);
      float a = aLook.z * fade(c.w);
      float size = aLook.y;
      if (aLook.w > 0.0) a *= 0.55 + 0.45 * sin(uT * aLook.w + aLook.x);
      if (aKind > 1.5 && uPulse > 0.5) {
        float b = 0.5 + 0.5 * sin(uT * 1.1 + aLook.x); // 呼吸：亮度和大小一起变
        a *= 0.3 + 0.7 * b;
        size *= 0.7 + 0.6 * b;
      }
      vA = a; vKind = aKind;
      gl_Position = c;
      gl_PointSize = size * uDpr * 3.0 / c.w;
    }`;
  const POINT_FS = `
    precision mediump float;
    uniform vec3 uStar, uAccent; varying float vA; varying float vKind;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      if (r > 1.0) discard;
      float a = vA * (vKind > 1.5 ? 0.45 * exp(-r * r * 4.0) + smoothstep(0.28, 0.12, r) : smoothstep(1.0, 0.45, r));
      gl_FragColor = vec4((vKind < 0.5 ? uStar : uAccent) * a, a);
    }`;

  // 线：每个顶点带「自己这端」和「另一端」的位置、漂移、相位，再加朝哪边撑开（±1）和透明度
  const LINE_VS = COMMON + `
    attribute vec3 aPos; attribute vec4 aDrift; attribute float aPh;
    attribute vec3 bPos; attribute vec4 bDrift; attribute float bPh;
    attribute float aSide; attribute float aAlpha;
    uniform vec2 uView; uniform float uDpr, uWidth;
    varying float vA; varying float vSide;
    void main() {
      vec4 s = project(aPos, aDrift, aPh);
      vec4 o = project(bPos, bDrift, bPh);
      vec2 dir = (o.xy / o.w - s.xy / s.w) * uView;
      vec2 n = length(dir) > 0.0001 ? normalize(vec2(-dir.y, dir.x)) : vec2(0.0, 1.0);
      float px = max(uWidth * uDpr * 3.0 / s.w, uDpr) + 1.0; // 近粗远细，最细一像素，外加一像素羽化
      gl_Position = s + vec4(n * aSide * px / uView * s.w, 0.0, 0.0);
      vA = aAlpha * fade(s.w);
      vSide = aSide;
    }`;
  const LINE_FS = `
    precision mediump float;
    uniform vec3 uAccent; varying float vA; varying float vSide;
    void main() {
      float a = vA * smoothstep(1.0, 0.35, abs(vSide));
      gl_FragColor = vec4(uAccent * a, a);
    }`;

  const F = 1.732; // 视角 60°
  let point = null;
  let line = null;
  let opts = null;
  let lost = false;
  const cam = { x: 0, y: 0 };
  const aim = { x: 0, y: 0 };

  const program = (vs, fs, attrs, uniforms) => {
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const loc = {};
    for (const n of uniforms) loc[n] = gl.getUniformLocation(p, n);
    // attrs: [名字, 几个数]，按顺序紧挨着放
    let off = 0;
    const layout = attrs.map(([n, size]) => { const a = { at: gl.getAttribLocation(p, n), size, off }; off += size; return a; });
    return { p, loc, layout, stride: off, buf: gl.createBuffer(), n: 0 };
  };
  const COMMON_U = ['uT', 'uAspect', 'uF', 'uCam', 'uDpr', 'uAccent'];
  const init = () => {
    point = program(POINT_VS, POINT_FS, [['aPos', 3], ['aDrift', 4], ['aLook', 4], ['aKind', 1]], [...COMMON_U, 'uPulse', 'uStar']);
    line = program(LINE_VS, LINE_FS, [['aPos', 3], ['aDrift', 4], ['aPh', 1], ['bPos', 3], ['bDrift', 4], ['bPh', 1], ['aSide', 1], ['aAlpha', 1]], [...COMMON_U, 'uView', 'uWidth']);
    gl.enable(gl.BLEND);
  };
  try { init(); } catch (error) { return null; }

  const onLost = (event) => { event.preventDefault(); lost = true; };
  const onRestored = () => {
    try { init(); lost = false; if (opts) build(opts); } catch (error) { /* 恢复不了就停在空白，CSS 渐变还在 */ }
  };
  const onPointer = (event) => {
    aim.x = (event.clientX / window.innerWidth) * 2 - 1;
    aim.y = 1 - (event.clientY / window.innerHeight) * 2;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  window.addEventListener('pointermove', onPointer, { passive: true });

  const upload = (prog, data) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    prog.n = data.length / prog.stride;
  };

  // o: { w, h, dpr, dark, accent: [r,g,b] 0-255（浅色主题传加深过的主题色）, stars, lattice, pulse, rand }
  function build(o) {
    opts = o;
    if (lost) return;
    const { w, h, rand, dark } = o;
    const aspect = w / h;
    const area = w * h;
    // 屏幕上均匀撒点，再给一个深度：近处的稀、远处的密，整屏看起来都一样匀。多撒 15%，视差时边缘不露底
    const spot = (near, far) => {
      const d = near + rand() * (far - near);
      return [(rand() * 2 - 1) * 1.15 * aspect * d / F, (rand() * 2 - 1) * 1.15 * d / F, -d];
    };
    const pts = [];
    if (o.stars) {
      for (let i = Math.round(area / 2600); i > 0; i--) {
        const a = dark ? 0.25 + rand() * 0.45 : 0.2 + rand() * 0.3;
        const tw = rand() < 0.15 ? 0.5 + rand() * 1.5 : 0; // 约 15% 的星点闪烁
        pts.push(...spot(1.2, 7), 0, 0, 0, 0, rand() * 6.283, rand() < 0.92 ? 1.2 : 2.4, a, tw, 0);
      }
    }
    const seg = [];
    if (o.lattice) {
      const nodes = Array.from({ length: Math.round(area / 26000) }, () => {
        const p = spot(1.6, 5.5);
        const k = -p[2] / 3; // 漂移幅度随深度放大，屏幕上看起来一样大
        return {
          p, lit: rand() < 0.12, ph: rand() * 6.283,
          drift: [(0.012 + rand() * 0.02) * k, (0.012 + rand() * 0.02) * k, 0.04 + rand() * 0.06, 0.04 + rand() * 0.06],
        };
      });
      for (const n of nodes) pts.push(...n.p, ...n.drift, n.ph, n.lit ? 22 : 4, n.lit ? 1 : dark ? 0.6 : 0.7, 0, n.lit ? 2 : 1);
      // 每个节点连 3D 里最近的两个，太远不连（超过平均最近距离的 1.8 倍）：图案稀疏、不成网格
      const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
      const near = nodes.map((a) => nodes.filter((b) => b !== a).map((b) => [b, dist(a, b)]).sort((x, y) => x[1] - y[1]).slice(0, 2));
      const mean = near.reduce((s, l) => s + (l[0] ? l[0][1] : 0), 0) / Math.max(1, nodes.length);
      const seen = new Set();
      nodes.forEach((a, i) => near[i].forEach(([b, d]) => {
        const key = a.ph < b.ph ? a.ph + ':' + b.ph : b.ph + ':' + a.ph;
        if (d > mean * 1.8 || seen.has(key)) return;
        seen.add(key);
        const al = (dark ? 0.42 : 0.55) * (1 - d / (mean * 2.2));
        const v = (s, t, side) => seg.push(...s.p, ...s.drift, s.ph, ...t.p, ...t.drift, t.ph, side, al);
        // 两个三角形拼成一条带宽度的线；另一端看过来法线反向，所以 b 端的 ±1 反过来
        v(a, b, 1); v(a, b, -1); v(b, a, -1);
        v(a, b, -1); v(b, a, 1); v(b, a, -1);
      }));
    }
    upload(point, pts);
    upload(line, seg);
  }

  const use = (prog, t) => {
    const { w, h, dpr, accent } = opts;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
    for (const a of prog.layout) {
      gl.enableVertexAttribArray(a.at);
      gl.vertexAttribPointer(a.at, a.size, gl.FLOAT, false, prog.stride * 4, a.off * 4);
    }
    const L = prog.loc;
    gl.uniform1f(L.uT, t);
    gl.uniform1f(L.uAspect, w / h);
    gl.uniform1f(L.uF, F);
    gl.uniform3f(L.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(L.uDpr, dpr);
    gl.uniform3f(L.uAccent, accent[0] / 255, accent[1] / 255, accent[2] / 255);
    return L;
  };

  // t：秒；moving 为 false 时镜头停在原位，不跟鼠标
  function paint(t, moving) {
    if (lost || !opts) return;
    const { dark } = opts;
    if (moving) {
      cam.x += (aim.x * 0.12 - cam.x) * 0.06;
      cam.y += (aim.y * 0.08 - cam.y) * 0.06;
    }
    const m = moving ? 1 : 0;
    cam.z = m * 0.15 * Math.sin(t * 0.03);
    const keep = { x: cam.x, y: cam.y };
    cam.x += m * 0.05 * Math.sin(t * 0.05);
    cam.y += m * 0.035 * Math.sin(t * 0.07);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // 深色叠加发光；浅色底上叠加看不见，改普通混合
    if (dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (line.n) {
      const L = use(line, t);
      gl.uniform2f(L.uView, canvas.width, canvas.height);
      gl.uniform1f(L.uWidth, 0.9);
      gl.drawArrays(gl.TRIANGLES, 0, line.n);
    }
    if (point.n) {
      const L = use(point, t);
      gl.uniform1f(L.uPulse, opts.pulse ? 1 : 0);
      const s = dark ? [200, 215, 255] : [70, 80, 110];
      gl.uniform3f(L.uStar, s[0] / 255, s[1] / 255, s[2] / 255);
      gl.drawArrays(gl.POINTS, 0, point.n);
    }
    cam.x = keep.x;
    cam.y = keep.y;
  }

  function dispose() {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    window.removeEventListener('pointermove', onPointer);
  }

  return { build, paint, dispose };
}
