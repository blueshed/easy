FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.json bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY .claude/ .claude/
COPY README.md ./

EXPOSE 8080

CMD ["bun", "run", "src/site.ts"]
