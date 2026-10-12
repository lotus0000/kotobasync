FROM node:24-alpine AS web
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
RUN npm ci
COPY shared/ shared/
COPY web/ web/
RUN npm run build -w web

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    KOTOBA_DATABASE_URL=sqlite:////data/kotoba.db \
    KOTOBA_STATIC_DIR=/app/static

WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock server/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/ ./
RUN uv sync --frozen --no-dev && mkdir -p /data
COPY --from=web /src/web/dist /app/static

USER 1000:1000
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn --factory kotobasync.app:create_app --host 0.0.0.0 --port 8000 --no-proxy-headers"]
