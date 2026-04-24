# `landing/` — GitHub Pages source

Single-file static landing page. **No bundler, no framework, no build step.**

```text
landing/
├── index.html      # the whole page (HTML + CSS + a tiny mermaid script tag)
├── og-card.svg     # Open Graph / Twitter card preview, 1200x630
└── README.md       # you are here
```

## Edit / preview locally

```bash
# any static server works
npx serve landing
# -> http://localhost:3000
```

Or just `open landing/index.html` — the only network dep is `mermaid` from
jsDelivr, which works offline if cached.

## Deployment

The page is shipped to **GitHub Pages** via
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml).
The workflow:

1. Triggers on every push to `main` that touches `landing/**` (or manually
   via `workflow_dispatch`).
2. Uploads `landing/` as a Pages artifact using the official
   `actions/upload-pages-artifact` action.
3. Deploys via `actions/deploy-pages`.

### One-time repo setup

Open the repo on GitHub → **Settings → Pages** → **Source: GitHub Actions**.
That's it; no `gh-pages` branch needed.

The site will publish at:
`https://ricardo-m-l.github.io/openhand/`

Update the `og:url` in `index.html` if you change the deployment URL.

## Why a separate static page?

`apps/web` is a full React SPA (SSE-aware Tasks page, settings, chat). It's
the right tool when you need *the product*, not when someone is just trying
to decide whether to give the project 5 minutes. The landing page is:

- **Fast.** One HTML round-trip, no JS bundle.
- **Crawlable.** All copy is in static markup; OG card is a real SVG.
- **Cheap to host.** GitHub Pages, free tier, sub-second.
- **Easy to fork.** One file. Designers can iterate without touching React.
