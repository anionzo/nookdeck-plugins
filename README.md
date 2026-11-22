# Nookdeck plugins

The community plugin registry for [Nookdeck](https://nookdeck.app) (formerly PhoneDesk). The Nookdeck Store, coming in a later release, lists the plugins in [`plugins.json`](plugins.json).

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

## Tiers

- **Community:** listed here and maintained by its author.
- **Verified:** a reviewed plugin with real users and minimal permissions gets `"verified": true`, set by maintainers only.
- **Core:** built into Nookdeck itself; see [CONTRIBUTING](https://github.com/howznguyen/nookdeck/blob/main/CONTRIBUTING.md).

## License

The registry data is MIT. Each plugin has its own license in its repo.
