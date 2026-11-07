require('dotenv').config();
const express = require('express'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const multer = require('multer'), nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const makeBots = require('./bots');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'ozgartiring-uzun-maxfiy-soz';
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
const GID = process.env.GOOGLE_CLIENT_ID || '';
const PERMS = ['movies', 'categories', 'banners', 'users', 'settings'];
fs.mkdirSync(UP, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'db.sqlite'));
db.exec(`
create table if not exists users(id integer primary key autoincrement,email text unique not null,first text,last text,age integer,hash text not null,role text default 'user',perms text default '',banned integer default 0,created text default current_timestamp);
create table if not exists categories(id integer primary key autoincrement,name text unique not null);
create table if not exists movies(id integer primary key autoincrement,title text not null,code text unique,year integer,description text,category_id integer,is_series integer default 0,video text,poster text,created text default current_timestamp);
create table if not exists episodes(id integer primary key autoincrement,movie_id integer not null,num integer not null,video text not null);
create table if not exists banners(id integer primary key autoincrement,place text,kind text,file text,link text,active integer default 1,created text default current_timestamp);
create table if not exists settings(key text primary key,value text);
create table if not exists resets(token text primary key,user_id integer,expires integer);
`);

db.exec(`
create table if not exists bots(id integer primary key autoincrement,token text unique not null,username text,name text,welcome text default '',need_phone integer default 1,sub_on integer default 0,active integer default 1,created text default current_timestamp);
create table if not exists channels(id integer primary key autoincrement,bot_id integer not null,kind text,title text,chat text,url text);
`);
for (const c of ['tg_id integer', 'phone text', 'username text', 'link_ok integer default 0']) { try { db.exec('alter table users add column ' + c); } catch { } }
db.exec('create unique index if not exists ux_users_tg on users(tg_id)');

if (!db.prepare("select 1 from users where role='super'").get()) {
  const e = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase(), p = process.env.SUPER_ADMIN_PASSWORD;
  if (e && p) db.prepare("insert into users(email,first,last,hash,role) values(?,?,?,?,'super')").run(e, 'Super', 'Admin', bcrypt.hashSync(p, 10));
  else console.log('DIQQAT: .env faylida SUPER_ADMIN_EMAIL va SUPER_ADMIN_PASSWORD ni kiriting!');
}
if (!db.prepare('select 1 from categories').get())
  ['Seriallar', 'Komediya', 'Ujas', 'Jangari', 'Drama', 'Multfilm', 'Fantastika'].forEach(n => db.prepare('insert into categories(name) values(?)').run(n));

// ---------- yordamchilar ----------
const bad = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const h = f => async (req, res) => { try { await f(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message || 'Xatolik' }); } };
const pub = u => ({ id: u.id, email: u.email, first: u.first, last: u.last, age: u.age, role: u.role, perms: u.perms });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const rm = u => { if (u && u.startsWith('/uploads/')) fs.unlink(path.join(UP, path.basename(u)), () => {}); };
const url = f => (f ? '/uploads/' + f : null);
const cleanPerms = p => (Array.isArray(p) ? p : String(p || '').split(',')).filter(x => PERMS.includes(x)).join(',');

const tries = new Map();
const limit = req => {
  const k = req.ip, n = (tries.get(k) || 0) + 1; tries.set(k, n);
  setTimeout(() => tries.delete(k), 15 * 60 * 1000).unref();
  if (n > 30) throw bad("Juda ko'p urinish. 15 daqiqadan keyin urinib ko'ring", 429);
};

function checkProfile(b) {
  const first = (b.first || '').trim(), last = (b.last || '').trim(), age = parseInt(b.age);
  if (!first || !last) throw bad('Ism va familiya majburiy');
  if (!(age >= 5 && age <= 120)) throw bad("Yoshni to'g'ri kiriting");
  if ((b.password || '').length < 6) throw bad('Parol kamida 6 belgidan iborat bo\'lsin');
  return { first, last, age };
}

const auth = (req, res, next) => {
  try {
    const { id } = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    const u = db.prepare('select * from users where id=?').get(id);
    if (!u) throw 0;
    if (u.banned) return res.status(403).json({ error: 'Hisobingiz bloklangan' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Kirish kerak' }); }
};
const need = p => (req, res, next) => {
  const u = req.user;
  if (u.role === 'super' || (u.role === 'admin' && p !== 'super' && u.perms.split(',').includes(p))) return next();
  res.status(403).json({ error: "Ruxsat yo'q" });
};
const staff = (req, res, next) => (['super', 'admin'].includes(req.user.role) ? next() : res.status(403).json({ error: "Ruxsat yo'q" }));

const clients = new Set();
const broadcast = () => clients.forEach(r => r.write('data: change\n\n'));
setInterval(() => clients.forEach(r => r.write(': ping\n\n')), 25000).unref();

const bots = makeBots({ db, UP, BASE });

const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (r, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(f.originalname).toLowerCase())
  }),
  limits: { fileSize: 3 * 1024 ** 3 }
});
const fields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }]);
const got = req => ({ video: url(req.files?.video?.[0]?.filename), poster: url(req.files?.poster?.[0]?.filename) });

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

// ---------- ilova ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (q, s) => s.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/health', (q, s) => s.send('ok'));

app.get('/api/config', h((req, res) => {
  const s = db.prepare("select value from settings where key='siteName'").get();
  res.json({ googleClientId: GID, siteName: s ? s.value : 'Kino Bazza' });
}));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---------- kirish / ro'yxat ----------
app.post('/api/auth/register', h((req, res) => {
  limit(req);
  const email = (req.body.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw bad("Email noto'g'ri");
  const p = checkProfile(req.body);
  if (db.prepare('select 1 from users where email=?').get(email)) throw bad("Bu email bilan hisob bor");
  const id = db.prepare('insert into users(email,first,last,age,hash) values(?,?,?,?,?)')
    .run(email, p.first, p.last, p.age, bcrypt.hashSync(req.body.password, 10)).lastInsertRowid;
  const u = db.prepare('select * from users where id=?').get(id);
  broadcast(); res.json({ token: sign(u), user: pub(u) });
}));

app.post('/api/auth/login', h((req, res) => {
  limit(req);
  const u = db.prepare('select * from users where email=?').get((req.body.email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.hash)) throw bad("Email yoki parol noto'g'ri", 401);
  if (u.banned) throw bad('Hisobingiz bloklangan', 403);
  res.json({ token: sign(u), user: pub(u) });
}));

const gclient = new OAuth2Client(GID);
async function gverify(credential) {
  if (!GID) throw bad('Google kirish sozlanmagan');
  const t = await gclient.verifyIdToken({ idToken: credential, audience: GID });
  const p = t.getPayload();
  if (!p.email || !p.email_verified) throw bad('Google email tasdiqlanmagan');
  return p;
}
app.post('/api/auth/google', h(async (req, res) => {
  limit(req);
  const p = await gverify(req.body.credential), email = p.email.toLowerCase();
  const u = db.prepare('select * from users where email=?').get(email);
  if (u) {
    if (u.banned) throw bad('Hisobingiz bloklangan', 403);
    return res.json({ token: sign(u), user: pub(u) });
  }
  res.json({ needProfile: true, email, first: p.given_name || '', last: p.family_name || '', pending: jwt.sign({ email, g: 1 }, SECRET, { expiresIn: '15m' }) });
}));
app.post('/api/auth/google/complete', h((req, res) => {
  limit(req);
  let d; try { d = jwt.verify(req.body.pending, SECRET); } catch { throw bad('Vaqt tugadi, qaytadan Google orqali kiring'); }
  const p = checkProfile(req.body);
  if (db.prepare('select 1 from users where email=?').get(d.email)) throw bad('Hisob allaqachon bor');
  const id = db.prepare('insert into users(email,first,last,age,hash) values(?,?,?,?,?)')
    .run(d.email, p.first, p.last, p.age, bcrypt.hashSync(req.body.password, 10)).lastInsertRowid;
  const u = db.prepare('select * from users where id=?').get(id);
  broadcast(); res.json({ token: sign(u), user: pub(u) });
}));

app.post('/api/auth/forgot', h(async (req, res) => {
  limit(req);
  const u = db.prepare('select * from users where email=?').get((req.body.email || '').trim().toLowerCase());
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('insert into resets values(?,?,?)').run(token, u.id, Date.now() + 3600e3);
    const link = `${BASE}/?reset=${token}`;
    if (mailer) await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, subject: 'Parolni tiklash', text: `Parolni tiklash havolasi (1 soat amal qiladi):\n${link}` });
    else console.log('Parol tiklash havolasi (SMTP sozlanmagan):', link);
  }
  res.json({ ok: true });
}));
app.post('/api/auth/reset', h((req, res) => {
  const r = db.prepare('select * from resets where token=?').get(req.body.token || '');
  if (!r || r.expires < Date.now()) throw bad('Havola eskirgan');
  if ((req.body.password || '').length < 6) throw bad('Parol kamida 6 belgi');
  db.prepare('update users set hash=? where id=?').run(bcrypt.hashSync(req.body.password, 10), r.user_id);
  db.prepare('delete from resets where token=?').run(r.token);
  res.json({ ok: true });
}));

app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));

// ---------- foydalanuvchi uchun kontent ----------
app.get('/api/movies', auth, (req, res) => res.json(db.prepare(
  'select m.*,c.name cat from movies m left join categories c on c.id=m.category_id order by m.id desc').all()));
app.get('/api/episodes', auth, (req, res) => res.json(db.prepare('select * from episodes where movie_id=? order by num').all(+req.query.movie)));
app.get('/api/categories', auth, (req, res) => res.json(db.prepare('select * from categories order by id').all()));
app.get('/api/banners', auth, (req, res) => res.json(db.prepare('select * from banners where active=1 order by id desc').all()));

// ---------- admin ----------
const A = express.Router();
A.use(auth, staff);
app.use('/api/admin', A);

A.put('/me', h((req, res) => {
  const u = req.user;
  if (!bcrypt.compareSync(req.body.current || '', u.hash)) throw bad("Joriy parol noto'g'ri");
  const email = (req.body.email || u.email).trim().toLowerCase();
  if (!isEmail(email)) throw bad("Email noto'g'ri");
  const other = db.prepare('select id from users where email=?').get(email);
  if (other && other.id !== u.id) throw bad('Bu email band');
  const hash = req.body.password ? (req.body.password.length < 6 ? (() => { throw bad('Parol kamida 6 belgi'); })() : bcrypt.hashSync(req.body.password, 10)) : u.hash;
  db.prepare('update users set email=?,hash=? where id=?').run(email, hash, u.id);
  res.json({ ok: true });
}));

A.post('/movies', need('movies'), fields, h((req, res) => {
  const b = req.body, f = got(req), isS = b.is_series === '1' || b.is_series === 'true' ? 1 : 0;
  const fail = m => { rm(f.video); rm(f.poster); throw bad(m); };
  if (!b.title?.trim() || !b.code?.trim()) fail('Nomi va kodi majburiy');
  if (db.prepare('select 1 from movies where code=?').get(b.code.trim())) fail('Bu kod band');
  if (!isS && !f.video) fail('Kino faylini tanlang');
  db.prepare('insert into movies(title,code,year,description,category_id,is_series,video,poster) values(?,?,?,?,?,?,?,?)')
    .run(b.title.trim(), b.code.trim(), +b.year || null, b.description || '', +b.category_id || null, isS, f.video, f.poster);
  broadcast(); res.json({ ok: true });
}));
A.put('/movies/:id', need('movies'), h((req, res) => {
  const b = req.body;
  db.prepare('update movies set title=coalesce(?,title),year=coalesce(?,year),description=coalesce(?,description),category_id=coalesce(?,category_id) where id=?')
    .run(b.title ?? null, b.year ? +b.year : null, b.description ?? null, b.category_id ? +b.category_id : null, +req.params.id);
  broadcast(); res.json({ ok: true });
}));
A.delete('/movies/:id', need('movies'), h((req, res) => {
  const id = +req.params.id, m = db.prepare('select * from movies where id=?').get(id);
  if (m) { rm(m.video); rm(m.poster); db.prepare('select video from episodes where movie_id=?').all(id).forEach(e => rm(e.video)); }
  db.prepare('delete from episodes where movie_id=?').run(id); db.prepare('delete from movies where id=?').run(id);
  broadcast(); res.json({ ok: true });
}));
A.post('/episodes', need('movies'), fields, h((req, res) => {
  const f = got(req), num = +req.body.num, mid = +req.body.movie_id;
  if (!f.video || !num || !mid) { rm(f.video); throw bad('Qism raqami va faylini kiriting'); }
  db.prepare('insert into episodes(movie_id,num,video) values(?,?,?)').run(mid, num, f.video);
  broadcast(); res.json({ ok: true });
}));
A.delete('/episodes/:id', need('movies'), h((req, res) => {
  const e = db.prepare('select * from episodes where id=?').get(+req.params.id);
  if (e) rm(e.video);
  db.prepare('delete from episodes where id=?').run(+req.params.id); broadcast(); res.json({ ok: true });
}));

A.post('/categories', need('categories'), h((req, res) => {
  const n = (req.body.name || '').trim(); if (!n) throw bad('Nom kiriting');
  try { db.prepare('insert into categories(name) values(?)').run(n); } catch { throw bad('Bunday janr bor'); }
  broadcast(); res.json({ ok: true });
}));
A.delete('/categories/:id', need('categories'), h((req, res) => {
  db.prepare('update movies set category_id=null where category_id=?').run(+req.params.id);
  db.prepare('delete from categories where id=?').run(+req.params.id); broadcast(); res.json({ ok: true });
}));

A.post('/banners', need('banners'), upload.single('file'), h((req, res) => {
  if (!req.file) throw bad('Fayl tanlang');
  const kind = req.file.mimetype.startsWith('video') ? 'video' : 'image';
  db.prepare('insert into banners(place,kind,file,link) values(?,?,?,?)').run(['top', 'middle', 'bottom'].includes(req.body.place) ? req.body.place : 'top', kind, url(req.file.filename), req.body.link || '');
  broadcast(); res.json({ ok: true });
}));
A.get('/banners', need('banners'), (req, res) => res.json(db.prepare('select * from banners order by id desc').all()));
A.patch('/banners/:id', need('banners'), h((req, res) => {
  db.prepare('update banners set active=? where id=?').run(req.body.active ? 1 : 0, +req.params.id); broadcast(); res.json({ ok: true });
}));
A.delete('/banners/:id', need('banners'), h((req, res) => {
  const b = db.prepare('select * from banners where id=?').get(+req.params.id); if (b) rm(b.file);
  db.prepare('delete from banners where id=?').run(+req.params.id); broadcast(); res.json({ ok: true });
}));

A.get('/users', need('users'), (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db.prepare("select id,email,first,last,age,banned,created,tg_id,phone,username from users where role='user' and (email like ? or first like ? or last like ? or phone like ? or username like ?) order by id desc limit 300").all(q, q, q, q, q);
  res.json({ total: db.prepare("select count(*) c from users where role='user'").get().c, rows });
});
A.patch('/users/:id', need('users'), h((req, res) => {
  db.prepare("update users set banned=? where id=? and role='user'").run(req.body.banned ? 1 : 0, +req.params.id); res.json({ ok: true });
}));
A.delete('/users/:id', need('users'), h((req, res) => {
  db.prepare("delete from users where id=? and role='user'").run(+req.params.id); res.json({ ok: true });
}));

A.get('/admins', need('super'), (req, res) => res.json(db.prepare("select id,email,perms from users where role='admin'").all()));
A.post('/admins', need('super'), h((req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!isEmail(email) || (req.body.password || '').length < 6) throw bad("Email va parol (kamida 6 belgi) kiriting");
  if (db.prepare('select 1 from users where email=?').get(email)) throw bad('Bu email band');
  db.prepare("insert into users(email,first,last,hash,role,perms) values(?,?,?,?,'admin',?)").run(email, 'Admin', '', bcrypt.hashSync(req.body.password, 10), cleanPerms(req.body.perms));
  res.json({ ok: true });
}));
A.put('/admins/:id', need('super'), h((req, res) => {
  db.prepare("update users set perms=? where id=? and role='admin'").run(cleanPerms(req.body.perms), +req.params.id);
  if (req.body.password) {
    if (req.body.password.length < 6) throw bad('Parol kamida 6 belgi');
    db.prepare("update users set hash=? where id=? and role='admin'").run(bcrypt.hashSync(req.body.password, 10), +req.params.id);
  }
  res.json({ ok: true });
}));
A.delete('/admins/:id', need('super'), h((req, res) => {
  db.prepare("delete from users where id=? and role='admin'").run(+req.params.id); res.json({ ok: true });
}));

A.put('/settings', need('settings'), h((req, res) => {
  db.prepare("insert into settings values('siteName',?) on conflict(key) do update set value=excluded.value").run((req.body.siteName || 'Kino Bazza').trim());
  broadcast(); res.json({ ok: true });
}));

// ---------- Telegram mini ilova orqali kirish ----------
app.post('/api/auth/telegram', h(async (req, res) => {
  const r = bots.checkInit(req.body.initData || '');
  if (!r) throw bad('Telegram ma\'lumoti tasdiqlanmadi', 401);
  const u = bots.upsert(r.user), g = await bots.gate(r.bot, u);
  if (!g.ok) throw bad(g.step === 'ban' ? 'Hisobingiz bloklangan' : g.step === 'phone' ? 'Avval botga qaytib /start bosing va telefon raqamingizni yuboring' : 'Avval botda kanallarga obuna bo\'lib, "Tekshirish" ni bosing', 403);
  res.json({ token: sign(u), user: pub(u) });
}));

// ---------- botlarni boshqarish (faqat super admin) ----------
A.get('/bots', need('super'), (req, res) => {
  const rows = db.prepare('select id,username,name,welcome,need_phone,sub_on,active from bots order by id').all();
  rows.forEach(b => { b.channels = db.prepare('select * from channels where bot_id=?').all(b.id); b.running = bots.isRunning(b.id); });
  res.json({ rows, users: db.prepare('select count(*) c from users where tg_id is not null').get().c });
});
A.post('/bots', need('super'), h(async (req, res) => {
  const token = (req.body.token || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) throw bad("Token noto'g'ri ko'rinadi");
  if (db.prepare('select 1 from bots where token=?').get(token)) throw bad("Bu bot allaqachon qo'shilgan");
  let me; try { me = await bots.tg(token, 'getMe'); } catch { throw bad("Bu token ishlamadi. BotFather'dan qayta tekshiring"); }
  const id = db.prepare('insert into bots(token,username,name) values(?,?,?)').run(token, me.username, me.first_name).lastInsertRowid;
  bots.start(Number(id)); res.json({ ok: true });
}));
A.put('/bots/:id', need('super'), h((req, res) => {
  const b = req.body, id = +req.params.id, f = v => (v === undefined ? null : v ? 1 : 0);
  db.prepare('update bots set welcome=coalesce(?,welcome),need_phone=coalesce(?,need_phone),sub_on=coalesce(?,sub_on),active=coalesce(?,active) where id=?')
    .run(b.welcome ?? null, f(b.need_phone), f(b.sub_on), f(b.active), id);
  const bot = db.prepare('select * from bots where id=?').get(id);
  if (bot.active) bots.start(id); else bots.stop(id);
  res.json({ ok: true });
}));
A.delete('/bots/:id', need('super'), h((req, res) => {
  const id = +req.params.id; bots.stop(id);
  db.prepare('delete from channels where bot_id=?').run(id); db.prepare('delete from bots where id=?').run(id); res.json({ ok: true });
}));
A.post('/bots/:id/channels', need('super'), h((req, res) => {
  const b = req.body, kind = b.kind === 'telegram' ? 'telegram' : 'link';
  let chat = (b.chat || '').trim(), url = (b.url || '').trim();
  if (kind === 'telegram') {
    if (!chat) throw bad('Kanal @nomini yoki ID sini kiriting');
    if (!/^-?\d+$/.test(chat) && !chat.startsWith('@')) chat = '@' + chat;
  } else if (!/^https?:\/\//.test(url)) throw bad('Havola https:// bilan boshlansin');
  db.prepare('insert into channels(bot_id,kind,title,chat,url) values(?,?,?,?,?)').run(+req.params.id, kind, (b.title || '').trim(), kind === 'telegram' ? chat : '', url);
  res.json({ ok: true });
}));
A.delete('/channels/:id', need('super'), h((req, res) => { db.prepare('delete from channels where id=?').run(+req.params.id); res.json({ ok: true }); }));
A.post('/bots/:id/broadcast', need('super'), h((req, res) => {
  const t = (req.body.text || '').trim(); if (!t) throw bad('Xabar matnini yozing');
  res.json({ sent: bots.broadcast(+req.params.id, t) });
}));

app.use((e, req, res, next) => res.status(500).json({ error: e.message }));
app.listen(PORT, () => { console.log('Kino Bazza ishga tushdi: ' + BASE); bots.startAll(); });
