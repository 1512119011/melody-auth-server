// ============================================================
//  Melody 音乐盒 - 用户认证与云端数据同步后端
//  技术栈：Express + SQLite(better-sqlite3) + JWT + bcryptjs
//  接口前缀：/auth
// ============================================================
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'melody-music-box-secret-key-change-in-production';
const TOKEN_EXPIRES = '30d';

// ----------------------------------------------------------
//  数据库初始化
// ----------------------------------------------------------
const dbPath = process.env.DB_PATH || path.join(__dirname, 'melody.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY,
    favorites TEXT DEFAULT '[]',
    playlists TEXT DEFAULT '[]',
    history TEXT DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ----------------------------------------------------------
//  中间件
// ----------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 简单请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// JWT 认证中间件
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
  }
}

// ----------------------------------------------------------
//  工具函数
// ----------------------------------------------------------
function generateToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
}

function userPublicInfo(user) {
  return { id: user.id, username: user.username, email: user.email, avatar: user.avatar || '' };
}

// ----------------------------------------------------------
//  注册
//  POST /auth/register
//  Body: { username, email, password }
// ----------------------------------------------------------
app.post('/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};

  // 校验
  if (!username || username.length < 3 || username.length > 20) {
    return res.status(400).json({ code: 400, msg: '用户名需 3-20 位字符' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ code: 400, msg: '邮箱格式不正确' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ code: 400, msg: '密码至少 6 位字符' });
  }

  // 检查用户名是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    return res.status(409).json({ code: 409, msg: '用户名或邮箱已被注册' });
  }

  // 创建用户
  const hashed = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const info = db.prepare('INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, ?)')
    .run(username, email, hashed, now);
  const userId = info.lastInsertRowid;

  // 初始化用户数据表
  db.prepare('INSERT INTO user_data (user_id, updated_at) VALUES (?, ?)').run(userId, now);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const token = generateToken(user);

  res.json({
    token,
    userId: user.id,
    username: user.username,
    user: { name: user.username, avatar: user.avatar || '' }
  });
});

// ----------------------------------------------------------
//  登录
//  POST /auth/login
//  Body: { account, password }  account 可为用户名或邮箱
// ----------------------------------------------------------
app.post('/auth/login', (req, res) => {
  const { account, password } = req.body || {};
  if (!account || !password) {
    return res.status(400).json({ code: 400, msg: '请输入账号和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(account, account);
  if (!user) {
    return res.status(401).json({ code: 401, msg: '账号或密码错误' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ code: 401, msg: '账号或密码错误' });
  }

  const token = generateToken(user);
  res.json({
    token,
    userId: user.id,
    username: user.username,
    user: { name: user.username, avatar: user.avatar || '' }
  });
});

// ----------------------------------------------------------
//  拉取用户数据
//  GET /auth/user/data
//  Header: Authorization: Bearer <token>
//  返回: { favorites, playlists, history }
// ----------------------------------------------------------
app.get('/auth/user/data', authRequired, (req, res) => {
  const row = db.prepare('SELECT favorites, playlists, history FROM user_data WHERE user_id = ?').get(req.user.userId);
  if (!row) {
    return res.json({ favorites: [], playlists: [], history: [] });
  }
  res.json({
    favorites: JSON.parse(row.favorites || '[]'),
    playlists: JSON.parse(row.playlists || '[]'),
    history: JSON.parse(row.history || '[]')
  });
});

// ----------------------------------------------------------
//  推送单类用户数据
//  PUT /auth/user/data/:type
//  type: favorites | playlists | history
//  Body: { data: [...] }
// ----------------------------------------------------------
app.put('/auth/user/data/:type', authRequired, (req, res) => {
  const type = req.params.type;
  const allowed = ['favorites', 'playlists', 'history'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ code: 400, msg: '无效的数据类型' });
  }

  const data = req.body && req.body.data;
  if (!Array.isArray(data)) {
    return res.status(400).json({ code: 400, msg: '数据格式错误，需为数组' });
  }

  const json = JSON.stringify(data);
  const now = Date.now();

  // 存在则更新，不存在则插入
  const existing = db.prepare('SELECT user_id FROM user_data WHERE user_id = ?').get(req.user.userId);
  if (existing) {
    db.prepare(`UPDATE user_data SET ${type} = ?, updated_at = ? WHERE user_id = ?`)
      .run(json, now, req.user.userId);
  } else {
    db.prepare('INSERT INTO user_data (user_id, updated_at) VALUES (?, ?)').run(req.user.userId, now);
    db.prepare(`UPDATE user_data SET ${type} = ? WHERE user_id = ?`).run(json, req.user.userId);
  }

  res.json({ code: 0, msg: 'ok' });
});

// ----------------------------------------------------------
//  健康检查
// ----------------------------------------------------------
app.get('/auth/health', (_req, res) => {
  res.json({ code: 0, msg: 'ok', time: Date.now() });
});

// ----------------------------------------------------------
//  启动
// ----------------------------------------------------------
app.listen(PORT, () => {
  console.log('========================================');
  console.log('  Melody Auth Server 已启动');
  console.log(`  端口: ${PORT}`);
  console.log(`  数据库: ${dbPath}`);
  console.log(`  接口前缀: /auth`);
  console.log('========================================');
});
//（注：内容由AI生成）
