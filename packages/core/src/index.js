// 核心入口：不依赖任何宿主。适配器与 cli 都只通过这里访问（架构方案第四节）。
import path from 'node:path';
import { statSync, existsSync, readFileSync, copyFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import YAML from 'yaml';
import { dataHome, ensureHome, pointerFile, readPointer, writePointer, syncFolderWarning, copyHome, isEmptyTarget, homeEntries } from './store/index.js';
import { openRoster } from './roster/index.js';
import { readCard, readYaml, writeText, validateCard, cardText, cardTemplate, profileTemplate, field } from './card/index.js';
import { readTavernJson, fromTavern } from './card/tavern.js';
import { buildNature, buildBrief } from './nature/index.js';
import { floor5, zone, timeLines, daysBetween, relative } from './chrono/index.js';
import { openLife } from './memory/life.js';
import { KINDS, vividness, memoryText, kindOf, explicitRemember, memoryLine, memoryLines, endOfDay } from './memory/points.js';

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
  const globalFile = () => path.join(home, 'global.md'); // 全局提示词，所有个体共用，不随画像切换
  const readGlobal = () => (existsSync(globalFile()) ? readFileSync(globalFile(), 'utf8') : '');
  const userAvatars = () => imageNames(profileFile().replace(/\.yaml$/, '.avatar')); // 用户头像跟画像放一起：profiles/<画像>.avatar.png
  // 认文件头，只收 PNG、JPG、WebP
  const imageExt = (buf) => {
    const ext = buf.subarray(0, 4).toString('hex') === '89504e47' ? 'png' : buf.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
    if (!ext) throw new Error('只支持 PNG、JPG、WebP 图片');
    return ext;
  };
  const open = new Map(); // id → { life, nature, stamp, error }
  // 用户手动删掉个体文件夹时，名册行还在：只认角色卡还在的，也不替它重建文件夹（004 号决定：名册行不删）
  const alive = (id) => existsSync(cardFile(id));
  const rows = () => roster.list().filter((r) => alive(r.id));

  function being(id) {
    if (!open.has(id)) open.set(id, { life: openLife(beingDir(id)), nature: '', stamp: '', error: null });
    const b = open.get(id);
    // 角色卡或画像改过就重建本性；改坏了保留上一版并记下错误，不让整轮失败
    const stamp = `${mtime(cardFile(id))}|${mtime(profileFile())}|${mtime(globalFile())}`;
    if (stamp !== b.stamp) {
      b.stamp = stamp;
      try {
        const card = readCard(cardFile(id));
        if (card.name !== roster.get(id).name) roster.rename(id, card.name);
        b.nature = buildNature(card, readYaml(profileFile()), 2000, readGlobal());
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
    const tz = zone(c.life.meta('tz'));
    const lines = timeLines({ now: t, born: c.life.meta('born_at'), prev: c.life.meta('prev_user_at'), last: c.life.meta('last_user_at'), tz });
    const mem = memoryLines(c.life.memories(), t, tz);
    if (mem.length) lines.push('', '记得的事（#编号是 chara_remember 取代旧记忆时用的；更早、淡了的用 chara_recall 找）：', ...mem);
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
    // 窄规则：用户明说「记住……」时一定记下，补个体漏记；同样的内容已经记着就不重复
    const body = explicitRemember(text);
    if (body && !c.life.memories().some((m) => m.replaced_by == null && m.text === body)) c.life.addMemory({ kind: 'fact', text: body, origin: 'rule', session, at });
  }

  /**
   * 个体自己记一条（chara_remember 工具）。
   * @param content 要记的内容，200 字以内
   * @param kind 类型，见 KINDS；认不出时当事实
   * @param replaces 被这条取代的旧记忆编号（改口时用）
   * @param due 约定的到期日 YYYY-MM-DD
   * @param who 说这话的人：用户本人留空，QQ 群友写昵称
   * @returns 给模型看的结果
   */
  function remember({ content, kind, replaces, due, who, session = null } = {}) {
    const c = current();
    if (!c) return '还没有个体，没有记下。';
    const text = memoryText(content);
    const hasOld = replaces != null && String(replaces).trim() !== '';
    const old = hasOld ? c.life.memory(Number(String(replaces).trim().replace(/^#/, ''))) : null;
    if (hasOld && (!old || old.replaced_by != null)) return `没有找到还有效的记忆 #${replaces}，没有记下。不是改口就不要填 replaces。`;
    let dueAt = null;
    if (due && String(due).trim()) {
      dueAt = endOfDay(due, zone(c.life.meta('tz')));
      if (Number.isNaN(dueAt)) return `到期日要写成 YYYY-MM-DD，收到的是「${due}」，没有记下。`;
    }
    const dup = c.life.memories().find((m) => m.replaced_by == null && m.text === text);
    if (dup && !old) return `#${dup.id} 已经记着这件事了。`;
    const id = c.life.addMemory({ kind: kindOf(kind), text, speaker: String(who ?? '').trim() || '用户', due: dueAt, origin: 'model', session, at: now() });
    if (old) c.life.updateMemory(old.id, { replaced_by: id });
    return `已记住 #${id}${old ? `，取代了 #${old.id}` : ''}。`;
  }

  /**
   * 回想：先查记忆点（被取代的也列出来，注明后来被哪条取代），再按关键词翻原话；查到的记忆点鲜明度回升。
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
    const mems = c.life.searchMemories(q);
    const rows = c.life.searchTurns(q);
    if (!mems.length && !rows.length) return `记忆和原话里都没有找到「${q}」。`;
    c.life.touchMemories(mems.map((m) => m.id), now());
    const cut = (t) => ([...t].length > 200 ? `${[...t].slice(0, 200).join('')}…` : t);
    const out = [];
    if (mems.length) out.push('记得的：', ...mems.map((m) => `${memoryLine(m, now(), tz)}（${when.format(m.created)} 记下${m.replaced_by != null ? `，后来被 #${m.replaced_by} 取代` : ''}）`));
    if (rows.length) out.push(...(mems.length ? ['', '原话：'] : []), ...rows.map((r) => `${when.format(r.at)} ${r.role === 'user' ? '用户' : '你'}：${cut(r.text.replace(/\s+/g, ' '))}`));
    return out.join('\n');
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
  /** 界面填的到期日（YYYY-MM-DD，个体所在时区）转成毫秒；空为 null，格式不对报错。 */
  function dueOf(life, due) {
    if (!due) return null;
    const t = endOfDay(due, zone(life.meta('tz')));
    if (Number.isNaN(t)) throw new Error('到期日要写成 YYYY-MM-DD');
    return t;
  }

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
      const g = readGlobal().trim();
      const text = buildNature({ ...card, name: card.name?.trim() || '（未命名）' }, readYaml(profileFile()), 2000, g);
      const cut = ['personality', 'speech', 'appearance'].filter((k) => card[k]?.trim() && !text.includes(card[k].trim()));
      // 全局提示词不占预算，字数里扣掉它（标题、换行和前后空行共 9 字）
      return { nature: text, length: [...text].length - (g ? [...g].length + 9 : 0), budget: 2000, cut };
    },
    profile: () => readYaml(profileFile()) ?? {},
    saveProfile(fields) {
      writeText(profileFile(), `# 用户画像：所有个体共享，写你希望它们知道的自己

${YAML.stringify(pick(fields, PROFILE_FIELDS), { lineWidth: 0 })}`);
    },
    global: () => ({ text: readGlobal() }),
    saveGlobal: ({ text } = {}) => writeText(globalFile(), typeof text === 'string' ? text : ''),
    /** 设置（005 号决定）：envoyPreset 是本体在自带预设（闲谈陪伴、全能女仆）下时，派分身用的预设。 */
    settings: () => ({ envoyPreset: roster.getState('envoy_preset') ?? 'chara-soul-envoy' }), // 默认用插件自带的分身预设
    saveSettings({ envoyPreset } = {}) {
      const id = String(envoyPreset ?? '').trim();
      if (!/^[\w.-]+$/.test(id)) throw new Error('预设 id 只能是字母、数字、点、横线、下划线');
      roster.setState('envoy_preset', id);
    },
    imageFile: (id, kind) => imageOf(known(id), imageKind(kind)),
    /** 换头像或形象图；导入时留下的 source.png 不动 */
    saveImage(id, kind, buf) {
      const ext = imageExt(buf);
      for (const f of imageNames(imageKind(kind))) rmSync(path.join(beingDir(known(id)), f), { force: true });
      writeFileSync(path.join(beingDir(id), `${kind}.${ext}`), buf);
    },
    /** 记忆页：一个个体的全部记忆点（含被取代的），带鲜明度。 */
    memories(id) {
      const life = being(known(id)).life;
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: zone(life.meta('tz')) }); // en-CA 的日期就是 YYYY-MM-DD
      return { kinds: KINDS, items: life.memories().map((m) => ({ ...m, pinned: !!m.pinned, vividness: vividness(m, now()), due: m.due == null ? '' : ymd.format(m.due) })) };
    },
    /** 手动加一条。fields：kind、text、speaker、due（YYYY-MM-DD 或空）、pinned。 */
    addMemory(id, fields = {}) {
      const life = being(known(id)).life;
      return { id: life.addMemory({ kind: kindOf(fields.kind), text: memoryText(fields.text), speaker: String(fields.speaker ?? '').trim() || '用户', due: dueOf(life, fields.due), pinned: !!fields.pinned, origin: 'user', at: now() }) };
    },
    /** 修正一条：只改给出的字段；改了内容也算想起过。replaced_by 只能清空（撤销取代）。 */
    saveMemory(id, mid, fields = {}) {
      const life = being(known(id)).life;
      if (!life.memory(Number(mid))) throw new Error(`没有这条记忆：#${mid}`);
      const f = {};
      if ('kind' in fields) f.kind = kindOf(fields.kind);
      if ('text' in fields) f.text = memoryText(fields.text);
      if ('speaker' in fields) f.speaker = String(fields.speaker ?? '').trim() || '用户';
      if ('due' in fields) f.due = dueOf(life, fields.due);
      if ('pinned' in fields) f.pinned = fields.pinned ? 1 : 0;
      if ('replaced_by' in fields && fields.replaced_by == null) f.replaced_by = null;
      life.updateMemory(Number(mid), f);
      if ('text' in f) life.touchMemories([Number(mid)], now());
    },
    deleteMemory: (id, mid) => being(known(id)).life.deleteMemory(Number(mid)),
    userAvatarFile: () => userAvatars().find((f) => existsSync(f)) ?? null,
    /** 换用户头像（画像页），换格式时删掉旧文件 */
    saveUserAvatar(buf) {
      const ext = imageExt(buf);
      const files = userAvatars();

      mkdirSync(path.dirname(files[0]), { recursive: true });
      for (const f of files) rmSync(f, { force: true });
      writeFileSync(files.find((f) => f.endsWith(`.${ext}`)), buf);
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
    nature, moment, afterTurn, remember, recall, envoyBrief, envoyReport, command, view, close, homeInfo, moveHome, removeOldHome,
    get home() {
      return home;
    },
  };
}
