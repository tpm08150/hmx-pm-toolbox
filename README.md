# HMX PM Toolbox — Web

Web replacement for the PM Toolbox Excel workbook. Phase 1 covers the
PM Check List, Show Info, and Day Sheets, backed by Firestore, with
event data pulled from Flex through the Anvil proxy.

## Stack

- React + Vite, deployed on Netlify
- Firestore for storage, Firebase Auth (Google) for sign-in
- Flex data via `pm_toolbox_proxy` in the `hmxlive-contract-creator` Anvil app

## First-time setup

### 1. Push to GitHub

```bash
cd pm-toolbox
git init
git add .
git commit -m "PM Toolbox phase 1"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/hmx-pm-toolbox.git
git push -u origin main
```

### 2. Connect Netlify

1. app.netlify.com → Add new site → Import an existing project
2. Connect to GitHub, pick the repo
3. Build command `npm run build`, publish directory `dist` (netlify.toml sets
   both, so the defaults should already be right)
4. Before the first deploy, add environment variables under
   Site configuration → Environment variables:

   | Key | Value |
   |---|---|
   | `VITE_ANVIL_BASE` | `https://hmxlive-contract-creator.anvil.app/_/api` |
   | `VITE_TOOLBOX_KEY` | the `toolbox_shared_secret` value from Anvil |

   Changing these later requires a redeploy — Vite bakes them in at build time.

### 3. Firebase console

**Authentication → Sign-in method** — enable Google.

**Authentication → Settings → Authorized domains** — add your Netlify domain,
or sign-in popups will be rejected.

**Firestore → Rules** — paste the contents of `firestore.rules` and publish.

**Firestore → Data** — create the first allowlist entry by hand, or nobody can
get in (including you):

- Collection `allowlist`, document ID = your email in lowercase
- Fields: `name` (string), `admin` (boolean, `true`)

Add a document per employee the same way. Set `admin: false` for PMs. To
revoke access, delete their document.

### 4. Local development

```bash
npm install
cp .env.example .env.local   # fill in the real key
npm run dev
```

## Notes

- **Editing** — one person at a time. The holder's browser refreshes the lock
  every 30 seconds; after two minutes of silence it goes stale and anyone can
  claim it. There's also a Take over button for the impatient case.
- **Saving** — automatic, about a second after you stop typing. The tab strip
  shows the state.
- **Status** — derived from the event dates and checklist progress. Nobody
  sets it by hand.
- **Sync from Flex** — pulls 30 days back through 24 months out in one
  request. Creates docs for events that don't have one; never overwrites
  PM-entered content. Time-off records, test documents, and zero-dollar
  entries are filtered out. Dry rentals ("OTD -") are kept.
- **Refresh from Flex** — on a single event, re-pulls the header and address
  data and overwrites the meta fields. Use it when a date or venue changes in
  Flex.

## Still to build

Expense sheet, xlsm import for historical toolboxes, dashboard, and the
Shiftboard and CRM integrations.
