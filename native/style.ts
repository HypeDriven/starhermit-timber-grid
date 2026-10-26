// The look of the menus and HUD: the browser build's style sheet
// (tools/ui-style.css, converted once with `starhermit css` into
// assets/ui-style.json by `npm run css`) registered as starhermit:ui styles,
// plus what the sheet had no selector for: the theme's colors, the dialog
// (the browser's .overlay-veil + .panel), selects and checkboxes.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export function setStyle(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setTheme({
    fontSize: 16, headingSize: 24, smallSize: 13.6, padding: 8, spacing: 8,
    text: "#f5efe6", muted: "#c9bba8", panel: "#3a2d22", control: "#54402e", hovered: "#5e4834",
    pressed: "#6a5038", field: "#463727", accent: "#e0a458", focus: "#ffd27a", outline: "#8a6a44", radius: 8,
  });
  const panel = css.styles[".panel"]!;
  const veil = css.styles[".overlay-veil"]!;
  ui.setStyles({
    ...css.styles,
    // A modal card: .panel's box over .overlay-veil's dim.
    dialog: {
      background: panel.background!, radius: panel.radius!, shadow: panel.shadow!, padding: panel.padding!,
      inside: { heading: { text: { size: 24, weight: "700", color: "$text" }, margin: { bottom: 4.8 } } },
      parts: { backdrop: { background: veil.background! } },
    },
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    checkbox: { text: { color: "$text" }, minHeight: 44, parts: { box: { background: "$panel2", border: { width: 1, color: "$accent" }, radius: 4 }, mark: { background: "$accent" } } },
    select: {
      text: { color: "$text" },
      parts: {
        field: { background: "$panel2", radius: 6.4, padding: { top: 4.8, end: 8, bottom: 4.8, start: 8 }, minHeight: 40, border: { width: 1, color: "#00000000" }, hovered: { border: { color: "$accent" } } },
        list: { background: "$panel2", radius: 6.4, border: { width: 1, color: "$accent" } },
        option: { hovered: { background: "$chip" }, selected: { text: { color: "$accent" } } },
      },
    },
    scrollArea: { parts: { bar: { background: "$chip", radius: 4 } } },
    ".chip-btn.active": { border: { color: "$accent" } },
  });
}
