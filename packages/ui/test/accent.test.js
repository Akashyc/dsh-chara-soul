import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, DEFAULT_ACCENT, SURFACE, contrast, accentContrast, accentText, accentTokens, onAccent, hexToRgb, isHex, rgbToHex, rgbToHsv, hsvToRgb } from '../web/theme/accent.js';

test('主题色：默认色对深色底 4.3:1，小字改用推算出的亮色文字', () => {
  assert.equal(DEFAULT_ACCENT, '#4C6AFC');
  assert.equal(accentContrast(DEFAULT_ACCENT, 'dark').toFixed(1), '4.3');
  const tx = accentText(DEFAULT_ACCENT, 'dark');
  assert.ok(contrast(tx, SURFACE.dark) >= 4.5);
  // 交接里的实测值 #9DAEFF 是 8.9:1；推算值保持色相，落在同一档
  assert.ok(Math.abs(contrast(tx, SURFACE.dark) - 8.9) < 1, tx);
  assert.equal(onAccent(DEFAULT_ACCENT), '#FFFFFF');
});

test('主题色：7 个预设在深浅两套下的亮色文字都 ≥ 4.5:1', () => {
  assert.equal(PRESETS.length, 7);
  for (const [name, hex] of PRESETS) {
    for (const mode of ['dark', 'light']) {
      const tx = accentText(hex, mode);
      assert.ok(contrast(tx, SURFACE[mode]) >= 4.5, `${name} ${mode} ${tx}`);
    }
  }
});

test('主题色：派生变量与非法输入', () => {
  const t = accentTokens('#ff7a1a');
  assert.equal(t['--ac'], '#FF7A1A');
  assert.equal(t['--ac-soft'], 'rgba(255, 122, 26, 0.16)');
  assert.equal(t['--ac-line'], 'rgba(255, 122, 26, 0.75)');
  for (const bad of ['#fff', 'red', '#12345g', '', null, '#1234567']) {
    assert.equal(isHex(bad), false);
    assert.throws(() => hexToRgb(bad), /#RRGGBB/);
  }
});

test('色盘：HSV 与 RGB 来回转换不走样', () => {
  for (const [, hex] of [...PRESETS, ['', '#000000'], ['', '#FFFFFF'], ['', '#808080']]) {
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex)))), hex);
  }
  assert.deepEqual(hsvToRgb([0, 1, 1]), [255, 0, 0]);
});
