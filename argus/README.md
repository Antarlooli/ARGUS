# Argus

A calm, watchful console for every feed you follow.

Firefox extension dashboard with Bluesky timelines and hashtag search, RSS/Atom/JSON Feed news, and 4chan board catalogs with inline threads.

## Install
1. Open `about:debugging#/runtime/this-firefox` in Firefox 115+.
2. Choose **Load Temporary Add-on…** and select `argus/manifest.json`.
3. Click the Argus toolbar icon to open the dashboard.

## Use
- **Bluesky:** Accounts → sign in using a Bluesky app password, then add Home or Hashtag columns.
- **News:** Add a News (RSS) column. Enter an HTTPS feed URL; Firefox asks permission for that host when you add it.
- **4chan:** Add a 4chan Board column and choose a board. Select a card for the thread; hover images to preview and click to open the lightbox.

Credentials are stored in `browser.storage.local` in the Firefox profile. This extension makes no analytics or telemetry requests. Feed and API data are rendered as text or sanitized markup.

Independent project; not affiliated with Mozilla, Bluesky, 4chan, or feed publishers. Version 0.1.0.
