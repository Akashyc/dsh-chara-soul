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
  const server = createServer(createUiHandler(core, { prefix: '/x', token: 'tk', onChange: () => changes++, pickFolder: async () => 'D:/选好的' }));
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
    assert.equal((await call('GET', '/api/state')).data.beings[0].portrait, 0, '形象图和头像分开存');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
    assert.equal((await call('PUT', `/api/portrait?id=${b.id}`, png)).status, 200);
    const pt = await fetch(`${base}/api/portrait?id=${b.id}&t=tk`);
    assert.equal(pt.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/api/avatar?id=${b.id}&t=tk`)).headers.get('content-type'), 'image/jpeg', '头像没被覆盖');

    assert.equal((await call('GET', '/api/user-avatar')).status, 404, '还没有用户头像');
    assert.equal((await call('PUT', '/api/user-avatar', 'not an image')).status, 400);
    assert.equal((await call('PUT', '/api/user-avatar', jpg)).status, 200);
    assert.equal((await call('PUT', '/api/user-avatar', png)).status, 200, '换格式时删掉旧的');
    assert.equal((await fetch(`${base}/api/user-avatar?t=tk`)).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/api/avatar?id=${b.id}&t=tk`)).headers.get('content-type'), 'image/jpeg', '个体头像没被覆盖');

    assert.equal((await call('PUT', '/api/profile', { call_me: '老板', evil: 'x' })).status, 200);
    assert.deepEqual((await call('GET', '/api/profile')).data, { call_me: '老板' });

    const before = (await call('POST', '/api/preview', { name: '小鲸', personality: '温柔' })).data;
    assert.equal((await call('PUT', '/api/global', { text: '不要用 Markdown' })).status, 200);
    assert.equal((await call('GET', '/api/global')).data.text, '不要用 Markdown');
    const after = (await call('POST', '/api/preview', { name: '小鲸', personality: '温柔' })).data;
    assert.ok(after.nature.indexOf('温柔') < after.nature.indexOf('【全局要求】\n不要用 Markdown') && after.nature.indexOf('不要用 Markdown') < after.nature.indexOf('你的底线'), '人设 → 全局 → 底线');
    assert.equal(after.length, before.length, '全局提示词不占预算');

    const json = JSON.stringify({ spec: 'chara_card_v2', data: { name: '天音', description: '温柔', first_mes: '你好' } });
    assert.equal((await call('POST', '/api/import?name=a.json', json)).status, 200);
    assert.equal((await call('POST', '/api/import?name=a.exe', 'x')).status, 400);
    const st = (await call('GET', '/api/state')).data;
    assert.deepEqual(st.beings.map((x) => x.name).sort(), ['大鲸', '天音']);
    const tian = st.beings.find((x) => x.name === '天音');
    assert.equal(tian.first_mes.trim(), '你好');
    assert.equal((await call('POST', '/api/use', { id: tian.id })).status, 200);
    assert.match((await call('GET', '/api/state')).data.show, /天音/);

    // 迁移：打包参数只认全部、画像和 id；导入 .soul 有冲突时先列出来，选了再导
    const out = path.join(home, '打包 输出');
    assert.equal((await call('POST', '/api/migrate', { target: '../x', dir: out })).status, 400);
    assert.equal((await call('POST', '/api/migrate', { target: tian.id, dir: 'relative' })).status, 400, '目录要绝对路径');
    const packed = await call('POST', '/api/migrate', { target: tian.id, dir: out });
    assert.equal(packed.status, 200, packed.data.error);
    const soul = readFileSync(packed.data.text.match(/打包到 (.+\.soul)/)[1]);
    assert.equal((await call('POST', '/api/import?name=a.soul', soul)).data.conflicts, undefined, '已迁出的迁回');
    assert.deepEqual((await call('POST', '/api/import?name=a.soul', soul)).data.conflicts, ['「天音」']);
    assert.match((await call('POST', `/api/import?name=a.soul&conflict=${encodeURIComponent('跳过')}`, soul)).data.text, /跳过「天音」/);
    assert.ok(changes >= 5);

    // 记忆：看、加、改、常驻、删；写操作只认请求头
    const mem = (q = '') => `/api/memories?id=${tian.id}${q}`;
    assert.deepEqual((await call('GET', mem())).data.items, []);
    assert.equal((await call('POST', mem() + '&t=tk', { text: 'x' }, {})).status, 403);
    const { id: mid } = (await call('POST', mem(), { kind: 'preference', text: '喜欢深夜聊天' })).data;
    assert.equal((await call('POST', mem(), { text: '' })).status, 400, '空内容不收');
    assert.equal((await call('PUT', mem(`&mid=${mid}`), { text: '喜欢凌晨聊天', pinned: true })).status, 200);
    const [m] = (await call('GET', mem())).data.items;
    assert.deepEqual([m.text, m.kind, m.pinned, m.vividness, m.origin], ['喜欢凌晨聊天', 'preference', true, 1, 'user']);
    assert.equal((await call('PUT', mem('&mid=999'), { text: 'x' })).status, 400);
    assert.equal((await call('DELETE', mem(`&mid=${mid}`))).status, 200);
    assert.deepEqual((await call('GET', mem())).data.items, []);
    // 日记：看、删（写要调模型，只在 DSH 里用 /chara dream）
    assert.deepEqual((await call('GET', `/api/diaries?id=${tian.id}`)).data, []);
    assert.match((await call('POST', `/api/diaries?id=${tian.id}&day=2026-11-07`)).data.error, /只能在 DSH 里/, '独立运行时没有模型可调');
    assert.equal((await call('DELETE', `/api/diaries?id=${tian.id}&day=2026-11-07&t=tk`, undefined, {})).status, 403, '删日记只认请求头');
    assert.equal((await call('DELETE', `/api/diaries?id=${tian.id}&day=2026-11-07`)).status, 200);

    const s = (await call('GET', '/api/settings')).data;
    assert.equal(s.envoyPreset, 'chara-soul-envoy');
    assert.equal(s.presets, null, '宿主列不出预设时，设置页不显示分身预设');
    assert.equal(s.home.source, 'env', '没有指向文件的核心不能换目录');
    assert.equal((await call('PUT', '/api/settings', { envoyPreset: 'ptc' })).status, 200);
    assert.equal((await call('GET', '/api/settings')).data.envoyPreset, 'ptc');
    assert.equal((await call('PUT', '/api/settings', { envoyPreset: '../x' })).status, 400);
    assert.match((await call('POST', '/api/home', { to: path.join(home, '..', '别处') })).data.error, /环境变量/);
    assert.equal((await call('DELETE', '/api/home')).status, 400);
    assert.equal((await call('POST', '/api/pick-folder?t=tk', undefined, {})).status, 403, '弹对话框也只认请求头');
    assert.deepEqual((await call('POST', '/api/pick-folder')).data, { path: 'D:/选好的' });
  } finally {
    server.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});
