import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/src/index.js';
import { createUiHandler } from '../src/handler.js';

test('界面接口：令牌、新建、改卡与预览、画像、导入', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '界面 '));
  const core = createCore({ home, host: 'test' });
  let changes = 0;
  const server = createServer(createUiHandler(core, { prefix: '/x', token: 'tk', onChange: () => changes++ }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/x`;
  const call = async (method, route, body, headers = { 'x-chara-token': 'tk' }) => {
    const r = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    return { status: r.status, data: r.headers.get('content-type').startsWith('application/json') ? await r.json() : await r.text() };
  };
  try {
    const page = await call('GET', '/', undefined, {});
    // 页面要 npm run build 之后才有；没构建时给出提示而不是报错
    assert.ok(page.status === 200 ? /id="app"/.test(page.data) : page.status === 503 && /npm run build/.test(page.data), '页面本身不需要令牌');
    assert.equal((await call('GET', '/assets/..%2f..%2fsrc%2fhandler.js', undefined, {})).status, 403, '静态文件只认 assets 下的文件名');
    // 宿主外壳（DSH 侧栏面板）从这里取前缀与令牌：同源才读得到，所以不需要令牌就能拿
    const boot = await call('GET', '/boot.json', undefined, {});
    assert.equal(boot.status, 200, '启动信息不需要令牌');
    assert.deepEqual(boot.data, { prefix: '/x', token: 'tk' });
    // fetch 改不了 Host 头，用 http.request 模拟 DNS 重绑定
    const rebound = await new Promise((resolve, reject) =>
      request(`${base}/boot.json`, { headers: { host: 'evil.example:80' } }, (r) => (r.resume(), resolve(r.statusCode))).on('error', reject).end(),
    );
    assert.equal(rebound, 403, '外部域名的 Host 拿不到令牌');
    assert.equal((await call('GET', '/api/state', undefined, {})).status, 403);
    assert.equal((await call('GET', '/api/state?t=tk', undefined, {})).status, 200, '读接口可用查询参数令牌（头像 img 要用）');
    assert.equal((await call('POST', '/api/new?t=tk', { name: '小鲸' }, {})).status, 403, '写操作只认请求头');

    assert.equal((await call('POST', '/api/new', { name: '小鲸' })).status, 200);
    const [b] = (await call('GET', '/api/state')).data.beings;
    assert.equal(b.name, '小鲸');
    assert.equal(b.current, true);

    const long = '很'.repeat(2500);
    const p = (await call('POST', '/api/preview', { name: '小鲸', personality: long })).data;
    assert.equal(p.budget, 2000);
    assert.ok(p.cut.includes('personality'), '超预算时标出被截的字段');
    assert.ok([...p.nature].length <= 2000);

    assert.equal((await call('PUT', `/api/card?id=${b.id}`, { name: '大鲸', speech: '自称本鲸', lorebook: 'x' })).status, 200);
    const card = (await call('GET', `/api/card?id=${b.id}`)).data;
    assert.equal(card.name, '大鲸');
    assert.match(card.speech, /自称本鲸/);
    assert.equal((await call('GET', '/api/state')).data.beings[0].name, '大鲸', '改名同步到名册');
    assert.equal((await call('PUT', `/api/card?id=${b.id}`, { name: '' })).status, 400, '保存前校验');
    assert.equal((await call('GET', '/api/card?id=b-nope')).status, 400);

    assert.equal(b.avatar, 0);
    assert.equal((await call('PUT', `/api/avatar?id=${b.id}`, 'not an image')).status, 400, '只收图片');
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    assert.equal((await call('PUT', `/api/avatar?id=${b.id}`, jpg)).status, 200);
    const av = await fetch(`${base}/api/avatar?id=${b.id}&t=tk`);
    assert.equal(av.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await av.arrayBuffer()), jpg);
    assert.ok((await call('GET', '/api/state')).data.beings[0].avatar > 0);

    assert.equal((await call('PUT', '/api/profile', { call_me: '老板', evil: 'x' })).status, 200);
    assert.deepEqual((await call('GET', '/api/profile')).data, { call_me: '老板' });

    const json = JSON.stringify({ spec: 'chara_card_v2', data: { name: '天音', description: '温柔', first_mes: '你好' } });
    assert.equal((await call('POST', '/api/import?name=a.json', json)).status, 200);
    assert.equal((await call('POST', '/api/import?name=a.exe', 'x')).status, 400);
    const st = (await call('GET', '/api/state')).data;
    assert.deepEqual(st.beings.map((x) => x.name).sort(), ['大鲸', '天音']);
    const tian = st.beings.find((x) => x.name === '天音');
    assert.equal(tian.first_mes.trim(), '你好');
    assert.equal((await call('POST', '/api/use', { id: tian.id })).status, 200);
    assert.match((await call('GET', '/api/state')).data.show, /天音/);
    assert.ok(changes >= 5);
  } finally {
    server.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});
