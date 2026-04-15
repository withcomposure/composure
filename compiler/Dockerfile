FROM texlive/texlive:latest

ARG TECTONIC_VERSION=0.16.8
ARG TYPST_VERSION=0.14.2

RUN set -eux; \
  apt-get update; \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    nodejs \
    npm \
    pandoc \
    xz-utils; \
  rm -rf /var/lib/apt/lists/*; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) tectonic_target="x86_64-unknown-linux-gnu"; typst_target="x86_64-unknown-linux-musl" ;; \
    arm64) tectonic_target="aarch64-unknown-linux-musl"; typst_target="aarch64-unknown-linux-musl" ;; \
    i386) tectonic_target="i686-unknown-linux-gnu"; typst_target="i686-unknown-linux-musl" ;; \
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/tectonic.tar.gz "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${tectonic_target}.tar.gz"; \
  tar -xzf /tmp/tectonic.tar.gz -C /tmp; \
  binary_path="$(find /tmp -maxdepth 4 -type f -name tectonic | head -n1)"; \
  test -n "$binary_path"; \
  install -m 0755 "$binary_path" /usr/local/bin/tectonic; \
  tectonic --help; \
  curl -fsSL -o /tmp/typst.tar.xz "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${typst_target}.tar.xz"; \
  tar -xJf /tmp/typst.tar.xz -C /tmp; \
  typst_path="$(find /tmp -maxdepth 4 -type f -name typst | head -n1)"; \
  test -n "$typst_path"; \
  install -m 0755 "$typst_path" /usr/local/bin/typst; \
  typst --version; \
  rm -rf /tmp/tectonic /tmp/tectonic.tar.gz /tmp/typst /tmp/typst.tar.xz

WORKDIR /app

COPY package.json package-lock.json* ./
COPY compiler/package.json ./compiler/
RUN npm install --workspace=compiler --ignore-scripts

COPY compiler/ ./compiler/
RUN npm run build --workspace=compiler

ENV PORT=4000
ENV COMPILE_DIR=/var/pressmark/compiles
ENV TECTONIC_CACHE=/var/pressmark/caches/tectonic
ENV TYPST_CACHE=/var/pressmark/caches/typst
ENV ASSETS_DIR=/app/data/assets

RUN mkdir -p /var/pressmark/compiles /var/pressmark/caches/tectonic /var/pressmark/caches/typst /app/data/assets
VOLUME /var/pressmark/compiles
VOLUME /var/pressmark/caches/tectonic
VOLUME /var/pressmark/caches/typst

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "compiler/dist/server.js"]
