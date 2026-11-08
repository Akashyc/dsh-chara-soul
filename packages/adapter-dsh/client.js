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

        /** 面板：工具条（标题、刷新、新窗口）+ 内嵌页面。出问题时自己给出诊断与退路，不把白屏留给用户。 */
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
            const detach = function () {
                if (!url) return
                try { window.open(url.replace('&embed=1', ''), '_blank', 'noopener') } catch (e) { /* 弹窗被拦 */ }
            }

            return h('div', { className: 'chara-panel', style: S.root },
                h('div', { style: S.bar },
                    h('span', { style: S.grow }, '灵魂狭间'),
                    h('button', { type: 'button', style: S.btn, onClick: reload, title: '重新载入界面' }, '刷新'),
                    h('button', { type: 'button', style: S.btn, onClick: detach, title: '在新窗口打开（界面里所有功能都能用）' }, '新窗口'),
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
            },
        }
    },
})
