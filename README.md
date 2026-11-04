# bee glass

See-through, blurred Firefox for Linux — the browser looks like a translucent terminal.
Tabs, toolbar and dark websites share one glass tint, so the toolbar runs straight into the page.
Photos, videos, text, buttons and pop-up menus stay solid and readable.

Three parts, use what you need:

| Part | What it does | Where |
| --- | --- | --- |
| **Kit** (`kit/`) | The real glass: Firefox settings + `userChrome.css` + a compositor rule | Linux with a blurring compositor (tested: Hyprland 0.56, Firefox 158) |
| **Bee glass script** (`userscript/`) | Turns dark website backgrounds into glass (72%), keeps media/text/pop-ups solid | Violentmonkey/Tampermonkey, on top of the kit |
| **Firefox theme** (`firefox-theme/`) | Colour-only lookalike: warm dark, flush toolbar, readable menus | Any Firefox — [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/bee-glass/) (once approved) |

Firefox themes can only use colours, so the store theme has no transparency. For real glass, use the kit.

## Install the kit

1. **Find your profile folder:** open `about:support` → *Profile Folder* → *Open Folder*.
2. **Settings:** copy `kit/firefox/user.js` into that folder (or merge it into your existing `user.js`).
3. **Styles:** copy `kit/firefox/chrome/` into that folder, so you have `<profile>/chrome/userChrome.css`.
   If you already have a `userChrome.css`, add `@import url("bee-glass.css");` to it and save this file as `bee-glass.css` instead.
4. **Compositor:** on Hyprland, add the lines from `kit/hyprland/firefox-glass.conf` to your config.
   Other compositors: enable blur behind translucent windows and keep Firefox at 100% window opacity (untested).
5. **Restart Firefox** (fully quit with Ctrl+Q).
6. **Websites:** install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/), then open
   `userscript/bee-glass.user.js` (raw) and click *Install*.

**Worked if:** the tab bar shows your wallpaper blurred behind it, and on a dark site like X the page background
does too, while pictures stay solid.

## How the page glass works

The script reads each element's background colour. The page's own colour becomes one 72% glass layer;
layers in that same colour turn clear (so they don't stack into solid black); other dark surfaces get a lighter
55% tint; dark pop-ups become 86% glass; blurred sticky bars get a light tint (a CSS blur renders solid on a
transparent window). Light colours, images, video, form fields, buttons and anything clickable are left alone.
Pages with no background and light text (error pages) get the 72% base so text never sits on bare wallpaper.

## Undo

Remove the `user.js` lines (or set them back in `about:config`), delete `chrome/userChrome.css`,
disable the script in Violentmonkey, remove the Hyprland rule, restart Firefox.

## Notes

- Firefox updates can rename the internal pieces `userChrome.css` targets (Firefox 158 renamed its pop-up
  colours, for example). If something turns opaque or see-through after an update, open an issue.
- `tools/amo-sign.py` is the standard-library script used to sign and submit the theme on addons.mozilla.org.

MIT License — see `LICENSE`.
