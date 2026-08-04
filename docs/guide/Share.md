# Share

**More → Share** exposes a local site to the internet via Cloudflare.

## Quick tunnel

1. Ensure the site exists under **Projects**.
2. On Share, click **Share publicly** for that site.
3. Copy the temporary `*.trycloudflare.com` URL.
4. **Stop share** when finished.

CLI:

```bash
devtent share myapp
# Ctrl+C to stop
```

## Named tunnels (stable hostname)

1. **Cloudflare login** (once).
2. **Create tunnel…**
3. **Configure** with a local site name and a hostname on your Cloudflare zone.
4. **Start** the tunnel.

```bash
devtent share login
devtent share named create demo
devtent share named configure demo --site myapp --hostname app.example.com
devtent share named start demo
```

`cloudflared` is installed on first use if missing.

Next: **[Settings](Settings.md)**
