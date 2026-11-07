const $ = (s, r = document) => r.querySelector(s);
let token = localStorage.t || '', me = null, cfg = {}, movies = [], cats = [], banners = [], cat = '', q = '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(p, o = {}) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token;
  let b = o.body; if (b) { h['Content-Type'] = 'application/json'; b = JSON.stringify(b); }
  const r = await fetch('/api' + p, { method: o.method || 'GET', headers: h, body: b });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 || r.status === 403 && /blok/.test(d.error || '')) { if (token) logout(false); } throw new Error(d.error || 'Xatolik'); }
  return d;
}
function toast(t) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 3000); }
function logout(go = true) { localStorage.removeItem('t'); token = ''; me = null; if (go) showAuth(); }
function reveal() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 });
  document.querySelectorAll('.rv:not(.in)').forEach((e, i) => { e.style.transitionDelay = Math.min(i % 12, 11) * 50 + 'ms'; io.observe(e); });
}

/* ---------------- KIRISH ---------------- */
function showAuth(mode = 'login', gdata = null) {
  const reg = mode === 'register', forgot = mode === 'forgot', gc = mode === 'gcomplete', rst = mode === 'reset';
  $('#app').innerHTML = `<div class="auth"><div class="box glass">
    <h1 class="logo">${esc(cfg.siteName)}</h1><p class="sub">Eng sara kinolar bir joyda 🎬</p>
    ${(mode === 'login' || reg) ? `<div class="tabs"><button class="${!reg ? 'on' : ''}" data-m="login">Kirish</button><button class="${reg ? 'on' : ''}" data-m="register">Ro'yxatdan o'tish</button></div>` : ''}
    <form id="f">
      ${rst ? '' : `<input name="email" type="email" placeholder="Email" required ${gc ? 'readonly' : ''} value="${esc(gdata?.email || '')}">`}
      ${(reg || gc) ? `<div class="row"><input name="first" placeholder="Ism" required value="${esc(gdata?.first || '')}"><input name="last" placeholder="Familiya" required value="${esc(gdata?.last || '')}"></div><input name="age" type="number" placeholder="Yosh" min="5" max="120" required>` : ''}
      ${forgot ? '' : `<input name="password" type="password" placeholder="${rst ? 'Yangi parol' : 'Parol'}" required minlength="6">`}
      <div class="err" id="err"></div>
      <button class="btn" style="width:100%;margin-top:6px">${forgot ? 'Havola yuborish' : rst ? 'Parolni saqlash' : reg ? "Ro'yxatdan o'tish" : gc ? 'Hisobni yaratish' : 'Kirish'}</button>
    </form>
    ${mode === 'login' ? `<p style="text-align:center;margin-top:14px"><a data-m="forgot">Parolni unutdingizmi?</a></p>` : ''}
    ${forgot ? `<p style="text-align:center;margin-top:14px"><a data-m="login">← Orqaga</a></p>` : ''}
    ${((mode === 'login' || reg) && cfg.googleClientId) ? `<div class="sep">yoki</div><div id="g" style="display:flex;justify-content:center"></div>` : ''}
  </div></div>`;
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => showAuth(b.dataset.m));
  $('#f').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); $('#err').textContent = '';
    try {
      let r;
      if (forgot) { await api('/auth/forgot', { method: 'POST', body: d }); $('#err').className = 'err ok'; $('#err').textContent = "Agar email ro'yxatda bo'lsa, tiklash havolasi yuborildi"; return; }
      if (rst) { await api('/auth/reset', { method: 'POST', body: { token: new URLSearchParams(location.search).get('reset'), password: d.password } }); history.replaceState(null, '', '/'); toast('Parol yangilandi, kiring'); return showAuth(); }
      if (gc) r = await api('/auth/google/complete', { method: 'POST', body: { ...d, pending: gdata.pending } });
      else r = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: d });
      done(r);
    } catch (x) { $('#err').textContent = x.message; }
  };
  if ($('#g')) initGoogle();
}
function initGoogle() {
  if (!cfg.googleClientId) return;
  if (!window.google?.accounts) return setTimeout(initGoogle, 300);
  google.accounts.id.initialize({
    client_id: cfg.googleClientId, callback: async resp => {
      try {
        const r = await api('/auth/google', { method: 'POST', body: { credential: resp.credential } });
        if (r.needProfile) showAuth('gcomplete', r); else done(r);
      } catch (x) { toast(x.message); }
    }
  });
  google.accounts.id.renderButton($('#g'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
}
function done(r) { token = r.token; localStorage.t = token; me = r.user; boot(); }

/* ---------------- BOSH SAHIFA ---------------- */
const banHTML = place => banners.filter(b => b.place === place).map(b => {
  const m = b.kind === 'video' ? `<video src="${b.file}" autoplay muted loop playsinline></video>` : `<img src="${b.file}" alt="">`;
  return b.link ? `<a class="banner" href="${esc(b.link)}" target="_blank" rel="noopener">${m}</a>` : `<div class="banner">${m}</div>`;
}).join('');

function showHome() {
  const staff = me.role === 'super' || me.role === 'admin';
  $('#app').innerHTML = `<header><div class="logo">${esc(cfg.siteName)}</div>
    ${staff ? '<a class="btn sm ghost" href="/admin">⚙ Boshqaruv</a>' : ''}
    <button class="btn sm ghost" id="out">Chiqish</button></header>
    <main><div id="bt"></div><div class="search"><input id="q" placeholder="🔍 Kino nomi yoki kodi..." value="${esc(q)}"></div>
    <div class="chips" id="chips"></div><div class="grid" id="grid"></div><div id="bm"></div><div id="bb"></div></main>`;
  $('#out').onclick = () => logout();
  $('#q').oninput = e => { q = e.target.value; paint(); };
  paint();
}
function paint() {
  if (!$('#grid')) return;
  $('#bt').innerHTML = banHTML('top');
  $('#chips').innerHTML = [{ id: '', name: 'Hammasi' }, ...cats].map(c => `<div class="chip ${String(c.id) === String(cat) ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</div>`).join('');
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => { cat = c.dataset.c; paint(); });
  const s = q.trim().toLowerCase();
  const list = movies.filter(m => (!cat || String(m.category_id) === String(cat)) && (!s || m.title.toLowerCase().includes(s) || String(m.code).toLowerCase() === s));
  $('#grid').innerHTML = list.length ? list.map(m => `<div class="card rv" data-id="${m.id}">
      <div class="ph">${m.poster ? `<img loading="lazy" src="${m.poster}" alt="">` : '🎬'}</div>
      <div class="code">#${esc(m.code)}</div>
      <div class="tt"><b>${esc(m.title)}</b><span>${m.year || ''} ${m.cat ? '· ' + esc(m.cat) : ''}${m.is_series ? ' · Serial' : ''}</span></div></div>`).join('')
    : '<div class="empty" style="grid-column:1/-1">Hech narsa topilmadi 🍿</div>';
  document.querySelectorAll('.card').forEach(c => c.onclick = () => openMovie(+c.dataset.id));
  $('#bm').innerHTML = banHTML('middle'); $('#bb').innerHTML = banHTML('bottom');
  reveal();
}
async function openMovie(id) {
  const m = movies.find(x => x.id === id); if (!m) return;
  let eps = []; if (m.is_series) eps = await api('/episodes?movie=' + id);
  const md = document.createElement('div'); md.className = 'modal'; md.id = 'modal';
  const src = m.is_series ? eps[0]?.video : m.video;
  md.innerHTML = `<div class="in glass"><video id="pl" controls playsinline autoplay ${m.poster ? `poster="${m.poster}"` : ''} ${src ? `src="${src}"` : ''}></video>
    ${m.is_series ? `<div class="eps">${eps.map((e, i) => `<button class="${i ? '' : 'on'}" data-v="${e.video}">${e.num}-qism</button>`).join('') || '<span style="color:var(--mut)">Qismlar hali qo\'shilmagan</span>'}</div>` : ''}
    <h2>${esc(m.title)} <small style="color:var(--g1)">#${esc(m.code)}</small></h2>
    <p style="color:var(--mut)">${m.year || ''} ${m.cat ? '· ' + esc(m.cat) : ''}</p><p style="margin-top:10px;line-height:1.6">${esc(m.description)}</p>
    <button class="btn" style="margin-top:16px" id="cl">Yopish</button></div>`;
  document.body.append(md);
  const close = () => { md.remove(); };
  $('#cl', md).onclick = close; md.onclick = e => { if (e.target === md) close(); };
  md.querySelectorAll('.eps button').forEach(b => b.onclick = () => {
    md.querySelectorAll('.eps button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    const v = $('#pl', md); v.src = b.dataset.v; v.play();
  });
}
async function loadData() {
  [movies, cats, banners] = await Promise.all([api('/movies'), api('/categories'), api('/banners')]);
}

/* ---------------- BOSHLASH ---------------- */
let es;
async function boot() {
  try {
    const tgd = window.Telegram?.WebApp?.initData;
    if (tgd && !token) { const r = await api('/auth/telegram', { method: 'POST', body: { initData: tgd } }); token = r.token; localStorage.t = token; }
    if (!token) return showAuth();
    me = await api('/me'); await loadData(); showHome();
    const mid = new URLSearchParams(location.search).get('m'); if (mid && !window.__opened) { window.__opened = 1; openMovie(+mid); }
    if (!es) { es = new EventSource('/api/events'); es.onmessage = async () => { if (token) { try { await loadData(); paint(); } catch { } } }; }
  } catch (e) { showAuth(); if (e && e.message && !/Kirish kerak/.test(e.message)) toast(e.message); }
}
(async () => {
  try { window.Telegram?.WebApp?.ready(); window.Telegram?.WebApp?.expand(); } catch { }
  cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({ siteName: 'Kino Bazza' }));
  document.title = cfg.siteName;
  if (new URLSearchParams(location.search).get('reset')) return showAuth('reset');
  boot();
})();
