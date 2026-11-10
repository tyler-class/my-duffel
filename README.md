# Duffel

Packing for a family trip is a group project that usually lives in one person's head. Duffel is a calm, shared packing list that gets it out of there. Plan what everyone needs once, let quantities scale with the length of the trip, have items land in the right bags, and tick things off together from your phones.

The rest of the trip lives there too. To-dos cover everything that isn't packing, like dropping the dog at the sitter or renewing a passport in time, with dates that move when the trip does. The itinerary keeps flights, stays and reservations in order, and with the built-in MCP server your AI assistant can pull them straight out of your confirmation emails and drop them in for you.

Next time, copy the last trip and start from a list that already knows your family. It's built for households with kids, gear and more than one carry-on - the trips where a forgotten diaper bag is a real problem, not an inconvenience.

[![Deploy to Cloudflare](docs/deploy-to-cloudflare.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/tyler-class/Duffel)

![Duffel on a laptop and a phone: a trip's packing list grouped by person, and its itinerary](docs/screenshots/hero.png)

- **Per-person lists.** Every item belongs to someone (or is shared), with quantities that scale with trip length: “1 T-shirt per day, at most 7”. Set a custom number any time and it stays put.
- **Bags.** Bags belong to people (or are shared), and items land in the right one automatically. Carry-on is a property of the bag, so the carry-on view is always right. **Auto pack** sends an item to a type of bag: diapers into its person’s diaper bag, snacks into the cooler. Car seats and strollers go under “No bag”.
- **Groups.** Items sit under groups like Clothing, Documents or Food & drink, on every person and bag. Drag items and whole groups into the order you pack them (long-press on a phone).
- **To-dos.** Things to do before, during and after a trip, like booking the pet sitter. Give one a fixed date, or a relative one such as “3 days before the trip starts” that moves when the trip’s dates do. The trip’s bar tracks packing and pre-trip to-dos together, and once you’re away the trip opens on its to-dos.
- **Itinerary.** Each trip’s plan in order: travel sections (“Getting there”, “Lisbon → Porto”) and stays. Add flights, trains, buses, boats and drives with their departure and arrival, plus lodging, reservations and notes with booking numbers. Times are local, as on the ticket; type an airport code and the city and time zone fill in, and flight times and layovers are worked out across time zones. New entries go where their time falls; drag entries and sections to rearrange them, and connecting flights always stay back to back. Print turns the itinerary into a PDF: share it from your phone (print, save, AirDrop, email) or open it on a computer. Itineraries stay with their trip and aren’t copied.
- **Templates and past trips.** Start a trip from a template, copy last year’s trip (everything starts unpacked and undone), or save any trip as a new template. Lists, groups, bags and to-dos come along.
- **Built for phones.** Install it to your home screen. The last trip you opened works offline, and check-offs sync when you’re back online.
- **Pack together.** Everyone in the household signs in with one shared password and sees changes within seconds.
- **AI assistants.** Connect Claude, ChatGPT or any MCP-capable assistant and ask it to build or update your lists, groups, to-dos and itineraries. Connect your email to the same assistant and it can add bookings from confirmation emails.
- **Yours.** It runs on your own Cloudflare account. The free plan is plenty. Your data stays in your database.

![Three phone screens from one trip: the packing list by bag, the to-dos, and the itinerary](docs/screenshots/features.png)

**Ask your assistant, typed or out loud.** It builds a trip from your template, adds bookings from your confirmation emails, and tells you what's still not packed.

![An AI assistant connected to Duffel: on a laptop it creates a family trip to Tulum from a template, adds to-dos and pulls the flights and hotel into the itinerary; on a phone it answers when the flight leaves and what's still not packed](docs/screenshots/ai-chat.png)

One deployment is one household.

## A look around

**Packing.** Edit an item, select several at once, or filter to what’s left.

![Three phone screens: the Edit item sheet with a per-day quantity, three items selected with Move to bag, and the Filter sheet set to To pack](docs/screenshots/packing.png)

**Bags.** See how full each bag is, set a bag’s owner, type and capacity, and choose how Auto pack works.

![Three phone screens: a trip's bags with how full each one is, the Edit bag sheet, and Settings with Appearance, Auto pack and Notifications](docs/screenshots/bags.png)

**To-dos and itinerary.** A to-do dated relative to the trip, a flight across time zones, and a stay.

![Three phone screens: a to-do set to 10 days before the trip starts, a flight from Boston to Lisbon with each airport's time zone, and a lodging booking](docs/screenshots/plan.png)

![A trip's itinerary on a computer in dark mode: the flight, the stay and the day's plans](docs/screenshots/itinerary-desktop-dark.png)

**New trips and templates.** Copy a past trip or start from a template, with its bags, items and to-dos.

![Two phone screens: New trip copying a past trip, and a template's pre-trip, during and after to-dos](docs/screenshots/new-trip.png)

![A template's bags and items on a computer, with a note on items that won't have a bag](docs/screenshots/template-desktop.png)

**Catalog and people.** Everything you own, how many to bring, and who’s in the family.

![Three phone screens: the catalog grouped by category, a T-shirt set to 1 per day at most 7, and the Edit person sheet](docs/screenshots/catalog.png)

<!-- kit:readme:start -->
<!-- Written by the Selfhost Kit (kit/docs/readme-install.md): edit it there. -->

## Install

You need two free accounts, and about five minutes.

### 1. Have a Cloudflare account

Duffel runs on your own Cloudflare account. The free plan is plenty. If you don't have one, [sign up](https://dash.cloudflare.com/sign-up) and confirm your email.

<!-- 📸 SCREENSHOT docs/screenshots/install-1-cloudflare-signup.png: Cloudflare's sign-up page -->

### 2. Have a GitHub account

The Deploy button makes your own copy of Duffel's code in your GitHub account, so you can keep it updated. If you don't have one, [sign up](https://github.com/signup).

### 3. Let Cloudflare use your GitHub

Cloudflare needs its **Cloudflare Workers and Pages** app installed on your GitHub account to create your copy and deploy it.

1. Open [github.com/apps/cloudflare-workers-and-pages](https://github.com/apps/cloudflare-workers-and-pages) and click **Install** (or **Configure** if it's already installed).
2. Choose your account.
3. Pick **All repositories**. That's simplest, because the Deploy button creates a new one. If you'd rather limit it, choose **Only select repositories** and come back to add your Duffel copy after step 4.
4. Click **Install**.

<!-- 📸 SCREENSHOT docs/screenshots/install-3-github-app.png: GitHub's install page for Cloudflare Workers and Pages, with All repositories selected -->

You can also do this in the middle of the next step: Cloudflare asks you to connect GitHub if you haven't.

### 4. Click Deploy

[![Deploy to Cloudflare](docs/deploy-to-cloudflare.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/tyler-class/Duffel)

Sign in to Cloudflare if it asks. You land on a setup page.

<!-- 📸 SCREENSHOT docs/screenshots/install-4-deploy-page.png: Cloudflare's "Create an application" page for Duffel -->

### 5. Check the names (most people keep the defaults)

- **Git account**: your GitHub account.
- **Repository name**: what your copy is called on GitHub. Leave **Create private Git repository** ticked to keep it private.
- **Project name**: the Worker's name, which is also in your address: `https://duffel.<your-subdomain>.workers.dev`.
- **Database and storage names**: what Cloudflare calls the storage it creates for you. Keep them.

### 6. Set your password

Under **Variables and secrets**, fill in **APP_PASSWORD**: the one password everyone in your household uses to sign in. Pick something long. You can change it later (see [Change your password](#change-your-password)), but set it now.

<!-- 📸 SCREENSHOT docs/screenshots/install-6-password.png: The APP_PASSWORD field on the setup page -->

### 7. Create and deploy

Click **Create and deploy**. Cloudflare copies the code to your GitHub, creates the storage and builds Duffel. It takes a minute or two. When the build log finishes, your address is at the end of it, and on the Worker's page under **Domains**.

<!-- 📸 SCREENSHOT docs/screenshots/install-7-build-done.png: A finished build log with the workers.dev address at the end -->

Open it, sign in with your password, and you're done. Bookmark it, or add it to your phone's home screen.

![Duffel right after signing in](docs/screenshots/install-7-signed-in.png)

### 8. Set up automatic updates (recommended)

Your copy updates itself every Monday once you allow it. That takes one click, once:

1. In Duffel, open **Settings → Updates** and choose **Set up automatic updates**.
2. GitHub opens with the update file filled in. Click **Commit changes**.

That brings in the latest Duffel straight away, then every week. See [Updates](#updates) for how it works.

![Settings → Updates with the Set up automatic updates button](docs/screenshots/install-8-updates.png)
<!-- 📸 SCREENSHOT docs/screenshots/install-8-commit.png: GitHub's new-file page with the update file filled in, and the Commit changes button -->

## Notifications

Duffel can send notifications to your phone. They only work in the app installed on your phone (added to your Home Screen), not in a browser tab.

**Install it on iPhone or iPad** (iOS 16.4 or later):

1. Open Duffel in Safari and tap **Share**.
2. Tap **Add to Home Screen**, then **Add**.
3. Open Duffel from the new Home Screen icon.

**Install it on Android:** open Duffel in Chrome, open the menu **⋮** and tap **Install app** (or **Add to Home screen**), then open it from the new icon.

**Turn them on:** in the installed app, open **Settings → Notifications** and switch on **Notifications on this device**. Allow notifications when your phone asks. Each phone chooses its own, so everyone in the family can pick what they get. **Send a test** checks it's working.

## Updates

Updates take two steps, both in your own accounts. Duffel never deploys to your Cloudflare directly.

1. **Duffel → your GitHub copy.** The update workflow you added in step 8 brings in the latest code every Monday. To update now, open **Settings → Updates → Update now** and click **Run workflow** on GitHub. Settings also tells you when a newer version is out.
2. **Your GitHub copy → your Cloudflare.** Cloudflare builds and deploys every change to your copy, migrating the database first. This was switched on in step 7.

Your data lives in your Cloudflare database, not in the code, so updates don't touch it. An update replaces the code in your copy, so changes you made to it are overwritten. Your copy's own name and storage settings are kept.

Deployed by hand instead? `git pull`, then `npm run deploy`.

## Change your password

1. In Cloudflare, open **Compute → Workers & Pages** and choose **duffel**.
2. Open the **Settings** tab. Under **Variables and Secrets**, find **APP_PASSWORD** (type **Secret**) and click its pencil icon.
3. Type the new password and save. You can't see the current one, only set a new one.

Everyone is signed out and signs in again with the new password.

<!-- 📸 SCREENSHOT docs/screenshots/password-1-secrets.png: The Variables and Secrets list with APP_PASSWORD and its pencil icon -->

## Use your own domain (advanced)

Your address starts as `https://duffel.<your-subdomain>.workers.dev`. Two ways to change it:

- **Rename your workers.dev subdomain.** In Cloudflare, open **Compute → Workers & Pages**. Your subdomain is shown on the right, with **Change**. It applies to every Worker in your account, so all your apps move together.
- **Give Duffel its own address on a domain you own**, like `duffel.example.com`. The domain has to be on Cloudflare. Open the Worker, go to **Settings → Domains & Routes → Add → Custom domain**, and enter the address. Cloudflare sets up DNS and the certificate. Repeat for each app to give each one its own subdomain.

<!-- 📸 SCREENSHOT docs/screenshots/domain-1-custom-domain.png: Settings → Domains & Routes → Add → Custom domain -->

If you connected an AI assistant, connect it again with the new address.

## Anonymous usage counts

Once a day your copy tells Duffel's developer that it exists: a random id it made for itself, its version, how many trips, items, bags and to-dos it has (counts only), and whether automatic updates are on. Never names, contents or anything you type, and no IP address is kept. It shows how many copies are in use. Turn it off in **Settings → Updates → Share anonymous usage counts**: your copy sends one last message saying it's off, then nothing.

<!-- kit:readme:end -->

## Use it on your phone

Open your Duffel link on the phone, then:

- **iPhone:** in Safari, tap Share, then **Add to Home Screen**.
- **Android:** in Chrome, open the menu and tap **Install app**.

It opens full screen like a regular app, and follows your phone's light or dark setting.

![Duffel on a phone in dark mode: a trip's packing list](docs/screenshots/phone-dark.png)

Each phone picks its own notifications in **Settings → Notifications**. Press and drag along the tab bar to switch tabs.

![Two phone screens: Settings → Notifications switched on for this device, and the glass tab bar mid-drag](docs/screenshots/phone-notifications.png)

## Connect an AI assistant

Duffel includes an [MCP](https://modelcontextprotocol.io) server at `https://<your-duffel>/mcp`. In Duffel, open **Settings → Connect an AI assistant** to copy your URL and see steps for Claude, ChatGPT, Claude Code and others. When an assistant connects, Duffel shows a sign-in page; enter your household password to approve it. **Settings → Connect an AI assistant → Disconnect all** revokes every connected assistant.

![Settings → Connect an AI assistant, with the connector URL and set-up steps for Claude, ChatGPT and other apps](docs/screenshots/ai-assistant.png)

Assistants can read and change trips, packing lists, groups, templates, to-dos and itineraries. Ask one “what can you do with Duffel?” and it calls `get_started`, which looks at your trips and suggests things to ask, such as:

- “Make a packing list for our trip to \<place>, \<start date> to \<end date>, from our \<template> template.”
- “What’s still not packed for \<trip>? Group it by person.”
- “Add to-dos for \<trip>: book the pet sitter two weeks before, hold the mail, and check in online the day before we leave.”

Ready-made prompts for longer jobs appear in the assistant’s prompt menu (the + menu in Claude): **Plan a trip**, **What’s left to pack**, **Add the usual to-dos**, **Add bookings to the itinerary** and **Organize into groups**. Settings lists more examples under **Try asking**, tap one to copy it.

## Back up and restore

**Settings → Backup → Download backup** saves everything as one JSON file. **Restore from backup** replaces everything with a backup’s contents. Use it to move to a new deployment, too.

![Settings → Backup, with Download backup and Restore from backup](docs/screenshots/backup.png)

## Deploy by hand

If you’d rather not use the button, or want to work on the code:

```sh
git clone https://github.com/tyler-class/Duffel.git && cd Duffel
npm install
npx wrangler login
npx wrangler secret put APP_PASSWORD
npm run deploy
```

`npm run deploy` builds the app, applies migrations to the remote database and deploys the Worker. Wrangler creates the D1 database and KV namespace on the first deploy and writes their ids into `wrangler.jsonc`. If your Wrangler version asks you to create them yourself, run `npx wrangler d1 create duffel` and `npx wrangler kv namespace create OAUTH_KV`, then add the ids it prints.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars    # then set APP_PASSWORD
npm run db:migrate:local
npm run db:seed:sample:local      # optional: a sample household
npm run dev
```

| Script                       | What it does                                       |
| ---------------------------- | -------------------------------------------------- |
| `npm run dev`                | Vite dev server with the Worker running in workerd |
| `npm run build` / `preview`  | Production build / serve the build locally         |
| `npm test`                   | Unit tests and Workers-runtime API tests (Vitest)  |
| `npm run typecheck` / `lint` | TypeScript, ESLint and Prettier                    |
| `npm run deploy`             | Build, migrate the remote database, deploy         |
| `npm run db:migrate:local`   | Apply migrations to the local database             |
| `npm run db:migrate:remote`  | Apply migrations to the deployed database          |

### How it’s built

- **Cloudflare Workers** with static assets. **Hono** serves the API under `/api`, and **D1** (SQLite) stores everything. SQL migrations live in `migrations/`.
- **React**, **TypeScript**, **Vite**, **Tailwind CSS**, **TanStack Query** and **React Router**, with a service worker from `vite-plugin-pwa`.
- `src/shared` holds the packing logic (quantities, building trips from templates, copying trips, bag fit), used by both the Worker and the app and covered by unit tests.
- Sign-in uses one password per instance: a signed, HttpOnly session cookie, rate-limited attempts, and sessions that end when the password changes.
- AI assistants connect over MCP with OAuth 2.1 (`@cloudflare/workers-oauth-provider`). Tokens are stored in KV.

See [docs/](docs) for importing from Airtable and other notes.

## Support

Duffel is free and built by [Tyler Class](https://tylerclass.net). If you want to say thank you, coffee is my love language: [ko-fi.com/tylerclass](https://ko-fi.com/tylerclass) ☕

## License

[MIT](LICENSE)

Airport data comes from [OurAirports](https://ourairports.com/data/) (public domain) and [mwgg/Airports](https://github.com/mwgg/Airports) (MIT). Refresh it with `npm run airports`.
