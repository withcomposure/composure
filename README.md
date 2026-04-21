# 🐚 Composure

[![Tests](https://github.com/withcomposure/composure/actions/workflows/test.yml/badge.svg)](https://github.com/withcomposure/composure/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/withcomposure/composure/branch/main/graph/badge.svg)](https://codecov.io/gh/withcomposure/composure)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-green?logo=node.js)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/withcomposure/composure/pulls)

Composure is a self-hostable, collaborative editor for LaTeX, Typst, Markdown, and more.

## Getting Started

Full self-hosting docs are coming soon. In the meantime:
```bash
git clone https://github.com/withcomposure/composure
cd composure
docker compose -f docker-compose.yml -f docker-compose.db.yml up --build
```

### Deployment Modes

Composure supports three deployment styles:

1. Hetzner + external PostgreSQL (Neon, RDS, etc.)
   - Base compose file only.
```bash
docker compose up --build
```

2. Hetzner + external PostgreSQL + Cloudflare Pages frontend
   - Use the split override to build the API-only backend image target.
```bash
docker compose --env-file .env.split -f docker-compose.yml -f docker-compose.split.yml up --build
```

3. Self-host everything (local PostgreSQL + backend + frontend)
   - Add the DB overlay.
```bash
docker compose -f docker-compose.yml -f docker-compose.db.yml up --build
```

For split mode, copy `.env.split.example` to `.env.split` and set at least:
- `CORS_ORIGIN=https://your-app.pages.dev`
- `BACKEND_URL=https://api.yourdomain.com`
- `FRONTEND_URL=https://your-app.pages.dev`
- `API_BASE_PATH=/`
- `SERVE_FRONTEND=false`

Requires Node 24.

## Caddyfile Deployment Examples

The examples below use Caddy environment placeholders (for example `{$COMPOSURE_DOMAIN}`) so you can avoid hard-coded domains, ports, and upstream URLs.

### Shared Notes

- Caddy auto-handles websocket upgrades when using `reverse_proxy`, so no extra websocket directives are needed for collaboration.
- PostgreSQL is not HTTP and should not be proxied through Caddy. Keep it on a private network and expose only backend/frontend HTTP services.
- Keep `API_BASE_PATH` (backend) and `VITE_API_URL` (frontend) aligned.

### 1) Host Frontend + Backend + DB (single host, backend serves frontend)

Use this with:
- `docker compose -f docker-compose.yml -f docker-compose.db.yml up --build`
- `SERVE_FRONTEND=true`

```caddyfile
{
   email {$ACME_EMAIL}
}

{$COMPOSURE_DOMAIN} {
   encode zstd gzip
   reverse_proxy {$COMPOSURE_BACKEND_UPSTREAM}
}
```

Typical env values:
- `COMPOSURE_BACKEND_UPSTREAM=127.0.0.1:8080` (or `composure:8080` if Caddy is in the same Docker network)
- `API_BASE_PATH=/api` (default) or `/`

### 2) Host Frontend + Backend on Separate Subdomains

Use this when frontend and backend are separate services:
- app on `app.example.com`
- API on `api.example.com`

```caddyfile
{
   email {$ACME_EMAIL}
}

{$COMPOSURE_APP_DOMAIN} {
   encode zstd gzip
   reverse_proxy {$COMPOSURE_FRONTEND_UPSTREAM}
}

{$COMPOSURE_API_DOMAIN} {
   encode zstd gzip
   reverse_proxy {$COMPOSURE_BACKEND_UPSTREAM}
}
```

Recommended app env alignment:
- Backend: `SERVE_FRONTEND=false`
- Backend: `CORS_ORIGIN=https://${COMPOSURE_APP_DOMAIN}`
- Backend: `BACKEND_URL=https://${COMPOSURE_API_DOMAIN}`
- Backend: `FRONTEND_URL=https://${COMPOSURE_APP_DOMAIN}`
- Backend: `API_BASE_PATH=/` (or `/api`, but then include that in `VITE_API_URL`)
- Frontend: `VITE_API_URL=https://${COMPOSURE_API_DOMAIN}` when `API_BASE_PATH=/`
- Frontend: `VITE_API_URL=https://${COMPOSURE_API_DOMAIN}/api` when `API_BASE_PATH=/api`
- Frontend: when `VITE_API_URL` is absolute, API requests are sent with credentials so session cookies persist between app/api subdomains.

### 3) Host Frontend + Backend on One Domain (Path-Based Routing)

Use this when frontend and backend are separate upstreams but share one public domain.

```caddyfile
{
   email {$ACME_EMAIL}
}

{$COMPOSURE_DOMAIN} {
   encode zstd gzip

   @backend path /health /assets/* /api/* /v1/*
   handle @backend {
      reverse_proxy {$COMPOSURE_BACKEND_UPSTREAM}
   }

   handle {
      reverse_proxy {$COMPOSURE_FRONTEND_UPSTREAM}
   }
}
```

Notes:
- `/api/*` covers default `API_BASE_PATH=/api`.
- `/v1/*` covers `API_BASE_PATH=/`.
- If you use a custom API prefix like `/my/api`, add `/my/api/*` to `@backend` and set `VITE_API_URL=/my/api`.

### 4) Host Backend Only (API Edge, Frontend Hosted Elsewhere)

Useful for split deployments where frontend is on Cloudflare Pages, Vercel, Netlify, etc.

```caddyfile
{
   email {$ACME_EMAIL}
}

{$COMPOSURE_API_DOMAIN} {
   encode zstd gzip

   @allowed path /health /assets/* /api/* /v1/*
   handle @allowed {
      reverse_proxy {$COMPOSURE_BACKEND_UPSTREAM}
   }

   respond 404
}
```

Recommended backend env alignment:
- `SERVE_FRONTEND=false`
- `CORS_ORIGIN=https://${COMPOSURE_FRONTEND_ORIGIN}`
- `BACKEND_URL=https://${COMPOSURE_API_DOMAIN}`
- `FRONTEND_URL=https://${COMPOSURE_FRONTEND_ORIGIN}`
- `API_BASE_PATH=/` (common for split mode) or `/api`
- Ensure frontend `VITE_API_URL` points to this API origin (including any API base path).

### 5) Private LAN / Homelab with Internal TLS

For non-public DNS labs where you still want HTTPS, Caddy can issue internal certs.

```caddyfile
{$COMPOSURE_LAN_DOMAIN} {
   tls internal
   reverse_proxy {$COMPOSURE_BACKEND_UPSTREAM}
}
```

Example:
- `COMPOSURE_LAN_DOMAIN=composure.home.arpa`
- `COMPOSURE_BACKEND_UPSTREAM=127.0.0.1:8080`

If you later move to public DNS, remove `tls internal` and set `ACME_EMAIL` to use public ACME certificates.


## Features & Roadmap

### User Accounts

- [x] User account system
- [x] Profile photos
- [x] Password authentication
- [x] User session management
- [x] Account self-deletion with confirmation
- [ ] Second factor authentication (TOTP, WebAuthn)
- [ ] Force users to change a temporary password on their next login

### Server Administration

- [x] Admin dashboard
- [x] User management (view, search, add, delete, suspend)
- [x] Admins can generate password reset links for users
- [x] Account deletion
- [x] Global or per-user project limits
- [x] Invite link management
- [x] Open and invite-only signup modes
- [x] Compiler concurrency
- [x] Recent jobs monitoring
- [ ] Upload size and rate limits
- [ ] Server monitoring statistics (beyond recent jobs)
- [ ] SMTP configuration for email notifications (emails work, not wired up yet)

### Dashboard

- [x] Project creation and deletion
- [x] Search and sorting
- [x] Grid and list views
- [x] New project templates
- [x] Recent activity feed
- [x] Shared projects listing
- [x] Pinned projects listing
- [x] Recently deleted (restore, permanent delete, auto-purge)

### File Tree

- [x] File upload
- [x] Folders
- [x] File move, rename, and delete
- [x] Image/PDF preview

### Comments

- [x] Multi-line comments
- [x] Comment threads (one level, for now)
- [x] Comment editing and deletion

### Collaboration

- [x] Real-time collaboration with multiple users and labeled cursors
- [x] View, comment, and edit collaboration modes
- [x] Granular access control per project, with shareable links
- [ ] Presence indicators on the dashboard

### Drafting

- [x] Brace auto-closing, with some LaTeX-aware smarts
- [x] Highlighting text also highlights other occurrences of the same text
- [x] Find and replace
- [x] Suggestion for LaTeX and Typst commands and environments
- [x] File path and bibliography auto-complete
- [x] Multiple cursors (`alt`/`opt` to add, and `shift` for rectangular selection)
- [ ] User snippets library
- [ ] Editor tabs
- [ ] Split view
- [ ] Searchable visual math symbol palette (sensitive to file format)

### Compile and Export

- [x] Pluggable renderer architecture
- [x] Support for multiple rendering workers to balance load
- [x] Compile LaTeX to PDF preview (`tectonic`)
- [x] Compile Typst to PDF preview (`typst`)
- [x] Export to PDF, HTML, Microsoft Word (`pandoc`)
- [ ] Export to ArXiv submission format

### Version Control

- [x] Git integration (persisted bare repo)
- [x] User-generated snapshots with commit messages
- [x] Auto-commit on time interval
- [x] Auto-commit on compile
- [x] Auto-commit on export
- [x] Diff viewer for text files
- [x] Per-file restore
- [x] Point-in-time (full commit) restore
- [ ] Remote Git repository sync support (e.g. GitHub, GitLab)

### Design

- [x] Light and dark themes
- [ ] Full mobile support
- [ ] Context-sensitive right-click support (in most places)
- [ ] Global toast notification system

### Documentation

- [ ] One-click deploy docs
- [ ] Quick start / self-hosting guide
- [ ] Tech stack blurb and architecture overview
- [ ] Code contribution guidelines
- [ ] Visual demo or walkthrough

### Hosting

- [x] Configurable CORS origins

## Contributing

Contributions are welcome! Whether it's a bug report, feature suggestion, or pull 
request, please check out the [Contributing Guide](CONTRIBUTING.md) to get started.

## License

Composure is available under the [MIT License](LICENSE).
