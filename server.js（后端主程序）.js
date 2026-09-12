// ============================================================
//  Melody 音乐盒 - 用户认证与云端数据同步后端
//  技术栈：Express + JSON文件存储 + JWT + bcryptjs
//  接口前缀：/auth
//  说明：用 JSON 文件做持久化，零原生依赖，任意 Node 平台可部署
// ============================================================
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'melody-music-box-secret-key-change-in-production';
const TOKEN_EXPIRES = '30d';

// ----------------------------------------------------------
//  JSON 文件数据库
// ----------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库文件
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], nextId: 1 }, null, 2));
}

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return { users: [], nextId: 1 };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function findUserByAccount(account) {
  const db = readDB();
  return db.users.find(u => u.username === account || u.email === account) || null;
}

function findUserById(id) {
  const db = readDB();
  return db.users.find(u => u.id === id) || null;
}

function saveUser(user) {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === user.id);
  if (idx >= 0) {
    db.users[idx] = user;
  } else {
    db.users.push(user);
  }
  writeDB(db);
}

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

// ----------------------------------------------------------
//  注册
//  POST /auth/register
//  Body: { username, email, password }
// ----------------------------------------------------------
app.post('/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};

  if (!username || username.length < 3 || username.length > 20) {
    return res.status(400).json({ code: 400, msg: '用户名需 3-20 位字符' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ code: 400, msg: '邮箱格式不正确' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ code: 400, msg: '密码至少 6 位字符' });
  }

  // 检查用户名或邮箱是否已存在
  if (findUserByAccount(username) || findUserByAccount(email)) {
    return res.status(409).json({ code: 409, msg: '用户名或邮箱已被注册' });
  }

  const db = readDB();
  const userId = db.nextId++;
  const hashed = bcrypt.hashSync(password, 10);
  const now = Date.now();

  const user = {
    id: userId,
    username,
    email,
    password: hashed,
    avatar: '',
    createdAt: now,
    data: { favorites: [], playlists: [], history: [] }
  };

  db.users.push(user);
  writeDB(db);

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

  const user = findUserByAccount(account);
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
// ----------------------------------------------------------
app.get('/auth/user/data', authRequired, (req, res) => {
  const user = findUserById(req.user.userId);
  if (!user || !user.data) {
    return res.json({ favorites: [], playlists: [], history: [] });
  }
  res.json({
    favorites: user.data.favorites || [],
    playlists: user.data.playlists || [],
    history: user.data.history || []
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

  const user = findUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ code: 404, msg: '用户不存在' });
  }

  if (!user.data) user.data = { favorites: [], playlists: [], history: [] };
  user.data[type] = data;
  saveUser(user);

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
  console.log(`  数据文件: ${DB_FILE}`);
  console.log(`  接口前缀: /auth`);
  console.log('========================================');
});
