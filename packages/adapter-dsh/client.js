// dsh-chara-soul · client 半边：把角色灵魂的界面挂进 DSH 侧栏，点图标即用。
// 这个文件必须永不抛异常：client 插件崩了会把整个 Web 界面刷白。
// 侧栏只负责「壳」：拿同源令牌、放一个 iframe、同步主题；界面本身仍是 packages/ui 的同一份页面
// （其它宿主 codex / claude 只要也提供 iframe 或 webview，复用同一份页面即可）。
window.__ModuleLoader__.load({
    id: 'dsh-chara-soul',
    factory(require) {
        const React = require('react')
        const h = React.createElement
        const BASE = '/x-chara-soul'
        const PANEL_KEY = 'chara-soul'

        const S = {
            root: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit' },
            bar: {
                display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto',
                padding: '6px 12px', borderBottom: '1px solid rgba(127,127,127,0.28)', fontSize: 12,
            },
            grow: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
            btn: {
                flex: '0 0 auto', padding: '3px 10px', borderRadius: 6, font: 'inherit', cursor: 'pointer',
                border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit',
            },
            body: { position: 'relative', flex: 1, minHeight: 0 },
            frame: { display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' },
            center: {
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center', fontSize: 13,
            },
            tip: { opacity: 0.65, maxWidth: 420, lineHeight: 1.7, fontSize: 12 },
            code: {
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: '3px 7px',
                borderRadius: 5, background: 'rgba(127,127,127,0.14)',
            },
        }

        /** 令牌：页面本身不含数据，接口一律要令牌；这里向同源的挂载点要一次，之后整套请求都用它。 */
        let boot = null
        function loadBoot() {
            if (boot) return boot
            boot = fetch(BASE + '/boot.json', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('挂载点返回 ' + r.status)
                    return r.json()
                })
                .then(function (data) {
                    if (!data || !data.token) throw new Error('挂载点没有给出令牌')
                    return data
                })
                .catch(function (e) {
                    boot = null // 下次重试重新要，别把失败缓存一辈子
                    throw e
                })
            return boot
        }

        /** 宿主当前的明暗：优先读 DSH 写在 <html> 上的主题，没有就跟系统走。 */
        function hostTheme() {
            const de = document.documentElement
            const own = de.getAttribute('data-theme') || (de.dataset ? de.dataset.theme : '')
            if (own === 'dark' || own === 'light') return own
            const cls = typeof de.className === 'string' ? de.className : ''
            if (/\bdark\b/.test(cls)) return 'dark'
            if (/\blight\b/.test(cls)) return 'light'
            try {
                return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
            } catch (e) {
                return 'light'
            }
        }

        function buildUrl(data) {
            const base = (data && data.prefix) || BASE
            return base + '/?t=' + encodeURIComponent(data.token) + '&embed=1'
        }

        /** 面板：标题条 + 内嵌页面。出问题时自己给出诊断与退路，不把白屏留给用户。 */
        function SoulPanel() {
            const [attempt, setAttempt] = React.useState(0)
            const [phase, setPhase] = React.useState('loading')
            const [url, setUrl] = React.useState('')
            const [error, setError] = React.useState('')
            const frameRef = React.useRef(null)

            React.useEffect(function () {
                let dead = false
                setPhase('loading')
                setError('')
                loadBoot()
                    .then(function (data) {
                        if (dead) return
                        setUrl(buildUrl(data))
                        setPhase('ready')
                    })
                    .catch(function (e) {
                        if (dead) return
                        setError(String((e && e.message) || e))
                        setPhase('error')
                    })
                return function () { dead = true }
            }, [attempt])

            // 主题：宿主切明暗时把结果推给内嵌页面，别让面板和界面一黑一白
            React.useEffect(function () {
                const push = function () {
                    const win = frameRef.current && frameRef.current.contentWindow
                    if (!win) return
                    try {
                        win.postMessage({ type: 'chara:theme', theme: hostTheme() }, location.origin)
                    } catch (e) { /* 跨源或已卸载，忽略 */ }
                }
                push()
                let mo = null
                try {
                    mo = new MutationObserver(push)
                    mo.observe(document.documentElement, {
                        attributes: true,
                        attributeFilter: ['data-theme', 'class', 'style'],
                    })
                } catch (e) { /* 老浏览器：只靠下面的一次推送 */ }
                let media = null
                try {
                    media = matchMedia('(prefers-color-scheme: dark)')
                    media.addEventListener('change', push)
                } catch (e) { /* 无 matchMedia */ }
                return function () {
                    if (mo) mo.disconnect()
                    if (media) media.removeEventListener('change', push)
                }
            }, [])

            const reload = function () { setAttempt(function (n) { return n + 1 }) }

            return h('div', { className: 'chara-panel', style: S.root },
                h('div', { style: S.bar },
                    h('span', { style: S.grow }, '灵魂狭间'),
                ),
                h('div', { style: S.body },
                    phase === 'ready' && url
                        ? h('iframe', {
                            ref: frameRef,
                            src: url,
                            title: '灵魂狭间',
                            style: S.frame,
                            onLoad: function () {
                                const win = frameRef.current && frameRef.current.contentWindow
                                if (win) {
                                    try {
                                        win.postMessage({ type: 'chara:theme', theme: hostTheme() }, location.origin)
                                    } catch (e) { /* 忽略 */ }
                                }
                            },
                        })
                        : phase === 'error'
                            ? h('div', { style: S.center },
                                h('div', null, '界面没起来：' + error),
                                h('div', { style: S.tip }, '侧栏面板用的是同一个挂载点 ', h('span', { style: S.code }, BASE), '。挂载点没注册时，可以先在终端里运行 ', h('span', { style: S.code }, 'chara ui'), ' 打开独立窗口。'),
                                h('button', { type: 'button', style: S.btn, onClick: reload }, '重试'),
                            )
                            : h('div', { style: S.center }, h('div', null, '正在载入…')),
                ),
            )
        }

        /** 侧栏图标：注册时就要存在，缺了会让整块注册被吞掉、入口直接消失。 */
        function SoulIcon(props) {
            const size = props && props.size ? props.size : 18
            return h('svg', {
                width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
                stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
                'aria-hidden': 'true',
            },
                h('path', { d: 'M20.2 11.4c0-3.1-3.5-5.6-7.8-5.6-4.3 0-7.8 2.5-7.8 5.6 0 1 .3 1.9 1 2.7l-2 2.6 3.5-.9c1.4 1 3.2 1.6 5.3 1.6h4.6' }),
                h('path', { d: 'M20.2 11.4c.9 1.5 1.1 3.4.4 5.2' }),
                h('circle', { cx: 8.6, cy: 10.6, r: 0.9, fill: 'currentColor', stroke: 'none' }),
                h('path', { d: 'M11.4 14.4c1 .6 2.4.6 3.4 0' }))
        }

        // ── 会话头 chip：把「有分身在跑、跑了多久」变成界面上看得见的一行（M10 §6.4.3 方案 C）──
        // 契约（全部读码确认，不靠猜）：
        // · 槽位 conversation.session.header.actions 是 kind:'list'、scope:'session'
        //   （dsh-client-ui-conversation/lib/client.js:22928-22931）；list 冲突判定是
        //   id 与 priority 同时相同才抛 already has a registration（dsh-client-ui-slots/lib/index.js:181-186）。
        // · 官方 dsh-client-ui-subagent 占 id:'subagent-catalog'、order:10、未给 priority（=0）
        //   （dsh-client-ui-subagent/lib/client.js:1266-1272）。本条目 id 不同、priority 也不同，
        //   不触发冲突；list 按 priority → order 排序，所以 priority:5 会稳定排在官方那个之后。
        // · entry options 白名单只有 key/id/order/label/priority/select/inject/children/store/locale/registrant，
        //   没有 badge/count（dsh-client-ui-slots/lib/index.js:204-219）→ 数字必须当文本画进组件。
        // · 会话头组件带标准属性 sessionId / useSessions / useSessionStatus；useSessions 能读到
        //   projectionsBySession[sessionId].values.subagentCatalog 与 byId[childId].projectionValues.subagentTiming
        //   ——官方 SubagentHeaderLineage 就是这么读的（client.js:636-641），list snapshot 定义见
        //   dsh-api-session-controller/lib/client.js:4241、projectionStores 读取见 :3536/:4184-4207。
        // · subagentTiming.active 只在 turn 未结束时存在（dsh-subagent/lib/types/projection.js:43-73），
        //   故 active 存在即「这一轮还在跑」，起点就是 active.since；官方算法见
        //   dsh-client-ui-subagent/lib/client.js:70-77。
        const CHIP_SLOT = 'conversation.session.header.actions'
        const CHIP_ID = 'chara-envoys'
        const CHIP_ORDER = 20
        const CHIP_PRIORITY = 5
        const NOOP_HOOK = function () { return undefined }
        const CHIP = {
            display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
            padding: '2px 8px', borderRadius: 999, fontSize: 12, lineHeight: '18px',
            fontWeight: 600, whiteSpace: 'nowrap', color: 'inherit',
            border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.12)',
        }
        const CHIP_CLOCK = {
            fontFamily: 'ui-monospace, Consolas, monospace', fontVariantNumeric: 'tabular-nums',
            fontSize: 12, opacity: 0.8,
        }

        /** 秒级重绘用的时钟：mm:ss，超过一小时补上小时位。 */
        function clockText(ms) {
            const total = Math.floor(Math.max(0, ms) / 1000)
            const h = Math.floor(total / 3600)
            const m = Math.floor(total / 60) % 60
            const s = total % 60
            const mm = (m < 10 ? '0' : '') + m
            const ss = (s < 10 ? '0' : '') + s
            return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss
        }

        /**
         * 把「在跑的分身有几个、最早一个从什么时候起跑」压成一个字符串签名。
         * 必须是字符串：useSessions 是 zustand selector 钩子，按 Object.is 比较；
         * 返回新对象每次都变就会造成渲染风暴，所以只回原始值。
         */
        function envoysSignature(state, sessionId) {
            if (!state || typeof sessionId !== 'string' || sessionId === '') return ''
            const self = state.byId && state.byId[sessionId]
            if (self && self.origin === 'subagent') return '' // 子会话自带面包屑，这里不重复挂
            const projection = state.projectionsBySession && state.projectionsBySession[sessionId]
            const catalog = projection && projection.values && projection.values.subagentCatalog
            if (!catalog || typeof catalog.length !== 'number' || catalog.length === 0) return ''
            const byId = state.byId || {}
            let count = 0
            let since = -1
            for (let i = 0; i < catalog.length; i += 1) {
                const entry = catalog[i]
                if (!entry || typeof entry.id !== 'string') continue
                if (entry.mode === 'external') continue // 外部智能体不归我们管
                const row = byId[entry.id]
                const timing = row && row.projectionValues && row.projectionValues.subagentTiming
                const active = timing && timing.active
                const running = (active !== undefined && active !== null)
                    || entry.activity === 'running'
                    || (row !== undefined && row.running === true)
                if (!running) continue
                count += 1
                const start = active && typeof active.since === 'number' ? active.since : -1
                if (start > 0 && (since < 0 || start < since)) since = start
            }
            if (count === 0) return ''
            return String(count) + '|' + String(since)
        }

        function parseSignature(signature) {
            if (typeof signature !== 'string' || signature === '') return null
            const parts = signature.split('|')
            if (parts.length !== 2) return null
            const count = Number(parts[0])
            if (!(count > 0)) return null
            const since = Number(parts[1])
            return { count: count, since: since > 0 ? since : 0 }
        }

        /**
         * 会话头 chip 本体：有分身在跑才渲染，一个都没有时返回 null（不留空白占位）。
         * 每秒重绘一次时钟；投影变化（分身起停）由 useSessions 触发重绘。
         */
        function CharaEnvoysChip(props) {
            const p = props || {}
            const sessionId = typeof p.sessionId === 'string' ? p.sessionId : ''
            const useSessions = typeof p.useSessions === 'function' ? p.useSessions : NOOP_HOOK
            const signature = useSessions(function (state) {
                try {
                    return envoysSignature(state, sessionId)
                } catch (e) {
                    return ''
                }
            })
            const [now, setNow] = React.useState(function () { return Date.now() })
            const [seenAt, setSeenAt] = React.useState(0) // 投影里没有起跑时刻时，用第一次看到的时刻
            React.useEffect(function () {
                if (!signature) return undefined
                setSeenAt(Date.now())
                const timer = setInterval(function () { setNow(Date.now()) }, 1000)
                return function () { clearInterval(timer) }
            }, [signature])
            const parsed = parseSignature(signature)
            if (!parsed) return null
            const elapsed = Math.max(0, now - (parsed.since || seenAt || now))
            const label = '分身 ' + parsed.count + ' 运行中'
            return h('span', { className: 'chara-envoys-chip', style: CHIP, title: label + ' · 已跑 ' + clockText(elapsed) },
                h('span', null, label),
                h('span', { style: CHIP_CLOCK }, '·'),
                h('span', { style: CHIP_CLOCK }, clockText(elapsed)))
        }


        return {
            name: 'dsh-chara-soul-client',
            inject: ['slots'],
            apply(ctx) {
                // 侧栏入口 + 同名主面板：点这一项就打开角色灵魂。
                try {
                    ctx.slots.inject('main', function () {
                        return ctx.slots.inject('sidebar.panellist', function () {
                            const stopMain = ctx.slots.register({ name: 'main', key: PANEL_KEY }, SoulPanel)
                            const stopIcon = ctx.slots.register(
                                { name: 'sidebar.panellist', id: PANEL_KEY, order: 30, label: '灵魂狭间' },
                                SoulIcon,
                            )
                            return function () {
                                try { if (typeof stopIcon === 'function') stopIcon() } catch (e) { /* 已卸载 */ }
                                try { if (typeof stopMain === 'function') stopMain() } catch (e) { /* 已卸载 */ }
                            }
                        })
                    })
                } catch (e) {
                    console.warn('[dsh-chara-soul] 侧栏面板没挂上：', e)
                }

                // 会话头 chip：只加一个自己的 list 条目，不动官方 subagent-catalog，也不动侧栏。
                // 槽位不存在或冲突时安静跳过，绝不把异常抛出 apply。
                try {
                    ctx.slots.inject(CHIP_SLOT, function () {
                        return ctx.slots.register({
                            name: CHIP_SLOT,
                            id: CHIP_ID,            // 官方是 'subagent-catalog'
                            order: CHIP_ORDER,      // 官方 10 → 20，排在它后面
                            priority: CHIP_PRIORITY, // 官方未给（=0）→ 5，list 冲突判定是 id+priority
                        }, CharaEnvoysChip)
                    })
                } catch (e) {
                    console.warn('[dsh-chara-soul] 会话头 chip 没挂上：', e)
                }
            },
        }
    },
})
