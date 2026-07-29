# Code signing (free options)

DevTent is free and open source. This document covers **no-cost** signing paths only.
Paid Authenticode certificates and the Apple Developer Program ($99/yr for notarization) are **not required**.

## Windows — SignPath Foundation (recommended, free for OSS)

[SignPath Foundation](https://signpath.org/) provides free code signing for open-source projects:
the private key stays on their HSM, and binaries are tied to your GitHub repository.

### Setup

1. Apply at [signpath.org](https://signpath.org/) for the DevTent repository
2. Create a SignPath project + artifact configuration for the NSIS installer (`.exe`)
3. Add GitHub Actions secrets:

| Secret | Description |
| --- | --- |
| `SIGNPATH_API_TOKEN` | API token from SignPath |
| `SIGNPATH_ORGANIZATION_ID` | Organization UUID |
| `SIGNPATH_PROJECT_SLUG` | Project slug |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Policy slug (often `test-signing` or `release-signing`) |

When these secrets are present, the [release workflow](../.github/workflows/release.yml) can detect them
and skip or enable SignPath signing without failing the build. Wire the
[`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request)
action after your SignPath project is approved. When secrets are absent, the release stays unsigned.

### Without SignPath (unsigned)

- Installer welcome/finish pages explain **More info → Run anyway** when SmartScreen appears
- Prefer downloads only from [GitHub Releases](https://github.com/DubStepMad/devtent/releases)
- SmartScreen reputation improves as more people run the same binary from the same URL

## Windows — optional paid CSC (not free)

If you already have a `.pfx` (paid CA), you can still set:

| Secret | Description |
| --- | --- |
| `WINDOWS_CODE_SIGNING_CERT` | Base64-encoded `.pfx` |
| `WINDOWS_CODE_SIGNING_PASSWORD` | Certificate password |

electron-builder uses `CSC_LINK` / `CSC_KEY_PASSWORD`. This is optional and separate from SignPath.

## macOS — free / ad-hoc (no Apple Developer account)

Apple **notarization requires a paid Apple Developer Program membership**. Free options:

1. **Unsigned / ad-hoc builds (default in CI)** — `CSC_IDENTITY_AUTO_DISCOVERY=false` and `"identity": null` in electron-builder. Gatekeeper will block first open.
2. **Open anyway (users)** — Right-click the app → **Open** → **Open**, or:
   ```bash
   xattr -dr com.apple.quarantine /Applications/DevTent.app
   ```
3. **Local ad-hoc sign (developers, free)** — no notarization, slightly clearer Gatekeeper messaging:
   ```bash
   codesign --force --deep --sign - "packages/desktop/release/mac-arm64/DevTent.app"
   ```

There is no free substitute for Apple notarization. Do not commit paid Apple certificates.

## Linux

AppImage and `.deb` builds are not Authenticode-signed. Verify checksums / GitHub release assets.
AppArmor/Gatekeeper equivalents vary by distro; no paid cert is required for DevTent Linux packages.

## Summary

| Platform | Free path |
| --- | --- |
| Windows | SignPath Foundation (OSS) or unsigned + SmartScreen guidance |
| macOS | Ad-hoc / unsigned + user “Open anyway” (no free notarization) |
| Linux | Unsigned packages from GitHub Releases |

`after-pack.cjs` still embeds the tent icon via rcedit when Windows Authenticode signing is skipped.
