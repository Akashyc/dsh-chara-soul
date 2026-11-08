// 核心入口：不依赖任何宿主。适配器与 cli 都只通过这里访问（架构方案第四节）。
import path from 'node:path';
import { statSync, existsSync, readFileSync, copyFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import YAML from 'yaml';
import { dataHome, ensureHome, pointerFile, readPointer, writePointer, syncFolderWarning, copyHome, isEmptyTarget, homeEntries } from './store/index.js';
import { openRoster } from './roster/index.js';
import { readCard, readYaml, writeText, validateCard, cardText, cardTemplate, profileTemplate, field } from './card/index.js';
import { readTavernJson, fromTavern } from './card/tavern.js';
import { buildNature, buildBrief } from './nature/index.js';
import { floor5, zone, timeLines, daysBetween, relative } from './chrono/index.js';
import { openLife } from './memory/life.js';

const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);
const CARD_FIELDS = ['name', 'appearance', 'personality', 'speech', 'relationship', 'first_mes', 'mes_example'];
const PROFILE_FIELDS = ['name', 'call_me', 'appearance', 'traits', 'likes', 'taboos'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] === 'string').map((k) => [k, o[k]]));

/**
 * home：数据目录；now：时钟（测试可注入）；host：写进原话的来源宿主名。
 * pointer：指向文件路径，换数据目录时写它；为 null 时不能换（环境变量指定了目录，或测试里没给）。
 * 不传 home 时按「环境变量 → 指向文件 → 默认位置」找目录，指向文件用默认位置下的那份。
 */
export function createCore({ home, now = Date.now, host = 'unknown', pointer = null } = {}) {
  if (home === undefined) {
    home = ensureHome(dataHome());
    pointer = process.env.CHARA_SOUL_HOME ? null : pointerFile();
  }
  let roster = openRoster(home, now);
  const beingDir = (id) => path.join(home, 'beings', id);
  const cardFile = (id) => path.join(beingDir(id), 'card.yaml');
  // 头像（avatar）和形象图（portrait）都存成 <kind>.png/jpg/webp，没有时退回导入时留下的 source.png
  const IMAGE_KINDS = ['avatar', 'portrait'];
  const imageNames = (kind) => ['png', 'jpg', 'webp'].map((ext) => `${kind}.${ext}`);
  const imageOf = (id, kind) => [...imageNames(kind), 'source.png'].map((f) => path.join(beingDir(id), f)).find((f) => existsSync(f)) ?? null;
  const imageKind = (kind) => {
    if (!IMAGE_KINDS.includes(kind)) throw new Error(`没有这种图片：${kind}`);
    return kind;
  };
  const profileFile = () => path.join(home, 'profiles', `${roster.getState('profile') ?? 'default'}.yaml`);
  const open = new Map(); // id → { life, nature, stamp, error }
  // 用户手动删掉个体文件夹时，名册行还在：只认角色卡还在的，也不替它重建文件夹（004 号决定：名册行不删）
  const alive = (id) => existsSync(cardFile(id));
  const rows = () => roster.list().filter((r) => alive(r.id));

  function being(id) {
    if (!open.has(id)) open.set(id, { life: openLife(beingDir(id)), nature: '', stamp: '', error: null });
    const b = open.get(id);
    // 角色卡或画像改过就重建本性；改坏了保留上一版并记下错误，不让整轮失败
    const stamp = `${mtime(cardFile(id))}|${mtime(profileFile())}`;
    if (stamp !== b.stamp) {
      b.stamp = stamp;
      try {
        const card = readCard(cardFile(id));
        if (card.name !== roster.get(id).name) roster.rename(id, card.name);
        b.nature = buildNature(card, readYaml(profileFile()));
        b.error = null;
      } catch (e) {
        b.error = e.message;
      }
    }
    return b;
  }

  const current = () => {
    const row = roster.current();
    return row && alive(row.id) ? { row, ...being(row.id) } : null;
  };

  /** 本性：没有个体时为空串，什么都不注入。 */
  const nature = () => current()?.nature ?? '';

  /** 此刻：每轮可变，走运行时上下文。wake 为真时视为醒来：第一次醒来记下出生时刻；show 只看不唤醒。 */
  function moment(wake = true) {
    const c = current();
    if (!c) return '';
    const t = floor5(now());
    if (wake && c.life.meta('born_at') == null) c.life.setMeta('born_at', t);
    const lines = timeLines({ now: t, born: c.life.meta('born_at'), prev: c.life.meta('prev_user_at'), last: c.life.meta('last_user_at'), tz: zone(c.life.meta('tz')) });
    return lines.join('\n');
  }

  /** 每条原话结束后调用。role：user | assistant；tz：用户时区（可空）。 */
  function afterTurn({ session, role, text, at = now(), tz }) {
    const c = current();
    if (!c || !text?.trim()) return;
    c.life.appendTurn({ session, role, text, at, host });
    if (role !== 'user') return;
    c.life.setMeta('prev_user_at', c.life.meta('last_user_at'));
    c.life.setMeta('last_user_at', at);
    if (tz) c.life.setMeta('tz', tz);
  }

  /**
   * 回想：按关键词翻当前个体的原话。shortcut: 只搜原话、不提取记忆点，M3 记忆点上线后改为先查记忆点。
   * @param query 关键词，不足三个字时退化为逐行匹配
   * @returns 每条一行「时间 谁：原话」，太长的截断；没有个体或没找到时给出说明
   */
  function recall(query) {
    const c = current();
    if (!c) return '还没有个体，没有可回想的。';
    const q = String(query ?? '').trim();
    if (!q) return '要回想什么？给一个关键词。';
    const tz = zone(c.life.meta('tz'));
    const when = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const rows = c.life.searchTurns(q);
    if (!rows.length) return `原话里没有找到「${q}」。`;
    const cut = (t) => ([...t].length > 200 ? `${[...t].slice(0, 200).join('')}…` : t);
    return rows.map((r) => `${when.format(r.at)} ${r.role === 'user' ? '用户' : '你'}：${cut(r.text.replace(/\s+/g, ' '))}`).join('\n');
  }

  /** 分身的简报。没有个体或没有任务时返回空串。 */
  function envoyBrief(args = {}) {
    const row = current()?.row;
    return row && args.task?.trim() ? buildBrief(row.name, args) : '';
  }

  /** 分身完成后的汇报，记在当前个体名下。返回出处，没有个体时返回 null。 */
  function envoyReport({ id, session, task, report, at = now() }) {
    const c = current();
    if (!c) return null;
    c.life.appendEnvoy({ id, session, task, report, at, host });
    return `src:envoy/${id}`;
  }

  const ok = (text) => ({ ok: true, text });
  const fail = (text) => ({ ok: false, text });

  const commands = {
    new(name) {
      if (!name) return fail('用法：new <名字>');
      const row = roster.add(name);
      writeText(cardFile(row.id), cardTemplate(name));
      roster.setCurrent(row.id);
      return ok(`已创建个体「${name}」（${row.id}）并切换过去。\n角色卡在 ${cardFile(row.id)}，编辑保存后下一轮生效。`);
    },
    /** 导入一张写好的卡：校验后建个体并切换过去，原文件不动。本项目的 YAML 注释原样保留；SillyTavern 的 JSON / PNG 先转换。 */
    import(arg) {
      const file = arg.replace(/^["']|["']$/g, '');
      if (!file) return fail('用法：import <角色卡文件路径>');
      const ext = path.extname(file).toLowerCase();
      if (ext === '.json' || ext === '.png') {
        const t = fromTavern(readTavernJson(path.resolve(file)));
        const title = t.title && t.title !== t.name ? `（卡片标题「${t.title}」）` : '';
        const text = cardText(t, `# 由 SillyTavern 角色卡「${path.basename(file)}」${title}转换，原文件存为同目录的 source${ext}。酒馆卡没有口吻字段，建议补上 speech。`);
        validateCard(YAML.parse(text)); // 写入名册前先确认转出来的卡能读
        const row = roster.add(t.name);
        writeText(cardFile(row.id), text);
        copyFileSync(path.resolve(file), path.join(beingDir(row.id), `source${ext}`));
        roster.setCurrent(row.id);
        const nature = buildNature(t);
        const notes = [
          !nature.includes(t.personality) && `性格设定有 ${[...t.personality].length} 字，超出本性预算，后半部分会被截掉；建议精简 card.yaml 里的 personality。`,
          t.lorebook.length && `世界书 ${t.lorebook.length} 条已存进 lorebook，记忆功能上线后成为初始记忆。`,
          t.dropped.length && `没有导入 ${t.dropped.join('、')}：那是给模型的指令，可能和底线冲突。`,
        ].filter(Boolean);
        return ok([`已导入酒馆角色卡「${t.name}」（${row.id}）并切换过去，下一轮生效。`, `转换后的角色卡在 ${cardFile(row.id)}，建议补上口吻（speech）。`, ...notes].join('\n'));
      }
      if (!/\.ya?ml$/i.test(file)) return fail('只支持本项目的 YAML 角色卡，以及 SillyTavern 的 JSON / PNG 角色卡。');
      const card = readCard(path.resolve(file));
      const row = roster.add(card.name);
      writeText(cardFile(row.id), readFileSync(path.resolve(file), 'utf8').replace(/^﻿/, ''));
      roster.setCurrent(row.id);
      return ok(`已导入个体「${card.name}」（${row.id}）并切换过去，下一轮生效。\n角色卡已复制到 ${cardFile(row.id)}，之后改那一份。`);
    },
    list() {
      const cur = roster.current()?.id;
      const list = rows();
      return ok(list.length ? list.map((r) => `${r.id === cur ? '▶' : ' '} ${r.name}（${r.id}）`).join('\n') : '还没有个体，用 new <名字> 创建。');
    },
    use(key) {
      if (!key) return fail('用法：use <名字或 id>');
      const row = roster.find(key, (r) => alive(r.id));
      if (!row) return fail(`没有叫「${key}」的个体。`);
      roster.setCurrent(row.id);
      return ok(`已切换到「${row.name}」，下一轮生效。`);
    },
    show() {
      const c = current();
      if (!c) return ok('还没有个体，本轮不注入任何内容。');
      return ok([`【本性】\n${c.nature}`, `【此刻】\n${moment(false)}`, c.error ? `⚠ 角色卡读取出错，仍在用上一版：${c.error}` : ''].filter(Boolean).join('\n\n'));
    },
    reminisce: (q) => ok(recall(q)),
    profile() {
      const f = profileFile();
      if (!existsSync(f)) writeText(f, profileTemplate());
      return ok(`用户画像在 ${f}，编辑保存后下一轮生效。`);
    },
    help: () => ok('子命令：new <名字> | import <角色卡路径> | list | use <名字或 id> | show | reminisce <关键词> | profile'),
  };

  /** 用户命令。raw 是子命令及参数的原文，如 "use 蒂普茜柯"。 */
  function command(raw = '') {
    // 子命令之后的文字原样交给子命令，路径里的空格不被改动
    const [, sub, arg] = raw.trim().match(/^(\S*)\s*([\s\S]*)$/);
    if (!sub) return commands.help();
    const h = Object.hasOwn(commands, sub) ? commands[sub] : null;
    if (!h) return fail(`未知子命令 ${sub}。${commands.help().text}`);
    try {
      return h(arg.trim());
    } catch (e) {
      return fail(`${sub} 出错：${e.message}`);
    }
  }

  const known = (id) => {
    if (!roster.get(id) || !alive(id)) throw new Error(`没有这个个体：${id}`);
    return id;
  };

  /** 界面（packages/ui）用的读写：只碰角色卡、画像与个体状态，切换与导入仍走 command。 */
  const view = {
    beings() {
      const cur = roster.current()?.id;
      return rows().map((r) => {
        const b = being(r.id);
        let card = {};
        try {
          card = readCard(cardFile(r.id));
        } catch {}
        const born = b.life.meta('born_at');
        const last = b.life.meta('last_user_at');
        return {
          id: r.id,
          name: r.name,
          current: r.id === cur,
          bornDays: born == null ? null : daysBetween(born, now(), zone(b.life.meta('tz'))),
          lastSeen: last == null ? null : relative(now() - last),
          first_mes: card.first_mes ?? '',
          lorebook: Array.isArray(card.lorebook) ? card.lorebook.length : 0,
          avatar: imageOf(r.id, 'avatar') ? statSync(imageOf(r.id, 'avatar')).mtimeMs : 0, // 修改时间，页面拿来刷新缓存
          portrait: imageOf(r.id, 'portrait') ? statSync(imageOf(r.id, 'portrait')).mtimeMs : 0,
          error: b.error,
        };
      });
    },
    card: (id) => readCard(cardFile(known(id))),
    /** 只改表单里的字段，lorebook 等其余字段原样保留；按标准模板重写，用户自己加的注释会丢。 */
    saveCard(id, fields) {
      const card = validateCard({ ...readCard(cardFile(known(id))), ...pick(fields, CARD_FIELDS) });
      writeText(cardFile(id), cardText(card));
      if (card.name !== roster.get(id).name) roster.rename(id, card.name);
    },
    /** 未保存的表单拼出来的本性，以及哪些字段被预算截掉。 */
    preview(fields) {
      const card = pick(fields, CARD_FIELDS);
      const text = buildNature({ ...card, name: card.name?.trim() || '（未命名）' }, readYaml(profileFile()));
      const cut = ['personality', 'speech', 'appearance'].filter((k) => card[k]?.trim() && !text.includes(card[k].trim()));
      return { nature: text, length: [...text].length, budget: 2000, cut };
    },
    profile: () => readYaml(profileFile()) ?? {},
    saveProfile(fields) {
      writeText(profileFile(), `# 用户画像：所有个体共享，写你希望它们知道的自己

${YAML.stringify(pick(fields, PROFILE_FIELDS), { lineWidth: 0 })}`);
    },
    /** 设置（005 号决定）：envoyPreset 是本体在「角色灵魂」预设下时，派分身用的全量预设。 */
    settings: () => ({ envoyPreset: roster.getState('envoy_preset') ?? 'standard' }),
    saveSettings({ envoyPreset } = {}) {
      const id = String(envoyPreset ?? '').trim();
      if (!/^[\w.-]+$/.test(id)) throw new Error('预设 id 只能是字母、数字、点、横线、下划线');
      roster.setState('envoy_preset', id);
    },
    imageFile: (id, kind) => imageOf(known(id), imageKind(kind)),
    /** 换头像或形象图：认文件头，只收 PNG、JPG、WebP；导入时留下的 source.png 不动 */
    saveImage(id, kind, buf) {
      const ext = buf.subarray(0, 4).toString('hex') === '89504e47' ? 'png' : buf.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
      if (!ext) throw new Error('只支持 PNG、JPG、WebP 图片');
      for (const f of imageNames(imageKind(kind))) rmSync(path.join(beingDir(known(id)), f), { force: true });
      writeFileSync(path.join(beingDir(id), `${kind}.${ext}`), buf);
    },
  };

  /** 关掉所有库；先做检查点，把 WAL 里的写入并回主文件，复制主文件就是完整数据。 */
  function close() {
    for (const b of open.values()) {
      b.life.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      b.life.close();
    }
    open.clear();
    roster.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    roster.close();
  }

  const same = (a, b) => path.relative(a, b) === '';
  const inside = (child, parent) => {
    const r = path.relative(parent, child);
    return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
  };

  /** 数据目录的现状，给设置页：在哪、由谁决定、旧目录还在不在、在不在网盘里。 */
  function homeInfo() {
    const previous = pointer ? readPointer(pointer)?.previous : null;
    return {
      home,
      source: !pointer ? 'env' : readPointer(pointer) ? 'pointer' : 'default',
      previous: previous && !same(previous, home) && existsSync(path.join(previous, 'roster.db')) ? previous : null,
      warning: syncFolderWarning(home),
    };
  }

  /**
   * 把数据目录搬到 to（005 号决定第 6 条）：关库 → 复制 → 核对 → 改指向文件 → 在新位置重新打开。
   * 任何一步失败都在旧位置重新打开并抛错，旧目录原样不动；旧目录不自动删。
   * @param to 新目录，必须为空或不存在，不能和旧目录互相包含
   * @returns 新的数据目录现状；warning 非空表示新目录在网盘同步文件夹里
   */
  function moveHome(to) {
    if (!pointer) throw new Error('数据目录由环境变量 CHARA_SOUL_HOME 指定，不能在这里改');
    const raw = String(to ?? '').trim();
    if (!raw || !path.isAbsolute(raw)) throw new Error('请填写完整的目录路径，如 D:\\灵魂');
    const dest = path.resolve(raw);
    if (same(dest, home)) throw new Error('已经是这个目录');
    if (inside(dest, home) || inside(home, dest)) throw new Error('新目录不能在旧目录里面，也不能包含旧目录');
    if (!isEmptyTarget(dest)) throw new Error(`目标目录 ${dest} 里已有东西；不合并数据，请选一个空目录`);

    const from = home;
    close();
    try {
      // 别的程序（npx chara ui、另一个 DSH）还开着库时，Windows 上改名会失败，借此拒绝迁移
      // shortcut: macOS / Linux 上改名不受打开的文件影响，查不出来；要可靠就得加锁文件
      const db = path.join(from, 'roster.db');
      renameSync(db, `${db}.moving`);
      renameSync(`${db}.moving`, db);
    } catch (e) {
      roster = openRoster(home, now);
      throw new Error(`数据库被别的程序占着（可能是 npx chara ui 或另一个 DSH），关掉后再迁移（${e.code ?? e.message}）`);
    }
    try {
      copyHome(from, dest);
    } catch (e) {
      roster = openRoster(home, now);
      throw new Error(`迁移失败，旧目录没动：${e.message}`);
    }
    writePointer(pointer, { home: dest, previous: from });
    home = dest;
    roster = openRoster(home, now);
    return homeInfo();
  }

  /** 删掉迁移后留下的旧目录里的数据（只删搬走过的那些项，旧目录里别的东西和指向文件不碰）。 */
  function removeOldHome() {
    const info = homeInfo();
    if (!info.previous) throw new Error('没有可删的旧目录');
    const moved = new Set(homeEntries(home));
    for (const n of homeEntries(info.previous)) if (moved.has(n) || /^roster\.db-(wal|shm)$/.test(n)) rmSync(path.join(info.previous, n), { recursive: true, force: true });
    if (!readdirSync(info.previous).length) rmSync(info.previous, { recursive: true, force: true });
    writePointer(pointer, { home });
  }

  /**
   * 关系原来写在画像里、所有个体共用；现在每个个体在角色卡里各写一份。
   * 旧画像里的关系搬给当前个体（它的卡里还没写时），再从画像里去掉。只改卡里这一项，不动用户的注释：
   * 新模板里有空的 `relationship: |` 就填进去，旧卡里没有这一项就追加在末尾。
   */
  function moveLegacyRelationship() {
    const profile = readYaml(profileFile());
    const legacy = typeof profile?.relationship === 'string' ? profile.relationship.trim() : '';
    const cur = roster.current();
    if (!legacy || !cur || !alive(cur.id)) return;
    const file = cardFile(cur.id);
    const card = readCard(file);
    if (!card.relationship?.trim?.()) {
      const text = readFileSync(file, 'utf8');
      const empty = /^relationship:[ \t]*\|?[ \t]*$/m;
      if (empty.test(text)) writeFileSync(file, text.replace(empty, field('relationship', legacy)));
      else if (!('relationship' in card)) appendFileSync(file, `\n# 和用户的关系（从用户画像搬过来的）\n${field('relationship', legacy)}\n`);
      else return; // 写法特殊（如 relationship: ""），不冒险改，留在画像里
    }
    view.saveProfile(profile);
  }

  try {
    moveLegacyRelationship();
  } catch {} // 卡或画像读不了时不搬，不影响启动；本性那边会报出具体错误

  return {
    nature, moment, afterTurn, recall, envoyBrief, envoyReport, command, view, close, homeInfo, moveHome, removeOldHome,
    get home() {
      return home;
    },
  };
}
