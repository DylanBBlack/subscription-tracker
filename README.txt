SUBSCRIPTION TRACKER — PRIVATE LOCAL PWA

Host these files together on any static HTTPS hosting service (for example, GitHub Pages or Cloudflare Pages). Open the hosted URL in Safari on each iPhone, tap Share > Add to Home Screen.

Each device has independent localStorage data. No account, server-side database, analytics, or bank connection. The app does not transmit subscription records. Export JSON backups regularly using the Export backup button. Backups are plain text and should be stored securely.

Payment completion is inferred after the due date, or manually overridden. No bank verification. The current version has no push notifications or password/encryption at rest. Device/browser storage can be lost. Use a trusted HTTPS host. For stronger privacy, future releases can implement passphrase-based encryption, but recovery would then depend on keeping the passphrase.

To update: replace hosted files, increment CACHE in sw.js and redeploy.
