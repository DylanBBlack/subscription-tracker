SUBSCRIPTION TRACKER — PRIVATE LOCAL PWA

See README.md for the current setup, tests, encrypted backup format and update process.

Bills are encrypted locally with a six-digit PIN. Each phone/browser stores its own data. Export backup produces encrypted v2 JSON; restoring requires the same PIN. Keep your PIN and backups safe.

Use the current repository source files, not the older ZIP archive. Run npm run prepare:update after changing shell assets or worker logic, then npm run check and npm test before committing.

PWA updates offer an Update now button. Save or cancel edits before updating. Do not clear website data or reset your PIN to update: doing so can erase the vault.
