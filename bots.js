// Telegram botlar: long polling (hech qanday webhook/HTTPS sozlash shart emas)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAXV = 49 * 1024 * 1024; // Telegram bot orqali yuborish chegarasi ~50MB

module.exports = function ({ db, UP, BASE }) {
  const running = new Map();
  const isHttps = BASE.startsWith('https://');

  async function tg(token, method, params = {}, files = {}) {
    let body, headers;
    if (Object.keys(files).length) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(params)) if (v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const [k, p] of Object.entries(files)) fd.append(k, await fs.openAsBlob(p), path.basename(p));
      body = fd;
    } else { body = JSON.stringify(params); headers = { 'Content-Type': 'application/json' }; }
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body, headers });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description || 'Telegram xatosi');
    return d.result;
  }

  function upsert(f) {
    const u = db.prepare('select * from users where tg_id=?').get(f.id);
    if (!u) {
      const id = db.prepare('insert into users(email,first,last,hash,tg_id,username) values(?,?,?,?,?,?)')
        .run(`tg${f.id}@telegram.local`, f.first_name || '', f.last_name || '', crypto.randomBytes(16).toString('hex'), f.id, f.username || null).lastInsertRowid;
      return db.prepare('select * from users where id=?').get(id);
    }
    db.prepare('update users set username=?,first=? where id=?').run(f.username || null, f.first_name || u.first, u.id);
    return db.prepare('select * from users where id=?').get(u.id);
  }
  const fresh = id => db.prepare('select * from users where id=?').get(id);
  const chUrl = c => c.url || (c.chat && !/^-?\d+$/.test(c.chat) ? 'https://t.me/' + c.chat.replace('@', '') : null);

  // Shartlar: bloklanmagan, telefon, majburiy obuna
  async function gate(bot, u) {
    if (u.banned) return { ok: false, step: 'ban' };
    if (bot.need_phone && !u.phone) return { ok: false, step: 'phone' };
    if (bot.sub_on) {
      const chs = db.prepare('select * from channels where bot_id=?').all(bot.id), miss = [];
      for (const c of chs) {
        if (c.kind === 'telegram') {
          try {
            const m = await tg(bot.token, 'getChatMember', { chat_id: c.chat, user_id: u.tg_id });
            if (!['member', 'administrator', 'creator'].includes(m.status)) miss.push(c);
          } catch (e) { console.log(`Kanalni tekshirib bo'lmadi (${c.chat}): bot kanalda admin bo'lishi kerak.`, e.message); }
        } else if (!u.link_ok) miss.push(c); // Instagram/YouTube tekshirib bo'lmaydi: bir marta "Tekshirish" bosiladi
      }
      if (miss.length) return { ok: false, step: 'sub', miss, all: chs };
    }
    return { ok: true };
  }

  async function prompt(bot, u, g) {
    const T = (a, b) => tg(bot.token, a, b);
    if (g.step === 'ban') return T('sendMessage', { chat_id: u.tg_id, text: '🚫 Siz bloklangansiz.' });
    if (g.step === 'phone') return T('sendMessage', {
      chat_id: u.tg_id, text: '📱 Botdan foydalanish uchun telefon raqamingizni yuboring (pastdagi tugma).',
      reply_markup: { keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    });
    const rows = g.all.map(c => [{ text: (c.kind === 'telegram' ? '📢 ' : '🔗 ') + (c.title || c.chat || 'Havola'), url: chUrl(c) }]).filter(r => r[0].url);
    rows.push([{ text: '✅ Tekshirish', callback_data: 'chk' }]);
    return T('sendMessage', { chat_id: u.tg_id, text: "Botdan foydalanish uchun quyidagilarga obuna bo'ling, so'ng \"Tekshirish\" ni bosing:", reply_markup: { inline_keyboard: rows } });
  }

  const fileOf = u => (u && u.startsWith('/uploads/') ? path.join(UP, path.basename(u)) : null);
  async function sendVideoFile(bot, chat, url, title, mid) {
    const T = (a, b, c) => tg(bot.token, a, b, c), vp = fileOf(url);
    if (!vp || !fs.existsSync(vp)) return;
    if (fs.statSync(vp).size > MAXV) {
      const kb = isHttps ? { inline_keyboard: [[{ text: "▶ Mini ilovada ko'rish", web_app: { url: `${BASE}/?m=${mid}` } }]] } : undefined;
      return T('sendMessage', { chat_id: chat, text: "📺 Video hajmi katta, uni mini ilovada ko'ring 👇", reply_markup: kb });
    }
    await T('sendVideo', { chat_id: chat, caption: '🎬 ' + title, supports_streaming: true }, { video: vp });
  }

  async function sendMovie(bot, chat, m) {
    const T = (a, b, c) => tg(bot.token, a, b, c);
    const desc = (m.description || '').slice(0, 600);
    const caption = `🎬 <b>${esc(m.title)}</b>\n` + [m.year && `📅 ${m.year}`, m.cat && `🏷 ${esc(m.cat)}`, `🔑 Kod: ${esc(m.code)}`].filter(Boolean).join('\n') + (desc ? `\n\n${esc(desc)}` : '');
    const rows = [];
    if (m.is_series) {
      const eps = db.prepare('select * from episodes where movie_id=? order by num').all(m.id);
      for (let i = 0; i < eps.length; i += 4) rows.push(eps.slice(i, i + 4).map(e => ({ text: `${e.num}-qism`, callback_data: 'ep:' + e.id })));
    }
    if (isHttps) rows.push([{ text: "▶ Mini ilovada ko'rish", web_app: { url: `${BASE}/?m=${m.id}` } }]);
    const markup = rows.length ? { inline_keyboard: rows } : undefined, pf = fileOf(m.poster);
    if (pf && fs.existsSync(pf)) await T('sendPhoto', { chat_id: chat, caption, parse_mode: 'HTML', reply_markup: markup }, { photo: pf });
    else await T('sendMessage', { chat_id: chat, text: caption, parse_mode: 'HTML', reply_markup: markup });
    if (!m.is_series) await sendVideoFile(bot, chat, m.video, m.title, m.id);
  }

  async function welcome(bot, u) {
    const text = (bot.welcome || "Salom, {ism}! 🎬\nKino kodini yuboring yoki mini ilovani oching.").replace(/\{ism\}/g, u.first || '');
    const kb = isHttps ? { inline_keyboard: [[{ text: '🎬 Kino Bazza', web_app: { url: BASE } }]] } : undefined;
    return tg(bot.token, 'sendMessage', { chat_id: u.tg_id, text, reply_markup: kb });
  }

  async function handle(id, up) {
    const bot = db.prepare('select * from bots where id=? and active=1').get(id);
    if (!bot) return;
    const T = (a, b, c) => tg(bot.token, a, b, c);
    if (up.callback_query) {
      const cq = up.callback_query; let u = upsert(cq.from); const d = cq.data || '';
      if (d === 'chk') {
        db.prepare('update users set link_ok=1 where id=?').run(u.id); u = fresh(u.id);
        const g = await gate(bot, u);
        await T('answerCallbackQuery', { callback_query_id: cq.id, text: g.ok ? '✅ Rahmat!' : "❌ Hali obuna bo'lmagansiz" });
        return g.ok ? welcome(bot, u) : prompt(bot, u, g);
      }
      const g = await gate(bot, u);
      if (!g.ok) { await T('answerCallbackQuery', { callback_query_id: cq.id, text: 'Avval /start bosing' }); return; }
      if (d.startsWith('ep:')) {
        await T('answerCallbackQuery', { callback_query_id: cq.id });
        const e = db.prepare('select e.*,m.title from episodes e join movies m on m.id=e.movie_id where e.id=?').get(+d.slice(3));
        if (e) await sendVideoFile(bot, cq.from.id, e.video, `${e.title} — ${e.num}-qism`, e.movie_id);
      }
      return;
    }
    const m = up.message;
    if (!m || m.chat.type !== 'private') return;
    let u = upsert(m.from);
    if (m.contact) {
      if (m.contact.user_id !== m.from.id) return T('sendMessage', { chat_id: u.tg_id, text: "Faqat o'zingizning raqamingizni yuboring." });
      db.prepare('update users set phone=? where id=?').run(m.contact.phone_number, u.id); u = fresh(u.id);
      await T('sendMessage', { chat_id: u.tg_id, text: '✅ Raqam qabul qilindi', reply_markup: { remove_keyboard: true } });
    }
    const g = await gate(bot, u);
    if (!g.ok) return prompt(bot, u, g);
    const text = (m.text || '').trim();
    if (m.contact || text.startsWith('/start')) return welcome(bot, u);
    if (!text) return;
    const mv = db.prepare('select m.*,c.name cat from movies m left join categories c on c.id=m.category_id where lower(m.code)=lower(?)').get(text.replace(/^#/, ''));
    if (!mv) return T('sendMessage', { chat_id: u.tg_id, text: '😕 Bunday kodli kino topilmadi. Kodni tekshirib qayta yuboring.' });
    return sendMovie(bot, u.tg_id, mv);
  }

  async function poll(bot) {
    const st = { stop: false }; running.set(bot.id, st);
    try { await tg(bot.token, 'deleteWebhook', {}); } catch { }
    if (BASE.startsWith('https://')) try { await tg(bot.token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: '🎬 Kino Bazza', web_app: { url: BASE } } }); } catch { }
    let offset = 0;
    while (!st.stop) {
      try {
        const ups = await tg(bot.token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of ups) { offset = u.update_id + 1; handle(bot.id, u).catch(e => console.log('Bot xatosi:', e.message)); }
      } catch (e) {
        if (/Unauthorized/i.test(e.message)) { console.log('Bot tokeni yaroqsiz:', bot.username); break; }
        await sleep(e.message.includes('Conflict') ? 8000 : 3000);
      }
    }
    if (running.get(bot.id) === st) running.delete(bot.id);
  }
  const start = id => { const b = db.prepare('select * from bots where id=?').get(id); if (b && b.active && !running.has(id)) poll(b); };
  const stop = id => { const s = running.get(id); if (s) { s.stop = true; running.delete(id); } };
  const startAll = () => db.prepare('select id from bots where active=1').all().forEach(b => start(b.id));

  function broadcast(botId, text) {
    const bot = db.prepare('select * from bots where id=?').get(botId);
    const us = db.prepare('select tg_id from users where tg_id is not null and banned=0').all();
    (async () => { for (const u of us) { try { await tg(bot.token, 'sendMessage', { chat_id: u.tg_id, text }); } catch { } await sleep(50); } })();
    return us.length;
  }

  // Mini ilovadan kelgan initData ni tekshirish (har bir faol bot tokeni bilan)
  function checkInit(initData) {
    const p = new URLSearchParams(initData), hash = p.get('hash'); p.delete('hash');
    if (!hash || !p.get('user')) return null;
    const str = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    for (const b of db.prepare('select * from bots where active=1').all()) {
      const secret = crypto.createHmac('sha256', 'WebAppData').update(b.token).digest();
      if (crypto.createHmac('sha256', secret).update(str).digest('hex') === hash) {
        if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
        return { bot: b, user: JSON.parse(p.get('user')) };
      }
    }
    return null;
  }

  return { tg, start, stop, startAll, broadcast, checkInit, upsert, gate, isRunning: id => running.has(id), handle };
};
