# Argus

A calm, watchful console for every feed you follow.

Argus is a Firefox extension dashboard for Bluesky, RSS/Atom/JSON Feed, and 4chan. The complete temporary-add-on package is in [`argus/`](argus/); a zip is included as [`argus-firefox-extension.zip`](argus-firefox-extension.zip).

## Install in Firefox

Requires Firefox 128 or later on desktop.

1. Extract `argus-firefox-extension.zip` (or use the `argus/` folder directly).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `argus/manifest.json` from the extracted folder.
4. Open Argus from the toolbar, or open the extension's `dashboard.html` using the Manifest URL's `moz-extension://…/` origin.

Temporary extensions are removed when Firefox restarts; load Argus again after restarting.

See [`argus/README.md`](argus/README.md) for feature and security details.
