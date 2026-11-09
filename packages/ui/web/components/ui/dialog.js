// 确认弹窗：替换浏览器自带的 confirm()，跟得上主题。页面里 `if (!(await ask({ ... }))) return;`
import { reactive } from 'vue';

export const dialog = reactive({ open: false, title: '', text: '', confirm: '确定', cancel: '取消', danger: false, resolve: null, back: null });

/**
 * 打开弹窗，用户选完才返回。
 * @param o title 标题；text 正文（换行原样保留）；confirm、cancel 按钮文字；danger 危险操作用红色
 * @returns 点了确认为 true，取消、关闭、Esc 为 false
 */
export function ask(o) {
  if (dialog.resolve) dialog.resolve(false); // 不叠弹窗：新的顶掉旧的
  return new Promise((resolve) => {
    Object.assign(dialog, { open: true, title: '', text: '', confirm: '确定', cancel: '取消', danger: false, ...o, resolve, back: document.activeElement });
  });
}

export function close(ok) {
  const { resolve, back } = dialog;
  Object.assign(dialog, { open: false, resolve: null, back: null });
  resolve?.(ok);
  back?.focus?.(); // 焦点回到触发它的按钮
}
