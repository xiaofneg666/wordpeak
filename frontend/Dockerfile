# WordVerse 前端镜像:多阶段构建(node 构建 vite → nginx 服务 dist)
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 生产构建:BASE 用相对路径 /api,由 nginx 反代到后端
RUN npm run build

# ---- 运行阶段 ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
