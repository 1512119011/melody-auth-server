# Melody Auth Server - 用户认证与云端同步后端

为 Melody 音乐盒提供登录注册和云端数据同步的最简后端。

## 功能

- 用户注册 / 登录（JWT）
- 密码加密存储（bcrypt）
- 云端收藏 / 歌单 / 听歌历史同步
- SQLite 数据库，零配置，数据存在本地文件

## 接口列表

| 方法 | 路径 | 说明 | 是否需要登录 |
|------|------|------|-------------|
| POST | `/auth/register` | 注册 | 否 |
| POST | `/auth/login` | 登录 | 否 |
| GET | `/auth/user/data` | 拉取收藏/歌单/历史 | 是 |
| PUT | `/auth/user/data/:type` | 推送单类数据 | 是 |
| GET | `/auth/health` | 健康检查 | 否 |

## 本地运行

```bash
# 安装依赖
npm install

# 启动
npm start
```

启动后访问 `http://localhost:3000/auth/health` 应返回 `{"code":0,"msg":"ok"}`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `JWT_SECRET` | 内置默认值 | **生产环境务必修改** |
| `DB_PATH` | `./melody.db` | SQLite 数据库文件路径 |

## 部署到 Render（推荐，免费）

1. 将 `melody-auth-server` 文件夹推送到 GitHub
2. 登录 [Render](https://render.com) → New → Web Service
3. 连接你的 GitHub 仓库
4. 配置：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - 选择免费套餐（Free）
5. 高级选项中添加环境变量：
   - `JWT_SECRET` = 随便填一串长字符串（比如 32 位随机字符）
6. 点击 Create Web Service，等待部署完成
7. 部署成功后会得到一个域名，如 `https://melody-auth.onrender.com`

## 部署到 Railway

1. 推送到 GitHub
2. 登录 [Railway](https://railway.app) → New Project → Deploy from GitHub repo
3. 选择仓库，自动识别 Node.js
4. 添加环境变量 `JWT_SECRET`
5. 部署后在 Settings → Networking 中生成域名

## 部署到 Vercel（需小改）

Vercel 是 Serverless 架构，SQLite 文件存储不稳定。建议用 Render/Railway，或把数据库换成 PostgreSQL。

## 配置前端

部署后端后，修改 `index.html` 中的地址：

```js
// 找到这一行，改成你的后端地址（注意末尾不要加 /）
const AUTH_API_BASE = 'https://你的后端域名/auth';
```

例如部署到 Render 后：
```js
const AUTH_API_BASE = 'https://melody-auth.onrender.com/auth';
```

然后重新部署前端即可。

## 数据存储

- 用户信息存在 `melody.db`（SQLite）
- 收藏/歌单/历史以 JSON 字符串存在 `user_data` 表
- 备份只需复制 `melody.db` 文件

## 注意事项

1. **生产环境务必设置 `JWT_SECRET`**，否则 token 可被伪造
2. Render 免费套餐 15 分钟无请求会休眠，首次访问可能需要等 10-30 秒唤醒
3. 如需多用户高并发，建议把 SQLite 换成 PostgreSQL/MySQL
#（注：内容由AI生成）
