# syntax=docker/dockerfile:1.7
# BuildKit is required for the cache mounts below. Coolify builds with BuildKit
# by default; the syntax line pins the frontend so an older daemon still parses
# the mount flags instead of failing on them.

FROM node:lts AS build
WORKDIR /app

# The repo is pnpm (pnpm-lock.yaml, packageManager field). `npm i` ignored that
# lockfile, re-resolved the tree on every deploy, and produced a build that did
# not match the one tested locally.
RUN corepack enable

# Dependencies in their own layer, before the source copy, so editing a .astro
# file does not invalidate the install. The store mount keeps the downloaded
# tarballs on the builder, so even a lockfile change installs from local disk.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

COPY . .

# Astro writes every optimised image to node_modules/.astro/assets, keyed by the
# source file's content hash. That directory was thrown away on every deploy,
# so each build re-encoded all 255 variants from scratch: 76s of wall clock and
# 2.4GB peak RSS measured on 16 cores, and far worse on a VPS that has to swap
# to hold it. Persisting it turns an unchanged image into a file copy.
#
#   cold (no cache):  75.9s, 2.4GB peak
#   warm (cached):     2.3s, 390MB peak
#
# The mount is scoped to assets/ rather than all of .astro so the content-layer
# data store is still rebuilt fresh each time and cannot go stale.
# The site is static output, so CONTACT_EMAIL is baked in at build time rather
# than read by the running container. It has to arrive as a build argument:
# setting it as a runtime environment variable in Coolify does nothing, because
# by then the HTML already exists. Unset is fine - the takedown line is simply
# omitted. An address that is not an email fails the build rather than shipping
# a mailto: nobody can use.
#
#   Coolify: Build Variables (not Environment Variables)
#   docker:  docker build --build-arg CONTACT_EMAIL=you@example.org .
ARG CONTACT_EMAIL=""
ENV CONTACT_EMAIL=$CONTACT_EMAIL

RUN --mount=type=cache,target=/app/node_modules/.astro/assets,sharing=locked \
    pnpm build

FROM httpd:2.4 AS runtime
COPY --from=build /app/dist /usr/local/apache2/htdocs/

# Gives Coolify something to wait on before it cuts traffic over, so the old
# container keeps serving until the new one actually answers.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/80 && printf 'GET / HTTP/1.0\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q 200"]

EXPOSE 80
