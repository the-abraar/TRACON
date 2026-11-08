# Security

## Reporting a vulnerability

Please report it privately: on GitHub, open the **Security** tab of this repo and click **Report a vulnerability**. Don't open a public issue or pull request for it.

Say what you found, which version or commit, and the steps to reproduce. I aim to reply within a week. TRACON is maintained by one person, so a fix can take longer; you'll hear when one is planned and when it ships.

Supported: the latest release and `main`. Older betas get no fixes; upgrade instead.

## Trust model

TRACON runs as your own macOS user and trusts that user.

- The engine reads `~/.claude*` and `~/.gemini` and never writes there. It writes only under `~/.config/tracon` (`TRACON_STATE`). Only `tracon hooks install|uninstall`, when you run it, edits each profile's `settings.json`, with a backup.
- The engine listens on `127.0.0.1` only. State-changing requests need the local secret in `~/.config/tracon/secret` (mode 0600); the remote port needs a paired device token. See "Security" under Partner App in the README.
- Out of scope: a program that already runs as your user. It can read the same transcripts, the local secret and the device token, so TRACON can't defend against it. Anyone holding a pairing link counts as you too; `tracon pair --rotate` revokes every device.

## Verifying a download

Every release after `beta_0.1` has a `SHA256SUMS` file, and the zips are built by the `release-build` GitHub Actions workflow with signed build provenance. Check a download before you run it:

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
gh attestation verify tracon-macos-arm64.zip --repo the-abraar/TRACON
```

The binaries are not notarized by Apple yet. Prefer `brew install the-abraar/tap/tracon`, which checks the zip's sha256 for you.
