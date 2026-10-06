# Build Instructions

How to package Open-Cluely as a standalone app for **Windows** and **macOS**.

`npm run build` detects the current OS and builds the matching target. Each OS must be built on that OS: build the `.exe` on Windows and the `.dmg` on a Mac.

## Prerequisites

1. Node.js 20 LTS or newer, plus npm 10+
2. Dependencies installed:
   ```bash
   npm install
   ```
3. An app icon. `assets/icon.png` is included. Run `npm run make-icon` to regenerate it, or replace it with your own PNG (1024×1024 recommended). electron-builder converts it to `.ico` and `.icns` automatically.
4. A `.env` file. The build creates one from `.env.example` if it is missing.

API keys are **not** baked into the build. They are entered in the Settings panel and stored per user.

## Windows

```powershell
npm run build:win
```

Output: `dist/Open-Cluely.exe` (portable x64, no installer).

Run it with a double-click, or `.\dist\Open-Cluely.exe --start-hidden` to start hidden.

If you get a symlink privilege error, enable **Settings → System → For developers → Developer Mode** or use an elevated terminal.

## macOS

```bash
npm run build:mac
```

Output (Apple Silicon `arm64` and Intel `x64`):

```text
dist/Open-Cluely-1.0.0-arm64.dmg
dist/Open-Cluely-1.0.0.dmg
dist/Open-Cluely-1.0.0-arm64-mac.zip
dist/Open-Cluely-1.0.0-mac.zip
```

### Signing

- **No Apple Developer certificate (default):** the app is ad-hoc signed by `scripts/after-pack.js`. That is enough to run it on your own Mac. On first launch, right-click → **Open**, or run `xattr -cr /Applications/Open-Cluely.app`.
- **With a Developer ID certificate:** set `CSC_LINK` + `CSC_KEY_PASSWORD` (or `CSC_NAME` for a keychain identity) before building. For notarization, also set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

### Permissions in the packaged app

On first use, macOS prompts for **Microphone**, and Screenshots / Host audio need **Screen & System Audio Recording**. Grant them in System Settings → Privacy & Security, then relaunch the app. The usage strings live in `package.json → build.mac.extendInfo`.

The packaged Mac app runs as an accessory app with no Dock icon. Use the global shortcuts (Option+Shift+…) to show or hide it.

## Linux (best effort)

```bash
npm run build:linux
```

Output: `dist/Open-Cluely-1.0.0.AppImage`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module 'electron-builder'` | `npm install` |
| macOS: "app is damaged and can't be opened" | `xattr -cr /Applications/Open-Cluely.app` |
| macOS: Host audio shows no transcript | Grant Screen & System Audio Recording, relaunch; requires macOS 13+ |
| Windows: build fails with symlink error | Enable Developer Mode or use an elevated terminal |
| App starts but nothing is visible | It may have started hidden: press the show/hide shortcut (`Alt+Shift+H` by default, see `src/config.js`) |
