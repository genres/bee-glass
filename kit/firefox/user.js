// bee glass — Firefox settings. Copy into your profile folder (about:support → Profile Folder),
// or set each one in about:config. Restart Firefox afterwards.

// Load chrome/userChrome.css.
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
// Let the window and the page area be see-through.
user_pref("browser.tabs.allow_transparent_browser", true);
user_pref("widget.transparent-windows", true);
user_pref("mozilla.widget.use-argb-visuals", true);
// Firefox's newer "Nova" interface forces an opaque window on Linux; use the classic one.
user_pref("browser.nova.enabled", false);
