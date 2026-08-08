# 报价跟单系统 - 部署文档

> 版本：v1.1.1 | 更新日期：2026-08-08 | 服务器：阿里云ECS (8.136.117.41)

---

## 目录

1. [前置条件](#1-前置条件)
2. [服务器环境准备](#2-服务器环境准备)
3. [部署步骤](#3-部署步骤)
4. [版本验证](#4-版本验证)
5. [常见问题排查](#5-常见问题排查)
6. [回滚流程](#6-回滚流程)

---

## 1. 前置条件

### 1.1 所需权限

| 权限 | 说明 |
|------|------|
| SSH root 权限 | 服务器管理员权限 |
| 阿里云控制台访问 | 用于安全组配置 |
| GitHub 仓库访问 | 代码推送和 Tag 管理 |

### 1.2 服务器要求

- **操作系统**：Alibaba Cloud Linux 3 (或 CentOS 8+)
- **CPU**：≥ 2 核
- **内存**：≥ 2GB（推荐 4GB，用于 Vite 构建）
- **磁盘**：≥ 20GB 可用空间
- **网络**：公网 IP，开放 80/22 端口

### 1.3 所需软件

| 软件 | 最低版本 | 用途 |
|------|----------|------|
| Node.js | 18.x | 运行时环境 |
| npm | 10.x | 包管理 |
| MySQL | 8.0+ | 数据库 |
| Nginx | 1.20+ | 反向代理 |
| PM2 | 7.0+ | 进程管理 |
| Git | 2.30+ | 版本控制 |

---

## 2. 服务器环境准备

### 2.1 SSH 连接

```bash
ssh root@8.136.117.41
# 密码：Huashao123
```

### 2.2 安装基础软件

```bash
# 更新系统
dnf update -y

# 安装 Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
dnf install -y nodejs

# 安装 MySQL 8.0
dnf install -y mysql-server
systemctl start mysqld
systemctl enable mysqld

# 安装 Nginx
dnf install -y nginx
systemctl start nginx
systemctl enable nginx

# 安装全局工具
npm config set registry https://registry.npmmirror.com
npm install -g pm2 typescript
```

### 2.3 配置 MySQL

```bash
# 获取临时密码
grep "temporary password" /var/log/mysqld.log

# 使用临时密码登录并修改
mysql -u root -p'<临时密码>' --connect-expired-password

# 在 MySQL 中执行：
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Huashao123!';
CREATE USER 'root'@'%' IDENTIFIED BY 'Huashao123!';
CREATE USER 'root'@'127.0.0.1' IDENTIFIED BY 'Huashao123!';
CREATE USER 'root'@'::1' IDENTIFIED BY 'Huashao123!';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'root'@'::1' WITH GRANT OPTION;
FLUSH PRIVILEGES;

# 创建业务数据库
CREATE DATABASE quote_system_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2.4 配置 Nginx

```bash
cat > /etc/nginx/conf.d/X-prod.conf << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:3002;
        expires 1y;
        add_header Cache-Control "public, immutable";
        proxy_set_header Host $host;
    }
}
EOF

# 注释默认配置（避免冲突）
sed -i '/server {/,/}/s/^/#/' /etc/nginx/nginx.conf

# 测试并重载
nginx -t && systemctl reload nginx
```

### 2.5 配置阿里云安全组

在阿里云控制台添加入方向规则：
- **端口**：80/80
- **协议**：TCP
- **授权对象**：0.0.0.0/0

### 2.6 配置 PM2 开机自启

```bash
pm2 startup systemd -u root --hp /root
pm2 save
```

---

## 3. 部署步骤

### 3.1 代码提交与推送（本机执行）

```bash
cd /Users/hile/Documents/work/projects/X

# 提交代码
git add .
git commit -m "type(scope): 描述"

# 推送
git push origin main

# 创建版本标签
git tag -a v1.x.x -m "版本描述"
git push origin v1.x.x
```

### 3.2 服务器部署

```bash
# 方式一：使用自动化脚本（推荐）
bash scripts/deploy-remote.sh

# 方式二：手动部署
# 1. 打包代码（本机）
tar czf /tmp/X-deploy.tar.gz \
  --exclude='node_modules' --exclude='dist' --exclude='.env' \
  --exclude='.git' --exclude='*.log' --exclude='data' .

# 2. 上传到服务器
scp /tmp/X-deploy.tar.gz root@8.136.117.41:/tmp/

# 3. SSH 到服务器
ssh root@8.136.117.41

# 4. 解压并安装
cd /usr/X-prod
tar xzf /tmp/X-deploy.tar.gz

# 5. 创建 .env 配置
cat > .env << 'EOF'
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=Huashao123!
MYSQL_DATABASE=quote_system_prod
PORT=3002
NODE_ENV=production
VITE_WPS_DOC_URL=https://www.kdocs.cn/l/cvleofY7b3sL
VITE_AUTH_COOKIE_EXPIRE_HOURS=5
EOF

# 6. 安装依赖
npm config set registry https://registry.npmmirror.com
npm install

# 7. 构建前端（如服务器内存不足，在本机构建后上传 dist/）
npx vite build

# 8. 构建后端
npx tsc -p api/tsconfig.json

# 9. 重启服务
pm2 restart X-api --env production
# 或首次启动
pm2 start api/dist/index.js --name "X-api" --env production
pm2 save
```

### 3.3 本机构建后上传（服务器内存不足时）

```bash
# 本机构建
npm run build

# 打包构建产物
tar czf /tmp/X-dist.tar.gz dist/ api/dist/

# 上传
scp /tmp/X-dist.tar.gz root@8.136.117.41:/tmp/

# 服务器解压
ssh root@8.136.117.41 'cd /usr/X-prod && tar xzf /tmp/X-dist.tar.gz'
```

---

## 4. 版本验证

### 4.1 检查运行版本

```bash
# SSH 到服务器
ssh root@8.136.117.41

# 检查 PM2 进程
pm2 list
# 应显示 version: 1.x.x

# 检查 package.json
grep version /usr/X-prod/package.json

# 检查健康状态
curl http://localhost:3002/api/health
# 应返回 {"status":"ok",...}
```

### 4.2 检查数据库

```bash
mysql -u root -p'Huashao123!' -e "
USE quote_system_prod;
SELECT COUNT(*) AS total_quotes FROM quotes;
SHOW TABLES;
"
```

### 4.3 检查 Nginx

```bash
# 通过 Nginx 访问
curl http://localhost/api/health

# 检查 Nginx 状态
systemctl status nginx
```

### 4.4 检查公网访问

```bash
# 从本机访问
curl http://8.136.117.41/api/health
curl http://8.136.117.41/
```

---

## 5. 常见问题排查

### 5.1 MySQL 连接失败

```
Error: Access denied for user 'root'@'localhost'
```

**解决方案**：
```bash
# 检查 MySQL 用户
mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user='root';"

# 确保所有 host 都有 root 用户
CREATE USER 'root'@'%' IDENTIFIED BY 'Huashao123!';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### 5.2 Vite 构建失败（内存不足）

```
Error: ERR_DLOPEN_FAILED (rollup native module)
```

**解决方案**：在本机构建后上传 dist/ 目录（见 3.3 节）

### 5.3 Nginx 502 Bad Gateway

**原因**：API 服务未运行或端口不匹配

**解决方案**：
```bash
# 检查 PM2 进程
pm2 list

# 检查端口
ss -tlnp | grep 3002

# 重启 API
pm2 restart X-api

# 查看日志
pm2 logs X-api --lines 20
```

### 5.4 公网无法访问

**原因**：阿里云安全组未开放 80 端口

**解决方案**：在阿里云控制台 → ECS → 安全组 → 添加入方向规则（端口 80, TCP, 0.0.0.0/0）

### 5.5 PM2 进程崩溃

```bash
# 查看错误日志
pm2 logs X-api --err --lines 50

# 重启
pm2 restart X-api

# 如果频繁崩溃，检查内存
free -h
# 内存不足时添加 swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
```

---

## 6. 回滚流程

### 6.1 代码回滚

```bash
# SSH 到服务器
ssh root@8.136.117.41

# 查看可用版本
cd /usr/X-prod
git log --oneline -10

# 回滚到指定版本
git checkout <commit-hash>

# 重新构建并重启
npx vite build
npx tsc -p api/tsconfig.json
pm2 restart X-api
```

### 6.2 数据库回滚

```bash
# 恢复数据库备份
mysql -u root -p'Huashao123!' quote_system_prod < /path/to/backup.sql
```

### 6.3 完整回滚（代码 + 数据库）

```bash
# 1. 停止服务
pm2 stop X-api

# 2. 恢复数据库
mysql -u root -p'Huashao123!' quote_system_prod < /path/to/backup.sql

# 3. 恢复代码
cd /usr/X-prod
git checkout <previous-commit>

# 4. 重新构建
npm install
npx vite build
npx tsc -p api/tsconfig.json

# 5. 重启服务
pm2 start X-api --env production
pm2 save

# 6. 验证
curl http://localhost:3002/api/health
```

---

## 附录

### A. 服务器信息

| 项目 | 值 |
|------|-----|
| 公网 IP | 8.136.117.41 |
| SSH 端口 | 22 |
| SSH 用户 | root |
| 应用目录 | /usr/X-prod |
| API 端口 | 3002 |
| Nginx 端口 | 80 |
| MySQL 端口 | 3306 |
| MySQL 数据库 | quote_system_prod |
| MySQL 密码 | Huashao123! |
| PM2 进程名 | X-api |

### B. 常用命令速查

```bash
# PM2 操作
pm2 list                    # 查看进程
pm2 restart X-api           # 重启
pm2 stop X-api              # 停止
pm2 logs X-api              # 查看日志
pm2 logs X-api --err        # 查看错误日志
pm2 monit                   # 监控面板

# Nginx 操作
systemctl restart nginx     # 重启
systemctl reload nginx      # 重载配置
nginx -t                    # 测试配置

# MySQL 操作
mysql -u root -p'Huashao123!'                    # 连接
systemctl restart mysqld                         # 重启
mysql -u root -p'Huashao123!' -e "SHOW DATABASES;"  # 查看数据库
```
