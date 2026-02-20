FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY .claude/ .claude/
COPY README.md ./

EXPOSE 8080

CMD ["bun", "run", "--watch", "src/site.ts"]
