# WordVerse Node 后端镜像
# 注意:本项目用 Node 内置的 node:sqlite(DatabaseSync,需 Node >= 22.5),
# 不依赖 better-sqlite3,无需 python/make/g++ 等原生编译依赖,基础镜像必须 >= node:22。
FROM node:24-alpine

WORKDIR /app

# 先装依赖再拷代码,充分利用镜像层缓存(express + cors 均为纯 JS)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
# data/*.json 是知识库种子,首次启动幂等播种进 SQLite
COPY data ./data

# MySQL 驱动(默认)或 SQLite(本地 dev / 离线测试)由 WORDVERSE_DB 切换
# MySQL 凭证由 docker-compose 注入;SQLite 文件放 /data 由 named volume 持久化
RUN mkdir -p /data
ENV WORDVERSE_DB=/data/wordverse.db \
    WORDVERSE_MYSQL_HOST=mysql \
    WORDVERSE_MYSQL_PORT=3306 \
    WORDVERSE_MYSQL_USER=root \
    WORDVERSE_MYSQL_PASSWORD=wordverse \
    WORDVERSE_MYSQL_DATABASE=wordverse \
    NODE_ENV=production

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
  CMD wget --spider -q http://localhost:8000/ || exit 1

CMD ["node", "server.js"]
