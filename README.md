# Subscription Tracker

A static, responsive iPhone PWA with a six-digit PIN and encrypted local bill storage. Each browser or phone keeps its own data; there is no server account or sync. Open Settings to add bills, import CSV, export or restore an encrypted backup, and choose a theme. Forest & slate is the default; Sage & graphite, Emerald & charcoal, and Olive & stone are also available. Each phone remembers its own theme, font and calendar visibility, including the font on the PIN screen. Settings offers System, Manrope and Lora fonts and a Show payment calendar toggle (on by default). No personal bills are bundled or automatically seeded.

Amounts are stored in integer pence. Monthly and annual totals come from saved records, including records without payment dates. Weekly, quarterly and yearly amounts use annual equivalents; rounding happens once for the monthly average. Blank dates remain blank until entered. Use **Set date**, **Edit** or **Delete** to manage each record. Existing records are never automatically deduplicated or removed. CSV import skips names already saved or repeated in the file (ignoring case and surrounding spaces).

Data uses the existing `bills-encrypted-v2` localStorage key and v2 AES-GCM/PBKDF2 format. Legacy `private-subscriptions-v1` records migrate on PIN setup. Export backup produces encrypted JSON; restore requires the same PIN and confirmation before replacing this phone's records. Keep backups and your PIN safe. Clearing website data loses the local vault; updating the PWA does not require clearing data or resetting the PIN.

Payments this month is a collapsible bar, closed by default. Tap Unpaid this month to open an interactive dialog of unpaid scheduled occurrences in the current calendar month, including overdue ones; next month and later are excluded. Ticking a payment removes it from that dialog and updates the unpaid total. Edit returns to the dialog after save or cancel. Needs payment date appears only when at least one bill is missing its date. Payments this month shows each scheduled occurrence, including automatically ticked past payments. Paid payments remain visible in Payments this month and history. Automatic completion happens after the scheduled date; today and future dates remain due. Manual mode and explicit paid/unpaid overrides take priority. The calendar and history reflect these schedules, not verified bank transactions.

## Development and validation

Requires Node.js 22+ and Chromium or Google Chrome. There are no npm dependencies to install. Set `CHROMIUM` to the browser executable if it is not named `chromium`.

```sh
npm run prepare:update
npm run check
npm test
```

The tests launch a real headless browser against a temporary local HTTP server with isolated profiles and synthetic data. They cover integer calculations, blank-date rendering, extra records, editing and deletion, completion/calendar/history, CSV duplicate handling, v2 encryption compatibility, legacy migration, PIN rejection, restore, device isolation, update notification/consent and offline reopening. CI runs validation on pull requests without deploying.

## Static hosting and updates

Host `index.html`, `styles.css`, `themes.js`, `app.js`, `updates.js`, `sw.js`, `manifest.webmanifest` and `icon.svg` together over HTTPS. Open in iPhone Safari, then Share → Add to Home Screen. The older ZIP in repository history is not the maintained source; use the current files.

After changing any shell asset or worker logic, run `npm run prepare:update` and commit the generated `sw.js` revision. `npm run check` fails if the revision is stale. The worker precaches a complete release and keeps it available offline, bypassing HTTP caches during installation. Registration uses `updateViaCache: 'none'` and checks on launch, focus, returning to the foreground, and hourly while visible.

A replacement waits and displays **An app update is available** with **Update now**. Save or cancel any open edit first. The button also supports older cached app code, observes worker activation directly if controllerchange is missed, and offers Retry update after a failed or stalled attempt. Updating activates the waiting worker and reloads this window; it does not alter localStorage, your PIN or encrypted backups. Only this app's old shell caches are removed. On the first upgrade from an older installation, open the PWA online so it can receive the new update code. Do not clear Safari website data to update.

Merge and deployment are separate from validation. Review the pull request before merging; merging to the GitHub Pages source branch may publish the site.

## Bundled fonts

Manrope and Lora are variable fonts bundled locally for offline use; the running app does not fetch fonts from third-party services. Sources: [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope) and [Lora](https://github.com/google/fonts/tree/main/ofl/lora). Their SIL Open Font License files are in `fonts/`. Include the `fonts/` directory when hosting the app.
