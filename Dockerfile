# One image: the client is built at image-build time and served by the pit, so
# there is one service, one domain, and the websocket is same-origin.
FROM node:22-slim AS build
WORKDIR /app
# Railway exposes the commit sha as a build arg — without this the corner
# build tag reads "dev" in production, which defeats its entire purpose
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
COPY package*.json ./
# --ignore-scripts: no dependency's post-install gets a vote on whether the
# pit deploys. onnxruntime-node (under @huggingface/transformers, the farm's
# offline judge) downloads a GPU binary from a Microsoft CDN at install time,
# and the builder could not reach it — two builds in a row failed in npm ci
# for a package the server never loads. esbuild, rollup and the rest ship
# their platform binaries as packages, not scripts, so nothing here needs one.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# --include=dev is load-bearing: the server runs from TypeScript through tsx,
# which is a devDependency, and `npm ci` under NODE_ENV=production skips those.
# Without this the image builds cleanly and then cannot start.
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY characters ./characters
COPY genomes ./genomes
COPY tsconfig.json ./

# Railway supplies PORT. PIT_STATE must point at a mounted volume or the pit
# forgets everything on every deploy — see README.
ENV PIT_STATE=/data/pit-state.json
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
