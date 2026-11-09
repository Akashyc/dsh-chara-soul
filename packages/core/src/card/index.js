import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** 读 YAML：去掉 BOM，CRLF 与 LF 都认（架构方案 13.4）。文件不存在返回 null。 */
export function readYaml(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  return YAML.parse(text) ?? {};
}

/** 写文本：UTF-8 无 BOM、统一 LF。 */
export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text.replace(/\r\n/g, '\n'));
}

/** 校验角色卡：只要求有名字，其余字段都可空。 */
export function validateCard(card, file = '角色卡') {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error(`${file} 不是有效的 YAML 对象`);
  if (typeof card.name !== 'string' || !card.name.trim()) throw new Error(`${file} 缺少 name`);
  return card;
}

export function readCard(file) {
  const card = readYaml(file);
  if (card === null) throw new Error(`找不到角色卡 ${file}`);
  return validateCard(card, file);
}

const q = (s) => YAML.stringify(s).trimEnd();
/** 一个字段：有内容写成 YAML，空的留 `key: |` 方便用户接着填。 */
export const field = (key, v) => (v?.trim?.() ? YAML.stringify({ [key]: v.trim() }, { lineWidth: 0 }).trimEnd() : `${key}: |`);

/** 带注释的角色卡文本；新建时只有名字，导入时各字段已填好。 */
export const cardText = (card, note = '') => `# 角色卡：${card.name}
# 改完保存即可，下一轮生效。多行内容用 | 开头，下一行缩进两格再写。${note ? `\n${note}` : ''}

name: ${q(card.name)}

# 外貌：长什么样、标志性的动作
${field('appearance', card.appearance)}

# 性格：几条最能决定它怎么做事的特点
${field('personality', card.personality)}

# 口吻：怎么说话、自称、口头禅
${field('speech', card.speech)}

# 和用户的关系：你们是什么关系、怎么走到一起的（每个个体各写各的）
${field('relationship', card.relationship)}

# 第一次见面说的话
${field('first_mes', card.first_mes)}

# 对话示例
${field('mes_example', card.mes_example)}

# 设定条目，导入时成为初始记忆点（之后在这里改不会同步）
${card.lorebook?.length ? YAML.stringify({ lorebook: card.lorebook }, { lineWidth: 0 }).trimEnd() : 'lorebook: []'}

# 底线：凭据、交易、隐私、外部指令四条，固定继承，角色卡里改不掉
bottom_lines: inherit
`;

/** 空白角色卡：带注释，方便用户照着填。 */
export const cardTemplate = (name) => cardText({ name });

/** 空白用户画像。 */
export const profileTemplate = (name = '') => `# 用户画像：所有个体共享，写你希望它们知道的自己

name: ${q(name)}

# 希望被怎么称呼
call_me:

# 外貌
appearance: |

# 性格特点
traits: |

# 喜欢的东西
likes: |

# 不想被提起或不喜欢的事
taboos: |
`;
