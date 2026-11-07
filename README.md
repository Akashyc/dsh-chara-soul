# dsh-chara-soul

> 给 DeepSeek（蓝色大肥鱼）一段完整的一生。

一个角色灵魂引擎：让每一条大肥鱼按现实时间长大，有可溯源的记忆、会淡忘、有情绪、有关系、会受控成长、会主动想起你；陪你聊天，也派分身替你把事办了。
支持多张角色卡，每张卡是一个独立个体。核心与宿主分离，DSH（DeepSeek Harness）是首个接入的宿主。

## 当前状态

立项阶段（2026-11-07）。架构已确认，尚未开始实现。

## 参考

| 来源 | 借什么 |
|---|---|
| [cyanwell/dsh-agent-soul](https://github.com/cyanwell/dsh-agent-soul) | 四条判据、能力半/身份半、SELF 推送层、溯源指针、心跳；全能 preset 的「一个人格常驻、能力按需激活、工具目录不变」 |
| [icyaaaww/dsh-soul](https://github.com/icyaaaww/dsh-soul) | 图记忆、投影注入、supersedes、激活衰减、退役不删、受控演化、宿主能力探测 |
| [gutuxxxxl/dsh-memory-blocks](https://github.com/gutuxxxxl/dsh-memory-blocks) | 陪伴场景三层记忆、人设保护、中文相对时间、记忆星图 |
| [DeepSeek《Super-agent 设计探索》](https://zhuanlan.zhihu.com/p/2099987320443237060) | Router / Worker 双层、事件驱动与两级过滤、Inline & Spill、链式召回、状态外置、Watchdog |
| 酒馆 Character Card V2/V3 | 角色卡导入导出格式 |

三个仓库均为 MIT 许可。本项目借思想、自写核心，不直接依赖。

## 许可

代码以 [MIT](LICENSE) 许可发布。

角色卡、用户画像与个体的记忆属于各自的用户，不随代码发布，也不受本许可约束。
