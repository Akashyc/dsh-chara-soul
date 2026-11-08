// 界面的请求处理器：Node 原生 (req, res)，既能挂在 DSH 的 webServer 上，也能由 cli 自己起服务。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 页面由 Vite 构建到 dist/（npm run build）；静态文件不含数据，不需要令牌
const DIST = new URL('../dist/', import.meta.url);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 20 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('文件太大（上限 20 MB）'));
      else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/**
 * core：createCore() 的返回值；prefix：挂载路径（DSH 里是 /x-chara-soul，独立运行时为空）；
 * token：访问令牌；onChange：新建、切换、导入、改卡之后调用（DSH 适配器用它重新登记注入段）。
 * presets：列出宿主已注册预设的函数（DSH 适配器提供），没有时设置页退回文本框。
 */
export function createUiHandler(core, { prefix = '', token, onChange = () => {}, presets = async () => null }) {
  if (!token) throw new Error('界面需要访问令牌');
  return async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.statusCode = code;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const route = url.pathname.slice(prefix.length) || '/';
      const q = (k) => url.searchParams.get(k) ?? '';
      const json = async () => JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const done = (r) => (onChange(), send(r.ok ? 200 : 400, r.ok ? r : { error: r.text }));
      const is = (method, p) => req.method === method && route === p;
      // 防 DNS 重绑定：外部网页把自己的域名解析到本机后算「同源」，能读 boot.json 拿令牌；它发来的 Host 是自己的域名
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) return send(403, { error: '只接受本机地址访问' });

      if (req.method === 'GET' && (route === '/' || /^\/assets\/[\w.-]+$/.test(route))) {
        const f = new URL(route === '/' ? 'index.html' : route.slice(1), DIST);
        if (!existsSync(f)) return send(route === '/' ? 503 : 404, route === '/' ? '界面还没构建：在项目根目录运行 npm run build' : '没有这个文件', 'text/plain; charset=utf-8');
        return send(200, readFileSync(f), TYPES[path.extname(f.pathname)] ?? 'application/octet-stream');
      }
      // 客户端插件（DSH 侧栏面板，也适用于别的宿主外壳）从这里拿挂载点与令牌：
      // 跨源读会被浏览器拦，DNS 重绑定由上面的 Host 检查挡住；本机程序能读到，但它们本来就能直接读数据目录
      if (is('GET', '/boot.json')) return send(200, { prefix: prefix || '', token });
      // 页面本身不含数据，接口一律要令牌。写操作只认请求头：别的网页能骗浏览器发表单，却加不了自定义请求头
      const headerOk = req.headers['x-chara-token'] === token;
      if (!headerOk && !(req.method === 'GET' && q('t') === token)) return send(403, { error: '令牌不对，请从 /chara ui 给出的链接打开' });

      if (is('GET', '/api/state')) return send(200, { beings: core.view.beings(), show: core.command('show').text });
      const image = /^\/api\/(avatar|portrait)$/.exec(route)?.[1]; // 头像、形象图
      if (image && req.method === 'GET') {
        const f = core.view.imageFile(q('id'), image);
        return f ? send(200, readFileSync(f), { '.jpg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(f)] ?? 'image/png') : send(404, { error: '没有图片' });
      }
      if (is('GET', '/api/card')) return send(200, core.view.card(q('id')));
      if (is('GET', '/api/profile')) return send(200, core.view.profile());
      if (is('GET', '/api/settings')) return send(200, { ...core.view.settings(), presets: await presets().catch(() => null), home: core.homeInfo() });
      if (!headerOk) return send(403, { error: '写操作需要请求头令牌' });

      if (is('POST', '/api/preview')) return send(200, core.view.preview(await json()));
      if (is('PUT', '/api/card')) return core.view.saveCard(q('id'), await json()), onChange(), send(200, { ok: true });
      if (image && req.method === 'PUT') return core.view.saveImage(q('id'), image, await readBody(req)), send(200, { ok: true });
      if (is('PUT', '/api/profile')) return core.view.saveProfile(await json()), onChange(), send(200, { ok: true });
      if (is('PUT', '/api/settings')) return core.view.saveSettings(await json()), send(200, { ok: true });
      // 换数据目录之后本性要从新位置读，所以也调 onChange
      if (is('POST', '/api/home')) return send(200, core.moveHome((await json()).to)), onChange();
      if (is('DELETE', '/api/home')) return core.removeOldHome(), send(200, { ok: true });
      if (is('POST', '/api/new')) return done(core.command(`new ${String((await json()).name ?? '').trim()}`));
      if (is('POST', '/api/use')) return done(core.command(`use ${String((await json()).id ?? '').trim()}`));
      if (is('POST', '/api/import')) {
        const name = path.basename(q('name'));
        if (!/\.(png|json|ya?ml)$/i.test(name)) return send(400, { error: '只支持 PNG、JSON、YAML 角色卡' });
        const dir = mkdtempSync(path.join(tmpdir(), 'chara-import-'));
        try {
          const file = path.join(dir, name);
          writeFileSync(file, await readBody(req));
          return done(core.command(`import "${file}"`));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      return send(404, { error: '没有这个接口' });
    } catch (e) {
      return send(400, { error: e?.message ?? String(e) });
    }
  };
}
