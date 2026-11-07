const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = localStorage.t || '';
let me, cats = [], tab = '';
function toast(t) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 3000); }

// JSON yoki FormData (yuklash foizi bilan)
function api(p, method = 'GET', body, bar) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest(); x.open(method, '/api' + p);
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    let data = body;
    if (body && !(body instanceof FormData)) { x.setRequestHeader('Content-Type', 'application/json'); data = JSON.stringify(body); }
    if (bar && x.upload) x.upload.onprogress = e => { if (e.lengthComputable) { bar.style.display = 'block'; bar.firstElementChild.style.width = (e.loaded / e.total * 100) + '%'; } };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { } x.status < 300 ? ok(d) : no(new Error(d.error || 'Xatolik')); };
    x.onerror = () => no(new Error('Tarmoq xatosi'));
    x.send(data);
  });
}
const can = p => me.role === 'super' || (me.perms || '').split(',').includes(p);
const TABS = [['movies', '🎬 Kinolar'], ['categories', '🏷 Janrlar'], ['banners', '📢 Reklama'], ['users', '👥 Foydalanuvchilar'], ['admins', '🛡 Adminlar', 'super'], ['bots', '🤖 Botlar', 'super'], ['settings', '⚙ Sozlamalar']];

async function init() {
  if (!token) return location.href = '/';
  try { me = await api('/me'); } catch { return location.href = '/'; }
  if (!['super', 'admin'].includes(me.role)) return location.href = '/';
  const allowed = TABS.filter(t => t[2] === 'super' ? me.role === 'super' : (t[0] === 'settings' || can(t[0])));
  tab = allowed[0][0];
  $('#app').innerHTML = `<div class="adm"><div class="side"><div class="logo">Boshqaruv</div>
    ${allowed.map(t => `<button data-t="${t[0]}">${t[1]}</button>`).join('')}
    <button id="home">← Saytga qaytish</button></div><div class="pane" id="pane"></div></div>`;
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; go(); });
  $('#home').onclick = () => location.href = '/';
  go();
}
function go() {
  document.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  ({ movies, categories, banners, users, admins, bots, settings })[tab]();
}
const pane = html => { $('#pane').innerHTML = html; };
const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); } };
const loadCats = async () => { cats = await api('/categories'); };
const catOpts = () => '<option value="">Janrni tanlang</option>' + cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
// foydalanuvchi API'si (admin ham o'qiy oladi)
const get = p => api(p);
Object.assign(window, {});

/* ---------- KINOLAR ---------- */
async function movies() {
  await loadCats(); const list = await get('/movies');
  pane(`<h2>Kinolar</h2><form class="glass box2" id="mf">
    <input name="title" placeholder="Kino nomi" required><input name="code" placeholder="Kino kodi (masalan 125)" required>
    <div class="row"><input name="year" type="number" placeholder="Yili"><select name="category_id" id="sel">${catOpts()}</select></div>
    <textarea name="description" rows="3" placeholder="Tavsif"></textarea>
    <label><input type="checkbox" id="ser" style="width:auto"> Bu serial (qismlar keyin qo'shiladi)</label>
    <label>Rasm (poster)</label><input type="file" name="poster" accept="image/*">
    <div id="vw"><label>Kino fayli</label><input type="file" name="video" accept="video/*"></div>
    <div class="bar" id="bar"><i></i></div><button class="btn" style="margin-top:12px">Saqlash</button></form>
    <div class="glass box2">${list.map(m => `<div class="li"><img src="${m.poster || ''}" onerror="this.style.visibility='hidden'">
      <div class="grow"><b>${esc(m.title)}</b> <small>#${esc(m.code)} · ${m.year || ''} · ${esc(m.cat || 'janrsiz')}${m.is_series ? ' · Serial' : ''}</small></div>
      ${m.is_series ? `<button class="btn sm ghost" data-ep="${m.id}">+ Qism</button>` : ''}
      <button class="btn sm ghost" data-ed="${m.id}">✏</button><button class="btn sm red" data-del="${m.id}">🗑</button></div>`).join('') || '<p>Hali kino yo\'q</p>'}</div>`);
  $('#ser').onchange = e => $('#vw').style.display = e.target.checked ? 'none' : 'block';
  $('#mf').onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); fd.set('is_series', $('#ser').checked ? '1' : '0'); if ($('#ser').checked) fd.delete('video'); run(async () => { await api('/admin/movies', 'POST', fd, $('#bar')); movies(); }, 'Saqlandi'); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm("O'chirilsinmi?") && run(async () => { await api('/admin/movies/' + b.dataset.del, 'DELETE'); movies(); }));
  document.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => {
    const m = list.find(x => x.id == b.dataset.ed), title = prompt('Nomi', m.title); if (title === null) return;
    const year = prompt('Yili', m.year || ''), description = prompt('Tavsif', m.description || '');
    run(async () => { await api('/admin/movies/' + m.id, 'PUT', { title, year, description }); movies(); }, 'Yangilandi');
  });
  document.querySelectorAll('[data-ep]').forEach(b => b.onclick = () => {
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'video/*';
    const num = prompt('Qism raqami (masalan 1)'); if (!num) return;
    f.onchange = () => { const fd = new FormData(); fd.set('movie_id', b.dataset.ep); fd.set('num', num); fd.set('video', f.files[0]); toast('Yuklanmoqda...'); run(() => api('/admin/episodes', 'POST', fd), 'Qism qo\'shildi'); };
    f.click();
  });
}

/* ---------- JANRLAR ---------- */
async function categories() {
  await loadCats();
  pane(`<h2>Janrlar</h2><form class="glass box2 row" id="cf"><input name="name" placeholder="Yangi janr (Serial, Ujas...)" required><button class="btn" style="flex:0 0 auto">Qo'shish</button></form>
    <div class="glass box2">${cats.map(c => `<div class="li"><div class="grow">${esc(c.name)}</div><button class="btn sm red" data-del="${c.id}">🗑</button></div>`).join('')}</div>`);
  $('#cf').onsubmit = e => { e.preventDefault(); run(async () => { await api('/admin/categories', 'POST', Object.fromEntries(new FormData(e.target))); categories(); }); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => run(async () => { await api('/admin/categories/' + b.dataset.del, 'DELETE'); categories(); }));
}

/* ---------- REKLAMA ---------- */
async function banners() {
  const list = await api('/admin/banners');
  pane(`<h2>Reklama bannerlari</h2><form class="glass box2" id="bf">
    <label>Qayerda ko'rinsin</label><select name="place"><option value="top">Tepada</option><option value="middle">O'rtada</option><option value="bottom">Pastda</option></select>
    <input name="link" placeholder="Bosilganda ochiladigan havola (ixtiyoriy)"><label>Rasm yoki video</label>
    <input type="file" name="file" accept="image/*,video/*" required><div class="bar" id="bar"><i></i></div><button class="btn" style="margin-top:12px">Joylash</button></form>
    <div class="glass box2">${list.map(b => `<div class="li">${b.kind === 'video' ? `<video src="${b.file}" muted></video>` : `<img src="${b.file}">`}
      <div class="grow"><b>${{ top: 'Tepada', middle: "O'rtada", bottom: 'Pastda' }[b.place]}</b><small>${b.active ? '🟢 Yoqilgan' : '⚪ O\'chirilgan'}</small></div>
      <button class="btn sm ghost" data-tg="${b.id}" data-a="${b.active}">${b.active ? "O'chirish" : 'Yoqish'}</button><button class="btn sm red" data-del="${b.id}">🗑</button></div>`).join('') || '<p>Banner yo\'q</p>'}</div>`);
  $('#bf').onsubmit = e => { e.preventDefault(); run(async () => { await api('/admin/banners', 'POST', new FormData(e.target), $('#bar')); banners(); }, 'Joylandi'); };
  document.querySelectorAll('[data-tg]').forEach(b => b.onclick = () => run(async () => { await api('/admin/banners/' + b.dataset.tg, 'PATCH', { active: b.dataset.a !== '1' }); banners(); }));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => run(async () => { await api('/admin/banners/' + b.dataset.del, 'DELETE'); banners(); }));
}

/* ---------- FOYDALANUVCHILAR ---------- */
async function users(q = '') {
  const d = await api('/admin/users?q=' + encodeURIComponent(q));
  pane(`<h2>Foydalanuvchilar: ${d.total} ta</h2><input id="uq" placeholder="🔍 Ism yoki email bo'yicha qidirish" value="${esc(q)}">
    <div class="glass box2">${d.rows.map(u => `<div class="li"><div class="grow"><b>${esc(u.first)} ${esc(u.last)}</b> ${u.banned ? '🚫' : ''}<small>${u.tg_id ? '✈ Telegram' + (u.username ? ' @' + esc(u.username) : '') + (u.phone ? ' · ' + esc(u.phone) : '') : esc(u.email) + ' · ' + (u.age || '?') + ' yosh'} · ${u.created.slice(0, 10)}</small></div>
      <button class="btn sm ghost" data-b="${u.id}" data-v="${u.banned}">${u.banned ? 'Blokdan chiqarish' : 'Bloklash'}</button><button class="btn sm red" data-del="${u.id}">🗑</button></div>`).join('') || '<p>Topilmadi</p>'}</div>`);
  let t; $('#uq').oninput = e => { clearTimeout(t); t = setTimeout(() => users(e.target.value), 400); };
  $('#uq').focus(); $('#uq').setSelectionRange(99, 99);
  document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => run(async () => { await api('/admin/users/' + b.dataset.b, 'PATCH', { banned: b.dataset.v !== '1' }); users(q); }));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm("Foydalanuvchi o'chirilsinmi?") && run(async () => { await api('/admin/users/' + b.dataset.del, 'DELETE'); users(q); }));
}

/* ---------- ADMINLAR (faqat super admin) ---------- */
const PL = { movies: 'Kinolar', categories: 'Janrlar', banners: 'Reklama', users: 'Foydalanuvchilar', settings: 'Sozlamalar' };
const permBoxes = (sel = '') => Object.entries(PL).map(([k, v]) => `<label class="perm"><input type="checkbox" value="${k}" ${sel.split(',').includes(k) ? 'checked' : ''}>${v}</label>`).join('');
const picked = r => [...r.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
async function admins() {
  const list = await api('/admin/admins');
  pane(`<h2>Yordamchi adminlar</h2><form class="glass box2" id="af"><input name="email" type="email" placeholder="Admin emaili" required><input name="password" placeholder="Parol (kamida 6 belgi)" required minlength="6">
    <label>Funksiyalari</label><div id="pb">${permBoxes()}</div><button class="btn" style="margin-top:12px">Admin qo'shish</button></form>
    <div class="glass box2">${list.map(a => `<div class="li" data-id="${a.id}"><div class="grow"><b>${esc(a.email)}</b><div>${permBoxes(a.perms)}</div></div>
      <button class="btn sm ghost" data-save="${a.id}">Saqlash</button><button class="btn sm ghost" data-pw="${a.id}">Parol</button><button class="btn sm red" data-del="${a.id}">Chiqarish</button></div>`).join('') || '<p>Admin yo\'q</p>'}</div>`);
  $('#af').onsubmit = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.perms = picked($('#pb')); run(async () => { await api('/admin/admins', 'POST', d); admins(); }, 'Admin qo\'shildi'); };
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = () => run(() => api('/admin/admins/' + b.dataset.save, 'PUT', { perms: picked(b.closest('.li')) }), 'Saqlandi'));
  document.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => { const p = prompt('Yangi parol'); if (p) run(() => api('/admin/admins/' + b.dataset.pw, 'PUT', { perms: picked(b.closest('.li')), password: p }), 'Parol almashdi'); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm('Admin chiqarilsinmi?') && run(async () => { await api('/admin/admins/' + b.dataset.del, 'DELETE'); admins(); }));
}

/* ---------- BOTLAR (faqat super admin) ---------- */
async function bots() {
  const d = await api('/admin/bots');
  const chk = (f, v) => `<label class="perm"><input type="checkbox" data-f="${f}" ${v ? 'checked' : ''}>`;
  pane(`<h2>Telegram botlar</h2><p style="color:var(--mut);margin-bottom:12px">Bot orqali kirgan foydalanuvchilar: ${d.users} ta</p>
    <form class="glass box2" id="bf"><label>BotFather bergan token</label><input name="token" placeholder="123456789:AAH..." required><button class="btn" style="margin-top:10px">Bot qo'shish</button></form>
    ${d.rows.map(b => `<div class="glass box2" data-b="${b.id}"><h3>@${esc(b.username)} ${b.running ? '🟢' : '🔴'}</h3>
      ${chk('active', b.active)}Yoqilgan</label>${chk('need_phone', b.need_phone)}Telefon raqam majburiy</label>${chk('sub_on', b.sub_on)}Majburiy obuna</label>
      <label>Salomlashuv xabari ({ism} — foydalanuvchi ismi)</label><textarea data-f="welcome" rows="3">${esc(b.welcome)}</textarea>
      <button class="btn sm" data-save style="margin-top:8px">Saqlash</button>
      <h4 style="margin:16px 0 6px">Majburiy obuna kanallari</h4>
      ${b.channels.map(c => `<div class="li"><div class="grow">${c.kind === 'telegram' ? '📢 ' + esc(c.chat) : '🔗 ' + esc(c.url)} <small>${esc(c.title)}</small></div><button class="btn sm red" data-chdel="${c.id}">🗑</button></div>`).join('') || '<small>Kanal yo\'q</small>'}
      <div class="row" style="margin-top:8px"><select data-k><option value="telegram">Telegram kanal/guruh</option><option value="link">Instagram / YouTube / havola</option></select><input data-t placeholder="Tugma nomi"></div>
      <div class="row"><input data-c placeholder="@kanal_nomi (Telegram uchun)"><input data-u placeholder="https://... (boshqa havola uchun)"></div>
      <button class="btn sm ghost" data-chadd>+ Kanal qo'shish</button>
      <h4 style="margin:16px 0 6px">Hammaga xabar yuborish</h4><textarea data-bc rows="2" placeholder="Xabar matni"></textarea>
      <button class="btn sm ghost" data-send>Yuborish</button> <button class="btn sm red" data-rm>Botni o'chirish</button></div>`).join('')}`);
  $('#bf').onsubmit = e => { e.preventDefault(); run(async () => { await api('/admin/bots', 'POST', Object.fromEntries(new FormData(e.target))); bots(); }, "Bot qo'shildi"); };
  document.querySelectorAll('[data-b]').forEach(box => {
    const id = box.dataset.b;
    box.querySelector('[data-save]').onclick = () => run(async () => {
      const body = { welcome: box.querySelector('[data-f=welcome]').value };
      ['active', 'need_phone', 'sub_on'].forEach(f => body[f] = box.querySelector(`[data-f=${f}]`).checked);
      await api('/admin/bots/' + id, 'PUT', body); bots();
    }, 'Saqlandi');
    box.querySelector('[data-chadd]').onclick = () => run(async () => {
      await api(`/admin/bots/${id}/channels`, 'POST', { kind: box.querySelector('[data-k]').value, title: box.querySelector('[data-t]').value, chat: box.querySelector('[data-c]').value, url: box.querySelector('[data-u]').value }); bots();
    }, "Kanal qo'shildi");
    box.querySelectorAll('[data-chdel]').forEach(b => b.onclick = () => run(async () => { await api('/admin/channels/' + b.dataset.chdel, 'DELETE'); bots(); }));
    box.querySelector('[data-send]').onclick = () => { const t = box.querySelector('[data-bc]').value; if (t && confirm('Hammaga yuborilsinmi?')) run(async () => { const r = await api(`/admin/bots/${id}/broadcast`, 'POST', { text: t }); toast(r.sent + ' ta foydalanuvchiga yuborilmoqda'); }); };
    box.querySelector('[data-rm]').onclick = () => confirm("Bot o'chirilsinmi?") && run(async () => { await api('/admin/bots/' + id, 'DELETE'); bots(); });
  });
}

/* ---------- SOZLAMALAR ---------- */
async function settings() {
  const cfg = await fetch('/api/config').then(r => r.json());
  pane(`<h2>Sozlamalar</h2>
    ${can('settings') ? `<form class="glass box2" id="sf"><label>Sayt nomi</label><input name="siteName" value="${esc(cfg.siteName)}"><button class="btn" style="margin-top:10px">Saqlash</button></form>` : ''}
    <form class="glass box2" id="mf2"><h3 style="margin-bottom:8px">Kirish ma'lumotlarim</h3><input name="email" type="email" value="${esc(me.email)}" required>
      <input name="password" type="password" placeholder="Yangi parol (o'zgartirmasangiz bo'sh qoldiring)"><input name="current" type="password" placeholder="Joriy parol (majburiy)" required><button class="btn" style="margin-top:10px">Yangilash</button></form>`);
  if ($('#sf')) $('#sf').onsubmit = e => { e.preventDefault(); run(() => api('/admin/settings', 'PUT', Object.fromEntries(new FormData(e.target))), 'Saqlandi'); };
  $('#mf2').onsubmit = e => { e.preventDefault(); run(async () => { await api('/admin/me', 'PUT', Object.fromEntries(new FormData(e.target))); toast('Yangilandi. Qaytadan kiring'); localStorage.removeItem('t'); setTimeout(() => location.href = '/', 1200); }); };
}
init();
