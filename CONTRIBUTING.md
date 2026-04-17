# Contributing to Composure

Thanks for your interest in contributing! Here's how to get involved.

## Ways to Contribute

- **Bug reports**: open an issue with steps to reproduce, expected vs. actual behavior, and your environment
- **Feature requests**: open an issue describing the use case and why it belongs in Composure
- **Pull requests**: see below for setup instructions and conventions

## Local Development Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/withcomposure/composure
cd composure
npm ci
```

Copy the example env file and fill in values:

```bash
cp .env.example .env
```

Start the development server:

```bash
npm run dev
```

## Running Tests

```bash
npm test -w backend
npm test -w frontend
npm test -w compiler
```

Please make sure all tests pass before opening a PR.

## Pull Request Guidelines

- Keep PRs focused in scope
- Write or update tests for any new or changing behavior
- Follow existing code style
- Add a clear description of what the PR does and why

## Questions?

Open a [GitHub Discussion](https://github.com/withcomposure/composure/discussions) or file an issue — happy to help orient new contributors.