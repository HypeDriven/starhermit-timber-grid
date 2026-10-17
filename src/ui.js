import { shText } from './sh-i18n.js';
import { STRINGS } from './strings.js';
// Timber Grid — DOM shell helpers: i18n, live announcements, focus handling.
// All menus, forms, and assistive descriptions live in semantic HTML.
// Player-facing strings live in strings.js (nine StarHermit locales + zh).
export const I18N = STRINGS;

// Graphics panel strings, in the same locales as the game (it follows the game language).
const GFX_EN = {
  graphics: 'Graphics', gfxQuality: 'Quality', gfxAuto: 'Auto (detected: {tier})', gfxFromPreset: 'From preset ({tier})',
  gfxScale: 'Render scale', gfxAdaptive: 'Adaptive resolution', gfxShowFps: 'Show frame rate',
  gfxPostFailed: 'Post-processing is unavailable on this device; the game renders without it.',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Color grade',
  cat_antialias: 'Anti-aliasing', cat_particles: 'Particles', cat_ambient: 'Ambient motion',
  cat_reflections: 'Reflections', cat_detail: 'Detail',
  tier_off: 'Off', tier_on: 'On', tier_low: 'Low', tier_medium: 'Medium', tier_high: 'High',
  tier_balanced: 'Balanced', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  tier_static: 'Static', tier_animated: 'Animated', tier_plain: 'Plain', tier_detailed: 'Detailed',
  noShadows: 'no shadows', shadowsN: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', noAA: 'no anti-aliasing', particlesN: '{n} particles',
};
const GFX_ES = {
  graphics: 'Gráficos', gfxQuality: 'Calidad', gfxAuto: 'Automática (detectada: {tier})', gfxFromPreset: 'Según el preajuste ({tier})',
  gfxScale: 'Escala de renderizado', gfxAdaptive: 'Resolución adaptable', gfxShowFps: 'Mostrar fotogramas por segundo',
  gfxPostFailed: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
  cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Corrección de color',
  cat_antialias: 'Suavizado de bordes', cat_particles: 'Partículas', cat_ambient: 'Movimiento ambiental',
  cat_reflections: 'Reflejos', cat_detail: 'Detalle',
  tier_off: 'Desactivado', tier_on: 'Activado', tier_low: 'Baja', tier_medium: 'Media', tier_high: 'Alta',
  tier_balanced: 'Equilibrada', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  tier_static: 'Estático', tier_animated: 'Animado', tier_plain: 'Sencillo', tier_detailed: 'Detallado',
  noShadows: 'sin sombras', shadowsN: 'sombras {n}²', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
  bloom: 'resplandor', noAA: 'sin suavizado', particlesN: '{n} partículas',
};
const GFX_FR = {
  graphics: 'Graphismes', gfxQuality: 'Qualité', gfxAuto: 'Auto (détectée : {tier})', gfxFromPreset: 'Selon le préréglage ({tier})',
  gfxScale: 'Échelle de rendu', gfxAdaptive: 'Résolution adaptative', gfxShowFps: 'Afficher les images par seconde',
  gfxPostFailed: 'Le post-traitement n’est pas disponible sur cet appareil ; le jeu s’affiche sans.',
  cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage des couleurs',
  cat_antialias: 'Anticrénelage', cat_particles: 'Particules', cat_ambient: 'Mouvement ambiant',
  cat_reflections: 'Reflets', cat_detail: 'Détails',
  tier_off: 'Désactivé', tier_on: 'Activé', tier_low: 'Basse', tier_medium: 'Moyenne', tier_high: 'Haute',
  tier_balanced: 'Équilibrée', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  tier_static: 'Statique', tier_animated: 'Animé', tier_plain: 'Simple', tier_detailed: 'Détaillé',
  noShadows: 'sans ombres', shadowsN: 'ombres {n}²', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
  bloom: 'halo', noAA: 'sans anticrénelage', particlesN: '{n} particules',
};
export const GFX_I18N = {
  'en-US': GFX_EN,
  'en-GB': { ...GFX_EN, cat_grade: 'Colour grade' },
  'es-419': { ...GFX_ES, gfxScale: 'Escala de renderización', gfxShowFps: 'Mostrar cuadros por segundo', tier_plain: 'Simple' },
  'es-ES': GFX_ES,
  'de-DE': {
    graphics: 'Grafik', gfxQuality: 'Qualität', gfxAuto: 'Automatisch (erkannt: {tier})', gfxFromPreset: 'Laut Voreinstellung ({tier})',
    gfxScale: 'Renderskalierung', gfxAdaptive: 'Adaptive Auflösung', gfxShowFps: 'Bildrate anzeigen',
    gfxPostFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spiel wird ohne sie dargestellt.',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Leuchteffekt', cat_grade: 'Farbkorrektur',
    cat_antialias: 'Kantenglättung', cat_particles: 'Partikel', cat_ambient: 'Umgebungsbewegung',
    cat_reflections: 'Reflexionen', cat_detail: 'Details',
    tier_off: 'Aus', tier_on: 'An', tier_low: 'Niedrig', tier_medium: 'Mittel', tier_high: 'Hoch',
    tier_balanced: 'Ausgewogen', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    tier_static: 'Statisch', tier_animated: 'Animiert', tier_plain: 'Schlicht', tier_detailed: 'Detailliert',
    noShadows: 'keine Schatten', shadowsN: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
    bloom: 'Leuchteffekt', noAA: 'keine Kantenglättung', particlesN: '{n} Partikel',
  },
  'fr-FR': GFX_FR,
  'fr-CA': { ...GFX_FR, gfxShowFps: 'Afficher la fréquence d’images', gfxScale: 'Échelle du rendu' },
  'pt-BR': {
    graphics: 'Gráficos', gfxQuality: 'Qualidade', gfxAuto: 'Automática (detectada: {tier})', gfxFromPreset: 'Da predefinição ({tier})',
    gfxScale: 'Escala de renderização', gfxAdaptive: 'Resolução adaptável', gfxShowFps: 'Mostrar taxa de quadros',
    gfxPostFailed: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão de ambiente', cat_bloom: 'Brilho', cat_grade: 'Correção de cor',
    cat_antialias: 'Suavização de serrilhado', cat_particles: 'Partículas', cat_ambient: 'Movimento ambiente',
    cat_reflections: 'Reflexos', cat_detail: 'Detalhes',
    tier_off: 'Desligado', tier_on: 'Ligado', tier_low: 'Baixa', tier_medium: 'Média', tier_high: 'Alta',
    tier_balanced: 'Equilibrada', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    tier_static: 'Estático', tier_animated: 'Animado', tier_plain: 'Simples', tier_detailed: 'Detalhado',
    noShadows: 'sem sombras', shadowsN: 'sombras {n}²', ao: 'oclusão de ambiente', aoHigh: 'oclusão de ambiente completa',
    bloom: 'brilho', noAA: 'sem suavização', particlesN: '{n} partículas',
  },
  'it-IT': {
    graphics: 'Grafica', gfxQuality: 'Qualità', gfxAuto: 'Automatica (rilevata: {tier})', gfxFromPreset: 'Da preimpostazione ({tier})',
    gfxScale: 'Scala di rendering', gfxAdaptive: 'Risoluzione adattiva', gfxShowFps: 'Mostra frequenza fotogrammi',
    gfxPostFailed: 'La post-elaborazione non è disponibile su questo dispositivo; il gioco viene mostrato senza.',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore',
    cat_antialias: 'Antialiasing', cat_particles: 'Particelle', cat_ambient: 'Movimento ambientale',
    cat_reflections: 'Riflessi', cat_detail: 'Dettaglio',
    tier_off: 'Disattivato', tier_on: 'Attivato', tier_low: 'Bassa', tier_medium: 'Media', tier_high: 'Alta',
    tier_balanced: 'Bilanciata', tier_ultra: 'Ultra', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    tier_static: 'Statico', tier_animated: 'Animato', tier_plain: 'Semplice', tier_detailed: 'Dettagliato',
    noShadows: 'nessuna ombra', shadowsN: 'ombre {n}²', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
    bloom: 'bagliore', noAA: 'nessun antialiasing', particlesN: '{n} particelle',
  },
  zh: {
    graphics: '图形', gfxQuality: '画质', gfxAuto: '自动（检测为：{tier}）', gfxFromPreset: '跟随预设（{tier}）',
    gfxScale: '渲染比例', gfxAdaptive: '自适应分辨率', gfxShowFps: '显示帧率',
    gfxPostFailed: '此设备不支持后期处理；游戏将在无后期处理的情况下渲染。',
    cat_shadows: '阴影', cat_ao: '环境光遮蔽', cat_bloom: '泛光', cat_grade: '调色',
    cat_antialias: '抗锯齿', cat_particles: '粒子', cat_ambient: '环境动态',
    cat_reflections: '反射', cat_detail: '细节',
    tier_off: '关', tier_on: '开', tier_low: '低', tier_medium: '中', tier_high: '高',
    tier_balanced: '均衡', tier_ultra: '极高', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    tier_static: '静态', tier_animated: '动态', tier_plain: '简洁', tier_detailed: '精细',
    noShadows: '无阴影', shadowsN: '{n}² 阴影', ao: '环境光遮蔽', aoHigh: '完整环境光遮蔽',
    bloom: '泛光', noAA: '无抗锯齿', particlesN: '{n} 个粒子',
  },
};

/** Locale for the Graphics panel: the game language. */
export function gfxLocale() { return GFX_I18N[lang] ? lang : 'en-US'; }
export function tg(key, vars) {
  let s = (GFX_I18N[gfxLocale()] || GFX_EN)[key] || GFX_EN[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]));
  return s;
}

// The game language: one of the nine StarHermit locales or 'zh' (set from
// sh-language.js in main.js; legacy 'en' maps to en-US).
let lang = 'en-US';
export function setLang(l) { lang = STRINGS[l] ? l : 'en-US'; }
export function getLang() { return lang; }
/** StarHermit platform strings (sh-i18n.js) in the game language; zh carries its own copies. */
export function ts(key, vars) {
  return lang === 'zh' ? t(key, vars) : shText(key, vars || {}, lang);
}
export function t(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS['en-US'][key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
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
  // preventScroll: a panel taller than the viewport scrolls internally; keep
  // its heading (e.g. the results title and score) in view rather than
  // scrolling down to the first button.
  if (f.length) f[0].focus({ preventScroll: true });
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
