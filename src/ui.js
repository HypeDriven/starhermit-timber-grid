// Timber Grid — DOM shell helpers: i18n, live announcements, focus handling.
// All menus, forms, and assistive descriptions live in semantic HTML.
export const I18N = {
  en: {
    title: 'Timber Grid', play: 'Play', tagline: 'Fit wooden pieces. Clear rows, columns, and 3×3 regions.',
    learn: 'Learn', journey: 'Journey', daily: 'Daily Challenge', practice: 'Practice',
    challenge: 'Challenge', scores: 'Score Chase',
    score: 'Score', moves: 'Moves left', goal: 'Goal', best: 'Best',
    pause: 'Pause', resume: 'Resume', restart: 'Restart', undo: 'Undo', hint: 'Hint',
    results: 'Results', gameOver: 'Game Over', stageClear: 'Stage Clear!',
    settings: 'Settings', help: 'Help', backToTitle: 'Back to Title', back: 'Back',
    start: 'Start', playAgain: 'Play Again', nextStage: 'Next Stage',
    breakdown: 'Score breakdown', placed: 'Placed', cleared: 'Cleared cells',
    multi: 'Simultaneous bonus', combo: 'Combo bonus', total: 'Total',
    noPieceFits: 'No offered piece fits.', moveLimitReached: 'Move limit reached.',
    goalMet: 'Goal reached!', reason: 'Reason',
    language: 'Language', theme: 'Theme', quality: 'Graphics quality',
    reducedMotion: 'Reduced motion', highContrast: 'High contrast', largeText: 'Larger text',
    leftHanded: 'Left-handed controls', colorPalette: 'Color palette',
    holdToDrag: 'Hold to drag pieces', haptics: 'Haptics',
    music: 'Music', effects: 'Effects', ambience: 'Ambience', muted: 'Mute all',
    ranked: 'Ranked', unranked: 'Unranked', expectedDuration: 'Expected duration',
    minutes: 'min', rulesSummary: 'Place all offered pieces; full rows, columns and 3×3 regions clear. The round ends when nothing fits.',
    howToPlay: 'How to play',
    helpPlace: 'Drag a piece from the tray onto the board, or select it with the keyboard and move the target with arrow keys. Enter/Space places it.',
    helpClear: 'A completely filled row, column, or 3×3 region clears and scores points.',
    helpCombo: 'Clearing on consecutive placements builds a combo bonus.',
    helpKeys: 'Keys: arrows move target, 1–3 select piece, Enter place, U undo, H hint, P/Esc pause, C camera reset.',
    achievements: 'Achievements', leaderboard: 'Leaderboard',
    dailyDone: 'Daily completed', invalidBlocked: 'That cell is blocked or out of bounds.',
    tutorialDone: 'Tutorial complete!', comboStreak: 'Combo',
    noWebGL: '3D is unavailable; the accessible board below is fully playable.',
    announcePlaced: 'Placed {shape} at row {row}, column {col}. Score {score}.',
    announceClear: 'Cleared {n} lines. {score} points.',
    announceOver: 'Round over: {reason}. Final score {score}.',
    stage: 'Stage', difficulty: 'Difficulty', par: 'Par',
    mastery: 'Mastery', masteryStage: 'Mastery stage — reach the goal to prove your skill.',
    selectPiece: 'Select piece', trayLabel: 'Piece tray',
    boardLabel: 'Game board, 9 by 9', objective: 'Objective',
  },
  zh: {
    title: 'Timber Grid', play: '开始游戏', tagline: '摆放木块，消除整行、整列和 3×3 区域。',
    learn: '教学', journey: '旅程', daily: '每日挑战', practice: '练习',
    challenge: '挑战', scores: '排行榜',
    score: '分数', moves: '剩余步数', goal: '目标', best: '最佳',
    pause: '暂停', resume: '继续', restart: '重新开始', undo: '撤销', hint: '提示',
    results: '结算', gameOver: '游戏结束', stageClear: '过关！',
    settings: '设置', help: '帮助', backToTitle: '返回标题', back: '返回',
    start: '开始', playAgain: '再来一局', nextStage: '下一关',
    breakdown: '得分明细', placed: '放置', cleared: '消除格子',
    multi: '同时消除奖励', combo: '连击奖励', total: '总计',
    noPieceFits: '没有可放置的方块。', moveLimitReached: '步数已用完。',
    goalMet: '达成目标！', reason: '原因',
    language: '语言', theme: '主题', quality: '画质',
    reducedMotion: '减少动态效果', highContrast: '高对比度', largeText: '更大字体',
    leftHanded: '左手操作', colorPalette: '色板',
    holdToDrag: '按住拖动方块', haptics: '震动反馈',
    music: '音乐', effects: '音效', ambience: '环境音', muted: '全部静音',
    ranked: '排名', unranked: '非排名', expectedDuration: '预计时长',
    minutes: '分钟', rulesSummary: '放置所有提供的方块；满行、满列和 3×3 区域会消除。无处可放时回合结束。',
    howToPlay: '玩法说明',
    helpPlace: '将托盘中的方块拖到棋盘上，或用键盘选择方块后用方向键移动目标，回车/空格放置。',
    helpClear: '填满整行、整列或 3×3 区域即可消除得分。',
    helpCombo: '连续放置都消除可累积连击奖励。',
    helpKeys: '按键：方向键移动目标，1–3 选择方块，回车放置，U 撤销，H 提示，P/Esc 暂停，C 重置视角。',
    achievements: '成就', leaderboard: '排行榜',
    dailyDone: '今日已完成', invalidBlocked: '该格子被占用或越界。',
    tutorialDone: '教学完成！', comboStreak: '连击',
    noWebGL: '3D 不可用；下方无障碍棋盘可完整游玩。',
    announcePlaced: '已在第 {row} 行第 {col} 列放置 {shape}，当前分数 {score}。',
    announceClear: '消除 {n} 条，得分 {score}。',
    announceOver: '回合结束：{reason}。最终分数 {score}。',
    stage: '关卡', difficulty: '难度', par: '标准步数',
    mastery: '精通', masteryStage: '精通关卡——达成目标，证明你的技巧。',
    selectPiece: '选择方块', trayLabel: '方块托盘',
    boardLabel: '游戏棋盘，9×9', objective: '目标',
  },
};

let lang = 'en';
export function setLang(l) { lang = I18N[l] ? l : 'en'; }
export function getLang() { return lang; }
export function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]));
  return s;
}

// Tiny DOM builder.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

// Live region for screen-reader announcements (objective, score, errors, results).
let liveEl = null;
export function initLiveRegion(root) {
  liveEl = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.appendChild(liveEl);
}
export function announce(msg) {
  if (!liveEl) return;
  liveEl.textContent = '';
  // Force re-announcement of identical consecutive messages.
  requestAnimationFrame(() => { liveEl.textContent = msg; });
}

// Focus trap for modal overlays; returns a release function.
export function trapFocus(container) {
  const prev = document.activeElement;
  const focusables = () => [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(n => !n.disabled && n.offsetParent !== null);
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
  const f = focusables();
  if (f.length) f[0].focus();
  return () => {
    container.removeEventListener('keydown', onKey);
    if (prev && prev.focus) prev.focus();
  };
}

// Mini piece preview as an inline grid of divs (DOM tray pieces).
export function piecePreview(shapeCells, color) {
  const maxR = Math.max(...shapeCells.map(c => c[0]));
  const maxC = Math.max(...shapeCells.map(c => c[1]));
  const grid = el('div', { class: 'piece-grid', style: `grid-template-columns: repeat(${maxC + 1}, 1fr);` });
  const set = new Set(shapeCells.map(([r, c]) => r * 10 + c));
  for (let r = 0; r <= maxR; r++)
    for (let c = 0; c <= maxC; c++)
      grid.appendChild(el('span', { class: 'piece-cell' + (set.has(r * 10 + c) ? ' on' : ''), style: set.has(r * 10 + c) ? `background:${color}` : '' }));
  return grid;
}
