// 核心入口：不依赖任何宿主。适配器与 cli 都只通过这里访问（架构方案第四节）。
import path from 'node:path';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { dataHome, ensureHome } from './store/index.js';
import { openRoster } from './roster/index.js';
import { readCard, readYaml, writeText, cardTemplate, profileTemplate } from './card/index.js';
import { buildNature, buildBrief } from './nature/index.js';
import { floor5, zone, timeLines } from './chrono/index.js';
import { openLife } from './memory/life.js';

const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/**
 * home：数据目录；now：时钟（测试可注入）；host：写进原话的来源宿主名。
 */
export function createCore({ home = ensureHome(dataHome()), now = Date.now, host = 'unknown' } = {}) {
  const roster = openRoster(home, now);
  const beingDir = (id) => path.join(home, 'beings', id);
  const cardFile = (id) => path.join(beingDir(id), 'card.yaml');
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
    /** 导入一张写好的卡：校验后建个体并切换过去，原文件不动，注释原样保留。 */
    import(arg) {
      const file = arg.replace(/^["']|["']$/g, '');
      if (!file) return fail('用法：import <角色卡文件路径>');
      if (!/\.ya?ml$/i.test(file)) return fail('目前只支持本项目的 YAML 角色卡；SillyTavern 的 JSON / PNG 导入在后续版本提供。');
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

  function close() {
    for (const b of open.values()) b.life.close();
    roster.close();
  }

  return { nature, moment, afterTurn, envoyBrief, envoyReport, command, close, home };
}
