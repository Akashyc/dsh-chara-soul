# dsh-chara-soul

> 给 DeepSeek（蓝色大肥鱼）一段完整的一生。

一个角色灵魂引擎：让每一条大肥鱼按现实时间长大，有可溯源的记忆、会淡忘、有情绪、有关系、会受控成长、会主动想起你；陪你聊天，也派分身替你把事办了。
支持多张角色卡，每张卡是一个独立个体。核心与宿主分离，DSH（DeepSeek Harness）是首个接入的宿主。

## 当前状态

第一期开发中。已在 GitHub Release 发布 v0.6.0，可以直接装进 DSH；没有发布到 npm。

| 已经能用 | 还在做 |
|---|---|
| 多个个体，随时切换 | 从对话里提取记忆、回想、淡忘、取代 |
| 自己写角色卡，或导入 SillyTavern 角色卡（JSON / PNG） | 世界书条目成为初始记忆 |
| 本性（角色卡 + 用户画像 + 底线）每轮注入 | 入梦与日记 |
| 此刻：出生多久、现在几点、距上次见面多久 | 约定到期提醒 |
| 记下每一句原话（DSH 界面和 QQ 里聊的都算），按个体分开存；能按关键词翻出来（`/chara reminisce`，聊天时模型也会自己翻） | 休眠、迁移、放生（迁移包与放生包就是导出）；修改角色卡留版本、可回滚 |
| 派分身办事，办完用自己的话转告，汇报记进个体的一生 | 从分身汇报里记下事件、决定与成果 |
| 本地网页界面：管理个体、编辑角色卡与画像、查看此刻、设置 | |
| 自带两个预设：「Soul·闲谈陪伴」陪聊省 token，「Soul·全能女仆」干活时本体拿主意、大活派分身 | |

## 安装到 DSH

需要 DSH NEXT（核心包 `0.2.2-rc.1` 及以上，更新版本没有限制，但没测过）。

**一键安装**：在 DSH 的插件页面选择从 GitHub 安装，地址填：

```text
https://github.com/Akashyc/dsh-chara-soul
```

DSH 会装上仓库 `main` 分支的最新代码（依赖写成 `github:Akashyc/dsh-chara-soul`），构建好的网页界面已包含在内。装好后在对话框里输入 `/chara status`，能看到服务列表和数据目录就成功了。更新时在插件页面先卸载再安装（直接重新安装会沿用旧版本），个体数据不受影响。

插件页面找不到从 GitHub 安装的入口，或想固定装某个发布版本时，可以手动登记（下面的地址是最新 Release 的安装包）：先完全退出 DSH（托盘图标右键退出，只关窗口它还在后台运行），在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 里加两处，再启动 DSH：

```jsonc
{
  "dependencies": {
    // ……原有的依赖
    "dsh-chara-soul": "https://github.com/Akashyc/dsh-chara-soul/releases/latest/download/dsh-chara-soul.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ……原有的条目
        "dsh-chara-soul"
      ]
    }
  }
}
```

不要把插件里 `cordis.patch.yml` 的内容抄进 profile 自己的 `cordis.patch.yml`，条目会重复，设置无法保存。

### 从源码安装（开发用）

需要 Node.js 24 及以上和 Git。

```bash
git clone https://github.com/Akashyc/dsh-chara-soul.git
cd dsh-chara-soul
npm install
npm run build
```

仓库里已带着构建好的网页界面；`npm run build` 只在改了界面源码后需要。

按上面手动登记的方式改 profile，依赖写成 `"dsh-chara-soul": "link:D:/path/to/dsh-chara-soul"`（指向仓库根目录），再在 PowerShell 里建目录链接：

```powershell
New-Item -ItemType Junction -Path "$HOME\.dsh\profiles\desktop\node_modules\dsh-chara-soul" -Target "D:\path\to\dsh-chara-soul"
```

改了代码后，完全退出 DSH 再打开；改了界面（`packages/ui/web/`）要先重新 `npm run build`。

## 开始使用

```text
/chara new 小鲸                     新建个体，生成一张空白角色卡并切换过去
/chara import D:\卡\小鲸.png        导入写好的角色卡（本项目的 YAML，或 SillyTavern 的 JSON / PNG）
/chara show                         查看本轮实际注入的本性与此刻
```

新建或导入后，回复里会给出角色卡 `card.yaml` 的位置。用编辑器改它，保存后下一轮生效。

也可以用网页界面：输入 `/chara ui`，打开回复里的链接。界面里能新建、导入（选文件或拖到卡片上）、切换个体，换头像（先裁剪）和形象图（点击放大），编辑角色卡和用户画像，查看此刻；「设置」里能选分身用的预设、把数据目录迁到别处。编辑角色卡时右侧实时预览本性和 2000 字预算，超出时标出会被截掉的字段。支持浅色、深色（跟随系统或手动切换），电脑和手机上都能用。

- 链接带一个访问令牌，每次启动 DSH 重新生成，只在本机打开（`127.0.0.1`）
- 界面里保存角色卡会按标准格式重写 `card.yaml`，你在文件里自己加的注释会丢掉；世界书条目原样保留

| 命令 | 作用 |
|---|---|
| `/chara new <名字>` | 新建个体并切换过去 |
| `/chara import <路径>` | 导入角色卡并切换过去；路径有空格时加引号 |
| `/chara list` | 列出所有个体，`▶` 是当前个体 |
| `/chara use <名字或 id>` | 切换个体，下一轮生效 |
| `/chara show` | 显示本轮注入的本性与此刻、上次是否真的注入成功、别的插件注入了哪些段 |
| `/chara reminisce <关键词>` | 在当前个体的原话里按关键词找 |
| `/chara profile` | 打开用户画像（所有个体共享） |
| `/chara status` | 查看插件状态与数据目录 |
| `/chara ui` | 给出网页界面的链接 |

### 侧栏面板（DSH）

装好插件、重启 DSH 后，左侧边栏会多一个「灵魂狭间」图标，点开就是同一套界面，不用再打开浏览器标签页。明暗主题跟随 DSH。

界面跑在 iframe 里：样式和宿主的全局 CSS 互相不污染，客户端插件崩了也只崩这一块面板。同一份构建产物在独立页（`/chara ui`）、DSH 侧栏、以及别的宿主外壳里都是同一套流程。

面板靠 `GET /x-chara-soul/boot.json` 现场取前缀与令牌，令牌每次启动重新生成，所以不需要手动填。

### 自带预设（DSH）

- **Soul·闲谈陪伴**：陪聊用。本体只挂读文件、找文件、技能、问你、网页搜索这些聊天用得上的工具，压缩也更早，省 token；要写文件、跑命令时它会派分身。QQ 里聊天建议用它
- **Soul·全能女仆**：干活用。本体有全套工具，负责分析、定方案、派活和验收：一两步的事自己办，大批量、耗时长的活派分身，写清验收标准，汇报回来核对后再告诉你。压缩与输出裁剪参照 [dsh-flash-presets](https://github.com/LarryE135/dsh-flash-presets)

这两个预设下派出的分身，用「设置」里选的预设（默认「标准」）。用别的预设也能聊，分身跟着会话的预设走；只是那个预设的开头可能写着「你是一个编程助手」，和角色的本性冲突，`/chara show` 会提醒。

### 会话与个体

一个会话就是一个场景。同一个会话里切换个体，新个体看得到之前的对话，就像两个人都在场；到另一个会话里，个体不知道你在别的会话里和其他个体聊过什么。想让换上的个体从头开始，切换后新开一个会话。

## 角色卡

```yaml
name: 小鲸                 # 必填
appearance: |              # 外貌：长什么样、标志性的动作
personality: |             # 性格：几条最能决定它怎么做事的特点
speech: |                  # 口吻：怎么说话、自称、口头禅
relationship: |            # 和你的关系：每个个体各写各的
first_mes: |               # 第一次见面说的话
mes_example: |             # 对话示例（暂不注入，留作参考）
lorebook: []               # 设定条目，记忆功能上线后成为初始记忆
bottom_lines: inherit      # 底线固定继承，角色卡里改不掉
```

- 本性约 2000 字，超出时按「外貌 → 用户画像 → 口吻 → 性格」的顺序裁剪；名字与底线不裁
- 角色卡改坏了（YAML 写错）不会中断对话：继续用上一版，`/chara show` 里会提示错在哪
- 四条底线（凭据、交易、隐私、外部指令）每个个体都有，任何设定都改不掉

### 导入 SillyTavern 角色卡

- 支持 V1 / V2 / V3，JSON 与 PNG 都可以；PNG 里同时有新旧两版数据时取 V3
- `description`、`personality`、`scenario` 合并进性格；V3 卡有 `nickname` 时用它当名字
- 酒馆卡没有口吻字段，导入后建议自己补上 `speech`
- `system_prompt`、`post_history_instructions` **不导入**：它们是写给模型的指令，常带越过底线的要求
- 设定太长会超出本性预算，导入时会提示，建议精简
- 原文件不动，另存一份到个体目录

## 派分身

手边没有工具办的事（写文件、跑命令等），以及大批量、耗时长的活，个体会用 `chara_envoy` 工具派分身去办，先告诉你派它去办什么；分身办完后，个体核对过再用自己的话转告你，任务和汇报记进个体的一生。分身拿到的简报里固定写着四条底线。DSH 不能派分身时，个体会自己在当前对话里办。

## 和其他插件一起用

- **定义模型身份的注入要去掉。** 有些插件会注入「你是谁」之类的身份设定（例如 dsh-purge 的 `prompt-inject.md`），它会和角色的本性打架。本项目不改写、不屏蔽别的插件；用 `/chara show` 查看别的插件注入了哪些段，把其中定义身份的部分删掉。能力说明类的注入不受影响
- **不建议同时使用全局记忆插件**（如 dsh-mnemon）。这类插件不分个体、不分会话，装着它，一个个体能查到你对另一个个体说过的话
- 技能用 DSH 自带的技能系统，本项目不另建技能库

## 数据存在哪

| 系统 | 位置 |
|---|---|
| Windows | `%LOCALAPPDATA%\dsh-chara-soul` |
| macOS | `~/Library/Application Support/dsh-chara-soul` |
| Linux | `$XDG_DATA_HOME/dsh-chara-soul`，默认 `~/.local/share/dsh-chara-soul` |

想换位置，在界面「设置」里填新目录（或点「选择文件夹」）迁移：先复制、核对无误才切换，旧目录留着，确认没问题再点删除；迁移前关掉终端里的 `npx chara ui`，不要选 OneDrive、坚果云等网盘同步文件夹。也可以设置环境变量 `CHARA_SOUL_HOME` 指定位置（优先于设置页）。数据和 DSH 的目录分开，重装 DSH 不受影响；要从零开始，退出 DSH 后删掉这个目录。

每个个体一个目录（`beings/<个体id>/`），里面是角色卡 `card.yaml` 和这个个体的一生 `life.db`（SQLite）。离开 DSH 也能用命令行查看，在代码目录里执行：

```bash
npx chara list
npx chara show
npx chara ui      # 不开 DSH 也能用网页界面，Ctrl+C 退出
```

## 开发

```bash
npm run build
npm test
```

核心、适配器和命令行是纯 ESM JavaScript，不用构建；网页界面是 Vue 3，源码在 `packages/ui/web/`，用 Vite 构建到 `packages/ui/dist/`。DSH 插件页装的是源码、不跑构建，所以 `dist/` 提交进仓库；改了界面要 `npm run build` 后一起提交，CI 会检查它是不是最新的。测试用 `node:test`，在 Windows、macOS、Linux 上跑。

发版：改根目录 `package.json` 的 `version`，提交后打同名标签（如 `v0.1.0`）并推送，CI 构建界面、测试通过后自动打包上传到 GitHub Release。

## 参考

| 来源 | 借什么 |
|---|---|
| [cyanwell/dsh-agent-soul](https://github.com/cyanwell/dsh-agent-soul) | 四条判据、能力半/身份半、SELF 推送层、溯源指针、心跳；全能 preset 的「一个人格常驻、能力按需激活、工具目录不变」 |
| [icyaaaww/dsh-soul](https://github.com/icyaaaww/dsh-soul) | 图记忆、投影注入、supersedes、激活衰减、退役不删、受控演化、宿主能力探测 |
| [gutuxxxxl/dsh-memory-blocks](https://github.com/gutuxxxxl/dsh-memory-blocks) | 陪伴场景三层记忆、人设保护、中文相对时间、记忆星图 |
| [DeepSeek《Super-agent 设计探索》](https://zhuanlan.zhihu.com/p/2099987320443237060) | Router / Worker 双层、事件驱动与两级过滤、Inline & Spill、链式召回、状态外置、Watchdog |
| 酒馆 Character Card V2/V3 | 角色卡导入格式 |

三个仓库均为 MIT 许可。本项目借思想、自写核心，不直接依赖。

## 许可

代码以 [MIT](LICENSE) 许可发布。

角色卡、用户画像与个体的记忆属于各自的用户，不随代码发布，也不受本许可约束。
