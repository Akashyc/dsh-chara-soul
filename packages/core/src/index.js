// 核心入口：不依赖任何宿主。适配器与 cli 都只通过这里访问（架构方案第四节）。
import path from 'node:path';
import { statSync, existsSync, readFileSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import YAML from 'yaml';
import { dataHome, ensureHome } from './store/index.js';
import { openRoster } from './roster/index.js';
import { readCard, readYaml, writeText, validateCard, cardText, cardTemplate, profileTemplate } from './card/index.js';
import { readTavernJson, fromTavern } from './card/tavern.js';
import { buildNature, buildBrief } from './nature/index.js';
import { floor5, zone, timeLines, daysBetween, relative } from './chrono/index.js';
import { openLife } from './memory/life.js';

const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);
const CARD_FIELDS = ['name', 'appearance', 'personality', 'speech', 'first_mes', 'mes_example'];
const PROFILE_FIELDS = ['name', 'call_me', 'relationship', 'appearance', 'traits', 'likes', 'taboos'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] === 'string').map((k) => [k, o[k]]));

/**
 * home：数据目录；now：时钟（测试可注入）；host：写进原话的来源宿主名。
 */
export function createCore({ home = ensureHome(dataHome()), now = Date.now, host = 'unknown' } = {}) {
  const roster = openRoster(home, now);
  const beingDir = (id) => path.join(home, 'beings', id);
  const cardFile = (id) => path.join(beingDir(id), 'card.yaml');
  const AVATARS = ['avatar.png', 'avatar.jpg', 'avatar.webp'];
  const avatarOf = (id) => [...AVATARS, 'source.png'].map((f) => path.join(beingDir(id), f)).find((f) => existsSync(f)) ?? null;
  const profileFile = () => path.join(home, 'profiles', `${roster.getState('profile') ?? 'default'}.yaml`);
  const open = new Map(); // id → { life, nature, stamp, error }

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
    return row ? { row, ...being(row.id) } : null;
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

  /** 分身的简报。没有个体或没有任务时返回空串。 */
  function envoyBrief(args = {}) {
    const row = roster.current();
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
      const rows = roster.list();
      return ok(rows.length ? rows.map((r) => `${r.id === cur ? '▶' : ' '} ${r.name}（${r.id}）`).join('\n') : '还没有个体，用 new <名字> 创建。');
    },
    use(key) {
      if (!key) return fail('用法：use <名字或 id>');
      const row = roster.find(key);
      if (!row) return fail(`没有叫「${key}」的个体。`);
      roster.setCurrent(row.id);
      return ok(`已切换到「${row.name}」，下一轮生效。`);
    },
    show() {
      const c = current();
      if (!c) return ok('还没有个体，本轮不注入任何内容。');
      return ok([`【本性】\n${c.nature}`, `【此刻】\n${moment(false)}`, c.error ? `⚠ 角色卡读取出错，仍在用上一版：${c.error}` : ''].filter(Boolean).join('\n\n'));
    },
    profile() {
      const f = profileFile();
      if (!existsSync(f)) writeText(f, profileTemplate());
      return ok(`用户画像在 ${f}，编辑保存后下一轮生效。`);
    },
    help: () => ok('子命令：new <名字> | import <角色卡路径> | list | use <名字或 id> | show | profile'),
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
    if (!roster.get(id)) throw new Error(`没有这个个体：${id}`);
    return id;
  };

  /** 界面（packages/ui）用的读写：只碰角色卡、画像与个体状态，切换与导入仍走 command。 */
  const view = {
    beings() {
      const cur = roster.current()?.id;
      return roster.list().map((r) => {
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
          avatar: avatarOf(r.id) ? statSync(avatarOf(r.id)).mtimeMs : 0, // 修改时间，页面拿来刷新缓存
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
    avatarFile: (id) => avatarOf(known(id)),
    /** 换头像：认文件头，只收 PNG、JPG、WebP；导入时留下的 source.png 不动 */
    saveAvatar(id, buf) {
      const ext = buf.subarray(0, 4).toString('hex') === '89504e47' ? 'png' : buf.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
      if (!ext) throw new Error('只支持 PNG、JPG、WebP 图片');
      for (const f of AVATARS) rmSync(path.join(beingDir(known(id)), f), { force: true });
      writeFileSync(path.join(beingDir(id), `avatar.${ext}`), buf);
    },
  };

  function close() {
    for (const b of open.values()) b.life.close();
    roster.close();
  }

  return { nature, moment, afterTurn, envoyBrief, envoyReport, command, view, close, home };
}
