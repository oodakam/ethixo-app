# Ethixo — MVP (test build)

## What's in this folder
- `index.html` — the whole app (frontend). Static file, no build step needed.
- `api/feedback.js` — a Vercel serverless function. Calls the Anthropic API server-side, using the secret key from an Environment Variable. The key is never sent to the browser.
- `package.json` — lets Vercel recognise this as a Node project.

## Data note
All lesson/question content is placeholder/dummy data (see `index.html`, the `LEVELS` object). Student progress and ScholarVault entries are stored in the browser's `localStorage` — per-device only, no account system or shared database yet. This is intentional for this MVP stage.

## Deploy steps (GitHub + Vercel, no command line needed)

1. **Create a GitHub account** at github.com if you don't have one (free).
2. **Create a new repository** (e.g. `ethixo-app`). Public or private, either works.
3. On the repo page, click **"Add file" → "Upload files"**, then drag in all files from this folder (keep the `api` folder structure — GitHub will preserve it). Commit.
4. Go to **vercel.com**, sign in (you can sign in with your GitHub account directly).
5. Click **"Add New..." → "Project"**, then **Import** the `ethixo-app` repository.
6. Before clicking Deploy, open **"Environment Variables"** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: (your Anthropic API key from platform.claude.com — starts with `sk-ant-`)
7. Click **Deploy**. Vercel will give you a URL like `ethixo-app-xxxx.vercel.app`.
8. Test it — go through the flow, submit an answer, confirm feedback comes back.
9. To connect `test.ethixo.ai`: in the Vercel project, go to **Settings → Domains**, add `test.ethixo.ai`, then add the DNS record it shows you into Hostinger's DNS settings for the `ethixo.ai` domain.

## Model used
`claude-sonnet-5` — Anthropic's current cost-efficient model, good fit for this kind of everyday writing-assessment task.
