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
docker compose up --build
```

Requires Node 24.

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

## Contributing

Contributions are welcome! Whether it's a bug report, feature suggestion, or pull 
request, please check out the [Contributing Guide](CONTRIBUTING.md) to get started.

## License

Composure is available under the [MIT License](LICENSE).
