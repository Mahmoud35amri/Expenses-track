# Spendly: expense tracker web app

A modern, installable web app (PWA) for iPhone that tracks your **daily** and **monthly** spending and groups it into three **tiers**:

| Tier | Meaning | Default categories |
|---|---|---|
| Essential | Needs | Groceries, Housing, Bills, Transport, Fuel, Health |
| Lifestyle | Wants | Dining, Coffee, Shopping, Entertainment, Subscriptions, Other |
| Luxury | Extras | Travel, Electronics, Gifts |

You can add, delete, or move categories between tiers in **Settings**, and set monthly budgets for the whole month or for each tier.

There is no server and no account. Your data stays on your phone, and the app works offline. You can export a CSV or a JSON backup from Settings.

## Double-tap the back of your iPhone to add an expense

1. Open **Shortcuts**, tap **+**, and add the **Open URLs** action with `https://<your-site>/#add`. Name the shortcut **Add Expense**.
2. Go to **Settings → Accessibility → Touch → Back Tap → Double Tap** and choose **Add Expense**.
3. Double-tap the back of the phone. The amount keypad and category picker open right away. Tap the amount, pick a category, then tap **Save**.

> iOS opens shortcut URLs in **Safari**, and Safari keeps its data separately from Home Screen web apps. To keep all your expenses in one place, use Spendly in Safari. When you add it to the Home Screen, turn **Open as Web App** off (iOS 26 and later) so the icon also opens in Safari.

**Save without opening the form:** `https://<your-site>/#add?amount=4.5&cat=coffee&note=latte` saves the expense instantly. Inside a shortcut, you can use *Ask for Input* and *Choose from Menu* to fill in these values.

## Deploy on Cloudflare Pages

**Option A: dashboard (easiest).** In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo. Leave the build command empty and set the output directory to `/`. Your link will be `https://<project>.pages.dev`.

**Option B: GitHub Action.** Add the repo secrets `CLOUDFLARE_API_TOKEN` (with the *Cloudflare Pages: Edit* permission) and `CLOUDFLARE_ACCOUNT_ID`. Create a Pages project named `spendly` (Direct Upload). After that, every push to `main` deploys to `https://spendly.pages.dev`.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
