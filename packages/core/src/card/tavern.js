// SillyTavern 角色卡（V1 / V2 / V3，JSON 或 PNG）转成本项目的角色卡对象（开发计划 M6）。
import { readFileSync } from 'node:fs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 从 PNG 的 tEXt 块里取卡片 JSON：V3 写在 ccv3，V2 写在 chara，都是 base64。两者都有时取 ccv3。 */
export function pngCardJson(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 文件');
  const found = {};
  for (let at = 8; at + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (at + 12 + len > buf.length) throw new Error('PNG 文件不完整');
    if (type === 'tEXt') {
      const body = buf.subarray(at + 8, at + 8 + len);
      const nul = body.indexOf(0);
      const key = body.toString('latin1', 0, nul).toLowerCase();
      if (nul > 0 && (key === 'ccv3' || key === 'chara')) found[key] = body.toString('latin1', nul + 1);
    }
    if (type === 'IEND') break;
    at += 12 + len;
  }
  const b64 = found.ccv3 ?? found.chara;
  if (!b64) throw new Error('这张 PNG 里没有角色卡数据');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

/** 读 SillyTavern 卡文件（.json / .png），返回原始 JSON。 */
export function readTavernJson(file) {
  const buf = readFileSync(file);
  return /\.png$/i.test(file) ? pngCardJson(buf) : JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 转换规则：
 * - description（酒馆卡的主体设定）、personality（性格概要）、scenario（场景）合并进性格；酒馆卡没有口吻字段，留空让用户补
 * - system_prompt、post_history_instructions 不导入：它们是给模型的指令，可能夹带越过底线的要求
 * - 启用的世界书条目进 lorebook，M3 起成为来源为 card 的初始记忆点
 * - {{char}} 换成名字，{{user}} 换成「用户」
 * - V3 的 nickname 是角色本名（name 常是卡片标题，如「Delinquent classmate」），有就用它
 */
export function fromTavern(json) {
  const d = json?.data && typeof json.data === 'object' ? json.data : json;
  const name = str(d?.nickname) || str(d?.name);
  if (!name) throw new Error('酒馆角色卡缺少 name');
  const fill = (s) => s.replace(/\{\{char\}\}|<BOT>/gi, name).replace(/\{\{user\}\}|<USER>/gi, '用户');
  const personality = [str(d.description), str(d.personality) && `性格概要：${str(d.personality)}`, str(d.scenario) && `场景：${str(d.scenario)}`].filter(Boolean).join('\n\n');
  const entries = Array.isArray(d.character_book?.entries) ? d.character_book.entries : [];
  return {
    name,
    title: str(d.name),
    personality: fill(personality),
    first_mes: fill(str(d.first_mes)),
    mes_example: fill(str(d.mes_example)),
    lorebook: entries
      .filter((e) => e && e.enabled !== false && str(e.content))
      .map((e) => ({ keys: (Array.isArray(e.keys) ? e.keys : []).map(String), content: fill(str(e.content)) })),
    dropped: ['system_prompt', 'post_history_instructions'].filter((k) => str(d[k])),
  };
}
