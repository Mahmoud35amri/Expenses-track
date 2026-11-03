# Spendly: expense tracker web app

A modern, installable web app (PWA) for iPhone that tracks your **daily** and **monthly** spending and groups it into three **tiers**:

| Tier | Meaning | Default categories |
|---|---|---|
| Essential | Needs | Groceries, Housing, Bills, Transport, Fuel, Health |
| Lifestyle | Wants | Dining, Coffee, Shopping, Entertainment, Subscriptions, Other |
| Luxury | Extras | Travel, Electronics, Gifts |

Amounts are in **Tunisian dinars (TND)** with 3 decimals (millimes); you can change the currency in Settings. You can add, delete, or move categories between tiers in **Settings**, and set monthly budgets for the whole month or for each tier.

There is no server and no account. Your data stays on your phone, and the app works offline. You can export a CSV or a JSON backup from Settings.

**Live app:** https://mahmoud35amri.github.io/Expenses-track/

## Double-tap the back of your iPhone to add an expense

1. Open **Shortcuts**, tap **+**, and add the **Open URLs** action with `https://<your-site>/#add`. Name the shortcut **Add Expense**.
2. Go to **Settings → Accessibility → Touch → Back Tap → Double Tap** and choose **Add Expense**.
3. Double-tap the back of the phone. The amount keypad and category picker open right away. Tap the amount, pick a category, then tap **Save**.

> iOS opens shortcut URLs in **Safari**, and Safari keeps its data separately from Home Screen web apps. To keep all your expenses in one place, use Spendly in Safari. When you add it to the Home Screen, turn **Open as Web App** off (iOS 26 and later) so the icon also opens in Safari.

**Save without opening the form:** `https://<your-site>/#add?amount=4.500&cat=coffee&note=latte` saves the expense instantly. Inside a shortcut, you can use *Ask for Input* and *Choose from Menu* to fill in these values.

## iPhone widget

iOS doesn't allow widgets for web apps, so Spendly's widget runs in the free **Scriptable** app. It reads your synced expenses and never changes them.

| Size | Shows |
|---|---|
| Small | Today's total, this month's total, and budget left (if you set a monthly budget) |
| Medium | The same, plus this month split by tier and an **+ Add** button |
| Large | The same, plus your latest 5 expenses (4 when a monthly budget is set) |
| Lock Screen | Today's and this month's totals |

1. Install **Scriptable** from the App Store.
2. On the iPhone, open https://mahmoud35amri.github.io/Expenses-track/widget/spendly-widget.js, then long-press the text, tap **Select All**, and **Copy**. In Scriptable, tap **+**, paste, and name the script **Spendly**.
3. In Spendly, tap **Settings → Copy link for another device**. In Scriptable, run the **Spendly** script and paste the link. Use **Preview** to see each size.
4. Long-press the Home Screen, tap **Edit → Add Widget → Scriptable**, choose a size, and add it. Then long-press the widget, tap **Edit Widget**, and set **Script** to **Spendly**.

The widget refreshes about every 15 minutes (iOS picks the exact time). Tapping it opens Spendly in Safari. When the phone is offline, it shows the last data it downloaded and says "offline". To check the widget code: `node widget/widget.test.js`.

## Offline-first cloud sync

Every change is saved on the phone first, so the app works with no internet. Changes go into a queue (the cloud badge in the header shows how many are waiting). When the phone is back online, the queue uploads to a private **Cloudflare D1** database and changes made on other devices download.

- **Conflicts:** the most recent edit wins. Deletions sync too.
- **Privacy:** each install gets a random sync key, and the server only stores a SHA-256 hash of it. *Settings → Copy link for another device* links a second phone or computer to the same data.
- **Server code:** `functions/api/sync.js` (Cloudflare Pages Function), `schema.sql` (D1 tables), `wrangler.toml`.

### Deploying

Live at `https://spendly-m35a.pages.dev` (D1 `spendly-db`, id in `wrangler.toml`). To redeploy by hand after changes:

```sh
mkdir -p dist && cp -r index.html styles.css app.js icons.js sw.js manifest.webmanifest _headers icons dist/
npx wrangler login
npx wrangler d1 execute spendly-db --remote --file=schema.sql   # only when schema.sql changes
npx wrangler pages deploy --branch=main
```

To deploy automatically on every push to `main` instead:

1. In Cloudflare, go to **My Profile → API Tokens → Create Token → Create Custom Token**. Add the permissions **Account · Cloudflare Pages · Edit** and **Account · D1 · Edit**, then create the token.
2. Copy your **Account ID** from the right side of **Workers & Pages → Overview**.
3. In GitHub, open this repo's **Settings → Secrets and variables → Actions** and add two secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Open **Actions → Deploy to Cloudflare → Run workflow**, or push to `main`.

The workflow reuses the existing D1 database and Pages project (creating them if missing), applies the schema, deploys the app and API to `https://spendly-m35a.pages.dev`, and checks that `/api/health` responds. The GitHub Pages copy syncs to that same API.

## Run locally

```sh
mkdir -p dist && cp -r index.html styles.css app.js icons.js sw.js manifest.webmanifest _headers icons dist/
npx wrangler d1 execute spendly-db --local --file=schema.sql
npx wrangler pages dev          # app + API + local D1 on http://localhost:8788
```
