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

## Unsigned builds

- `after-pack.cjs` embeds the tent icon via rcedit when signing is skipped
- Installer welcome/finish pages explain **More info → Run anyway** for SmartScreen

## Reputation

Even unsigned builds gain SmartScreen reputation over time. Code signing is recommended for production distribution.
