# Code signing

DevTent release builds support **optional Authenticode signing** via electron-builder. When signing secrets are not configured, builds remain unsigned (SmartScreen may show "Windows protected your PC").

## CI / release signing

Add these GitHub repository secrets:

| Secret | Description |
|--------|-------------|
| `WINDOWS_CODE_SIGNING_CERT` | Base64-encoded `.pfx` certificate (or path — see electron-builder docs) |
| `WINDOWS_CODE_SIGNING_PASSWORD` | Certificate password |

The release workflow passes them as `CSC_LINK` and `CSC_KEY_PASSWORD`. electron-builder signs `DevTent.exe`, the NSIS installer, and the uninstaller when both are set.

## Local signed build

```powershell
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "your-password"
npm run dist
```

`packages/desktop/package.json` has `signAndEditExecutable: true`. Without `CSC_LINK`, electron-builder skips signing and still produces an installer.

## Unsigned builds (no budget for a cert?)

DevTent is **free and open source** — a standard Authenticode certificate often costs hundreds of dollars per year. Unsigned builds are normal for community projects.

What we do instead:

- Installer welcome/finish pages explain **More info → Run anyway** when SmartScreen appears
- Releases are published on **GitHub** with public source — you can verify what you are installing
- SmartScreen **reputation improves** as more people run the same signed-or-unsigned binary from the same URL over time

### If Windows blocks the installer

1. Click **More info** on the blue SmartScreen dialog
2. Click **Run anyway**
3. Prefer downloading only from [GitHub Releases](https://github.com/DubStepMad/devtent/releases) (not random mirrors)

### Optional: local signing later

When budget allows, use the CI secrets or local `CSC_LINK` flow above — no code changes required.

`after-pack.cjs` embeds the tent icon via rcedit when signing is skipped.
