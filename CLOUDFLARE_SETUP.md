# Cloudflare Backend Setup

This app can use a very small Cloudflare backend:

- R2 stores the shared `catalog.json`.
- KV stores the shared saved-parts list.
- Worker exposes `/catalog` and `/saved`.
- Admin catalog upload is protected by password `000007`.

## 1. Log in to Cloudflare

```powershell
npx wrangler login
```

## 2. Create storage

```powershell
npx wrangler r2 bucket create inventory-parts-catalog
npx wrangler kv namespace create SAVED_KV
```

Copy `cloudflare-worker/wrangler.toml.example` to:

```text
cloudflare-worker/wrangler.toml
```

Paste the KV namespace `id` into `wrangler.toml`.

## 3. Deploy the Worker

```powershell
npm run cf:deploy
```

Cloudflare will print a Worker URL like:

```text
https://inventory-parts-api.your-subdomain.workers.dev
```

## 4. Connect Vercel to Cloudflare

In Vercel project settings, add this environment variable:

```text
VITE_API_BASE=https://inventory-parts-api.your-subdomain.workers.dev
```

Redeploy Vercel after adding the variable.

## 5. Upload catalog

Open the app, tap the upload/admin icon, enter:

```text
000007
```

Upload the Excel file. The catalog will be saved to Cloudflare R2 and will be shared for all users.

Saved parts are stored in Cloudflare KV and shared for all users.
