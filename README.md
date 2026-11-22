# Nookdeck plugins and themes

The community registry for [Nookdeck](https://nookdeck.app) (formerly PhoneDesk). It has two lists:

| | What it adds | List | Folder | Browse |
|---|---|---|---|---|
| **Plugins** | Tiles and buttons, with the permissions they need | [`plugins.json`](plugins.json) | [`plugins/`](plugins) | [nookdeck.app/plugins](https://nookdeck.app/plugins) |
| **Themes** | A whole look for the deck: colours, corners, fonts, one or more variants | [`themes.json`](themes.json) | [`themes/`](themes) | [nookdeck.app/themes](https://nookdeck.app/themes) |

Both install from Nookdeck's management page (**Plugins** or **Theme** → **Packs**), or from a website's "Open in Nookdeck" button. Nothing is applied until you press the button in the app.

## Add your plugin

1. Build it: see the [plugin guide](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md). A plugin is a folder or repo with a `nookdeck.json`.
2. Install it in Nookdeck from its GitHub URL and check that it works.
3. Open a pull request that adds one entry to `plugins.json`, sorted by `id`:

```json
{
  "id": "dev.yourname.crypto",
  "name": "Crypto price",
  "author": "yourname",
  "repo": "https://github.com/yourname/nookdeck-crypto",
  "version": "1.0.0",
  "sha256": "<the value shown on the plugin card after install>",
  "description": "Live price of a coin",
  "permissions": { "network": ["api.coingecko.com"] },
  "screenshot": "https://raw.githubusercontent.com/yourname/nookdeck-crypto/main/screenshot.png"
}
```

A maintainer reviews every entry. Plugins that ask for `shell` or `keyboard` get a closer look. Each new version is a new PR that bumps `version` and `sha256`; installs are pinned to that hash.

You don't have to be listed here to share a plugin: anyone can install from a GitHub URL. Unlisted plugins show an "Unreviewed" badge.

## Listed plugins

| Plugin | What it does | Permissions |
|---|---|---|
| [Crypto price](plugins/crypto-price) | Live coin price from CoinGecko, as a stat tile | network: api.coingecko.com |
| [Clipboard snippets](plugins/clipboard-snippets) | Buttons that copy a saved text to the clipboard | shell (settings passed as environment variables) |

| [GitHub stars](plugins/github-stars) | Star count of a repository, with a short history (runs code) | network: api.github.com, storage |
| [Uptime ping](plugins/uptime-ping) | Is a website up, and how fast (runs code) | network: nookdeck.app |

Plugins that run code need Nookdeck 0.3.1 or later.

## Add your theme

A theme pack is a folder with a `nookdeck.json` (`"type": "theme"`) and one or more variants, plus optional `theme.css`, fonts and `previews/<variant>.png`. Build and try it in Nookdeck first (**Theme** → **Customize** → **Export this look** gives you the files).

1. Put the pack in `themes/<name>/`, with a `README.md` and a `LICENSE` (and the font's licence if it ships one).
2. Add one entry to `themes.json`, sorted by `id` (ids look like `dev.yourname.<name>`):

```json
{
  "id": "dev.yourname.sunset",
  "name": "Sunset",
  "author": "yourname",
  "repo": "https://github.com/yourname/nookdeck-sunset/tree/<commit>/themes/sunset",
  "version": "1.0.0",
  "sha256": "<the value shown after install>",
  "description": "Warm orange on dusk blue",
  "license": "MIT",
  "credit": "Original design",
  "variants": [
    { "id": "dusk", "name": "Dusk", "mode": "dark", "preview": "https://raw.githubusercontent.com/.../previews/dusk.png",
      "colors": { "bg": "#14161f", "tile": "#1e2230", "accent": "#ff8a4c", "text": "#f2f0ea", "muted": "#9aa0b4" } }
  ]
}
```

- `repo` is pinned to a commit, so what was reviewed is what installs. A new version is a new PR.
- `license` and `credit` are shown on the website. Say plainly if it is a port of someone else's theme, and keep their licence.
- `colors` drive the website's swatches; `preview` is a screenshot of the deck in that variant.

The listed themes: Catppuccin, Cyberpunk, JellyFish, Night Owl, One Dark Pro, SynthWave '84 and Tokyo Night. Nookdeck 0.4.0 or later. Two more packs, Nookdeck and Nookdeck Classic, ship inside the app and are not listed here.

## Checks

Every pull request runs `bun scripts/validate.ts`: it checks the entry, then fetches the plugin's own `nookdeck.json` from the repo and makes sure the id, version and permissions match. [`nookdeck.schema.json`](nookdeck.schema.json) is the schema for that manifest (the same one the Nookdeck SDK ships).

## Tiers

- **Community:** listed here and maintained by its author.
- **Verified:** a reviewed plugin with real users and minimal permissions gets `"verified": true`, set by maintainers only.
- **Core:** built into Nookdeck itself; see [CONTRIBUTING](https://github.com/howznguyen/nookdeck/blob/main/CONTRIBUTING.md).

## License

The registry data is MIT. Each plugin has its own license in its repo.
