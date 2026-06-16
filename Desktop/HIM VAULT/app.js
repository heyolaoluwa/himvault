'use strict';
/* ================================================================
   HIMVault — app.js
   Overrides all inline-script functions with async API versions.
   Requires the PHP api/ folder to be on the same server.
   ================================================================ */

// ── API CONFIG ───────────────────────────────────────────────────
const API_BASE = 'api';   // relative path to the api/ folder

async function apiPost(file, data) {
  const res = await fetch(`${API_BASE}/${file}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error);
  if (!res.ok) throw new Error('Server error (' + res.status + ')');
  return json;
}

async function apiGet(file, params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`${API_BASE}/${file}${qs}`, { credentials: 'include', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error);
  if (!res.ok) throw new Error('Server error (' + res.status + ')');
  return json;
}

// ── RESET SHARED STATE (declared by inline script) ───────────────
state.user          = null;
state.page          = 'dashboard';
state.activeGroup   = null;
state.examFilter    = 'upcoming';
state.adminTab      = 'overview';
state.tutCatId      = null;
state.tutQuestions  = [];
state.tutIndex      = 0;
state.tutAdminCatId = null;

// ── UTILITIES ────────────────────────────────────────────────────
// MySQL returns "YYYY-MM-DD HH:MM:SS" with a space. new Date() treats that format
// as Invalid Date in Firefox and as local time in Chrome — replace with T so all
// browsers parse it consistently as local time.
const parseServerDate = d => new Date((d||'').replace(' ','T'));
// result_release_time is stored as UTC_TIMESTAMP() — parse with Z suffix so all
// browsers treat it as UTC regardless of local timezone.
const parseReleaseTime = d => d ? new Date((d).replace(' ','T') + 'Z') : null;

const fmtDate = d => parseServerDate(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
const fmtTime = d => parseServerDate(d).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'});
const fmtDT   = d => `${fmtDate(d)}, ${fmtTime(d)}`;
const initials = name => name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
const escHtml  = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const cadreColor = {'Professional Diploma':'#D94040','National Diploma (ND)':'#2E7FD4','HND/BSc':'#0D6B52'};
const cadreBg    = {'Professional Diploma':'#FDECEC','National Diploma (ND)':'#E5F0FC','HND/BSc':'#E0F5EE'};
const cadreLabel = {'Professional Diploma':'PD','National Diploma (ND)':'ND','HND/BSc':'HB'};
const heroBg     = {
  'Professional Diploma':'linear-gradient(145deg,#8B1F1F,#C04040)',
  'National Diploma (ND)':'linear-gradient(145deg,#1A4F82,#2E7FD4)',
  'HND/BSc':'linear-gradient(145deg,#084A38,#0D6B52)',
};

// Returns the effective status of an exam, respecting admin overrides.
// Without an override, status is derived from start/end times.
function examEffectiveStatus(e, now) {
  if (e.status && e.status !== 'auto') return e.status;
  const s  = parseServerDate(e.start_time).getTime();
  const en = parseServerDate(e.end_time).getTime();
  if (s <= now && en >= now) return 'live';
  if (en < now)              return 'ended';
  return 'upcoming';
}

function toast(msg, dur=3000) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(()=>el.remove(), dur);
}

// ── AUTH ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('#auth-screen .tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(tab==='login'?'sign':'reg'));
  });
  document.getElementById('login-form').style.display    = tab==='login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab==='register' ? '' : 'none';
  document.getElementById('auth-sub').textContent = tab==='login'
    ? 'Sign in to continue your HIM journey'
    : 'Join thousands of HIM students across Nigeria';
  document.getElementById('auth-error').style.display = 'none';
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pwd').value;
  const errEl    = document.getElementById('auth-error');
  errEl.style.display = 'none';
  errEl.className = 'alert alert-danger';
  try {
    const data = await apiPost('auth.php', {action:'login', email, password});
    loginUser(data.user);
  } catch(e) {
    errEl.style.display = '';
    errEl.textContent = e.message || 'Invalid email or password.';
  }
}

// ── FORGOT / RESET PASSWORD ──────────────────────────────────────
function forgotPassword() {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">Reset Password</div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div style="font-size:13.5px;color:var(--text-m);margin-bottom:18px;line-height:1.6">Enter your registered email address and we will send you a link to reset your password.</div>
    <div class="form-group">
      <label class="lbl">Email Address</label>
      <input class="inp" type="email" id="fp-email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')doForgotPassword()">
    </div>
    <div id="fp-msg" style="display:none;margin-top:10px"></div>
  </div>
  <div class="modal-foot">
    <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-primary" id="fp-btn" onclick="doForgotPassword()">Send Reset Link</button>
  </div>`);
  setTimeout(()=>{ const el=document.getElementById('fp-email'); if(el) el.focus(); }, 100);
}

async function doForgotPassword() {
  const email = (document.getElementById('fp-email').value||'').trim();
  if (!email) return;
  const btn = document.getElementById('fp-btn');
  const msg = document.getElementById('fp-msg');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await apiPost('auth.php', {action:'forgot_password', email});
    msg.style.display = '';
    msg.innerHTML = `<div class="alert alert-success">✅ If that email is registered, a reset link has been sent. Check your inbox (and spam folder).</div>`;
    btn.style.display = 'none';
  } catch(e) {
    msg.style.display = '';
    msg.innerHTML = `<div class="alert alert-danger">${escHtml(e.message)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
  }
}

function showResetPasswordForm(token) {
  document.getElementById('login-form').style.display    = 'none';
  document.getElementById('register-form').style.display = 'none';
  document.querySelector('#auth-screen .tab-bar').style.display = 'none';
  document.getElementById('auth-sub').textContent = 'Choose a new password for your account';

  const wrap = document.createElement('div');
  wrap.id = 'reset-pwd-form';
  wrap.innerHTML = `
    <div class="form-group"><label class="lbl">New Password</label>
      <input class="inp" type="password" id="rp-pwd" placeholder="Min. 6 characters">
    </div>
    <div class="form-group"><label class="lbl">Confirm Password</label>
      <input class="inp" type="password" id="rp-pwd2" placeholder="Repeat new password"
        onkeydown="if(event.key==='Enter')doResetPassword('${token}')">
    </div>
    <button type="button" class="btn btn-primary btn-block btn-lg" style="margin-top:6px"
      onclick="doResetPassword('${token}')">Set New Password</button>`;
  document.querySelector('.auth-form-wrap').appendChild(wrap);
  document.getElementById('auth-error').style.display = 'none';
}

async function doResetPassword(token) {
  const pwd   = document.getElementById('rp-pwd').value;
  const pwd2  = document.getElementById('rp-pwd2').value;
  const errEl = document.getElementById('auth-error');
  errEl.className = 'alert alert-danger';
  errEl.style.display = 'none';

  if (pwd.length < 6) {
    errEl.style.display = '';
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (pwd !== pwd2) {
    errEl.style.display = '';
    errEl.textContent = 'Passwords do not match.';
    return;
  }
  try {
    await apiPost('auth.php', {action:'reset_password', token, password:pwd});
    // Remove reset form, restore login UI
    document.getElementById('reset-pwd-form').remove();
    document.querySelector('#auth-screen .tab-bar').style.display = '';
    document.getElementById('login-form').style.display = '';
    document.getElementById('auth-sub').textContent = 'Sign in to continue your HIM journey';
    window.history.replaceState({}, '', window.location.pathname);
    errEl.className = 'alert alert-success';
    errEl.style.display = '';
    errEl.textContent = '✅ Password reset successfully! You can now sign in with your new password.';
  } catch(e) {
    errEl.style.display = '';
    errEl.textContent = e.message || 'Failed to reset password. The link may have expired.';
  }
}

async function doRegister() {
  const name        = document.getElementById('reg-name').value.trim();
  const email       = document.getElementById('reg-email').value.trim();
  const password    = document.getElementById('reg-pwd').value;
  const cadre       = document.getElementById('reg-cadre').value;
  const institution = document.getElementById('reg-inst').value.trim();
  const errEl       = document.getElementById('auth-error');
  errEl.style.display = 'none';
  try {
    const data = await apiPost('auth.php', {action:'register', name, email, password, cadre, institution});
    if (data.matric_no) toast(`Your Member ID: ${data.matric_no} — please keep it safe!`, 7000);
    loginUser(data.user);
  } catch(e) {
    errEl.style.display = '';
    errEl.textContent = e.message || 'Registration failed.';
  }
}

function loginUser(user) {
  state.user = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  buildSidebar();
  buildHeader();
  navTo('dashboard');
}

async function logout() {
  await apiPost('auth.php', {action:'logout'}).catch(()=>{});
  state.user      = null;
  state.adminTab  = 'overview';
  state.activeGroup = null;
  stopExamTimer();
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('exam-screen').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-pwd').value   = '';
}

// ── NAVIGATION ───────────────────────────────────────────────────
async function navTo(page) {
  state.page = page;
  document.querySelectorAll('#page-content > div').forEach(d => {
    d.classList.toggle('page-hidden', d.id !== `page-${page}`);
  });
  document.querySelectorAll('.sb-item').forEach(i => {
    i.classList.toggle('active', i.dataset.page === page);
  });
  document.getElementById('header-title').textContent = {
    dashboard:'Dashboard', exams:'CBT Examinations', learn:'Learning Centre',
    community:'Community', profile:'My Profile', tutorials:'Tutorials',
    admin: state.user.role==='admin' ? 'Admin Dashboard' : 'Tutor Panel',
  }[page] || page;
  const renders = {
    dashboard:renderDashboard, exams:renderExams, learn:renderLearn,
    community:renderCommunity, profile:renderProfile, tutorials:renderTutorials, admin:renderAdmin,
  };
  if (renders[page]) await renders[page]().catch(e => toast(e.message));
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── SIDEBAR & HEADER ─────────────────────────────────────────────
function buildSidebar() {
  const u = state.user;
  const pages = [
    {page:'dashboard', icon:'⊞',  label:'Dashboard'},
    {page:'exams',     icon:'📋', label:'CBT Exams'},
    ...(u.role==='admin' ? [{page:'learn', icon:'📚', label:'Learning'}] : []),
    {page:'tutorials', icon:'📖', label:'Tutorials'},
    {page:'community', icon:'💬', label:'Community'},
    {page:'profile',   icon:'👤', label:'Profile'},
    ...(u.role==='admin'||u.role==='tutor'
      ? [{page:'admin', icon:'⚙️', label:u.role==='admin'?'Admin Panel':'Tutor Panel'}]
      : []),
  ];
  document.getElementById('sb-nav').innerHTML =
    `<div class="sb-section">Navigation</div>` +
    pages.map(p=>`<div class="sb-item" data-page="${p.page}" onclick="navTo('${p.page}')"><span class="sb-item-icon">${p.icon}</span>${p.label}</div>`).join('') +
    `<div class="sb-section" style="margin-top:8px">Account</div>
     <div class="sb-item" onclick="logout()"><span class="sb-item-icon">↪</span>Sign Out</div>`;
  const c = cadreColor[u.cadre]||'#0D6B52';
  document.getElementById('sb-user').innerHTML =
    `<div class="sb-avatar" style="background:${c}">${initials(u.name)}</div>
     <div style="flex:1;min-width:0"><div class="sb-name">${escHtml(u.name)}</div><div class="sb-role">${u.role}</div></div>`;
}

function buildHeader() {
  const u  = state.user;
  const c  = cadreColor[u.cadre]||'#0D6B52';
  const bg = cadreBg[u.cadre]||'#E0F5EE';
  document.getElementById('header-right').innerHTML =
    `<button class="notif-bell-btn" id="notif-bell" onclick="openNotificationsPanel()" title="Notifications">
       🔔<span id="notif-badge" class="notif-badge" style="display:none">0</span>
     </button>
     <span class="badge" style="background:${bg};color:${c}">${escHtml(u.cadre||'')}</span>
     <div class="avatar" style="width:36px;height:36px;background:${c};font-size:13px">${initials(u.name)}</div>`;
  fetchNotifCount();
}

// ── DASHBOARD ────────────────────────────────────────────────────
async function renderDashboard() {
  const u  = state.user;
  const bg = heroBg[u.cadre]||heroBg['HND/BSc'];
  const hr = new Date().getHours();
  const greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  document.getElementById('dash-hero').style.background = bg;
  document.getElementById('dash-hero').innerHTML = `
    <div class="hero-content">
      <div class="hero-greeting">${greet} 👋</div>
      <div class="hero-name">${escHtml(u.name)}</div>
      <div class="hero-tags">
        <span class="hero-tag">${escHtml(u.cadre||'')}</span>
        <span class="hero-tag">${escHtml(u.institution||'')}</span>
        <span class="hero-tag">${u.role.charAt(0).toUpperCase()+u.role.slice(1)}</span>
        ${u.matric_no?`<span class="hero-tag" style="font-family:var(--mono)">${u.matric_no}</span>`:''}
      </div>
    </div>`;

  const [examsRes, coursesRes, tutRes] = await Promise.all([
    apiGet('exams.php',{action:'list'}),
    apiGet('courses.php',{action:'list'}),
    apiGet('tutorials.php',{action:'list_categories'}).catch(()=>({categories:[]})),
  ]);
  const exams      = examsRes.exams      || [];
  const courses    = coursesRes.courses  || [];
  const categories = tutRes.categories   || [];
  const now        = Date.now();
  const upcoming   = exams.filter(e => { const eff=examEffectiveStatus(e,now); return eff==='upcoming'||eff==='registration_open'; });
  const totalT     = courses.reduce((s,c)=>s+(c.topic_count||0),0);
  const doneT      = courses.reduce((s,c)=>s+(c.completed_count||0),0);

  const stats = u.role==='admin'
    ? [['Exams',exams.length],['Courses',courses.length],['Upcoming',upcoming.length]]
    : [['Upcoming Exams',upcoming.length],['Completed',`${doneT}/${totalT}`],['Courses',courses.length],['Progress',`${Math.round(totalT?doneT/totalT*100:0)}%`]];

  document.getElementById('dash-stats').innerHTML = stats.map(([l,v])=>
    `<div class="stat-card"><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join('');

  document.getElementById('dash-exams-list').innerHTML = upcoming.slice(0,3).length
    ? upcoming.slice(0,3).map(e=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;font-size:13px">${escHtml(e.title)}</div>
        <div style="font-size:11.5px;color:var(--text-m);margin-top:3px">📅 ${fmtDT(e.start_time)} · ⏱ ${e.duration_minutes} min</div>
      </div>`).join('')
    : '<div style="font-size:13px;color:var(--text-m)">No upcoming exams for your cadre.</div>';

  const learnCard = document.getElementById('dash-learn-card');
  const dashGrid  = learnCard.parentElement;
  if (u.role === 'student' || u.role === 'tutor') {
    learnCard.style.display = 'none';
    dashGrid.style.gridTemplateColumns = '1fr';
  } else {
    learnCard.style.display = '';
    dashGrid.style.gridTemplateColumns = '';
    document.getElementById('dash-learn-list').innerHTML = courses.slice(0,3).map(c=>{
      const pct = c.topic_count ? Math.round((c.completed_count||0)/c.topic_count*100) : 0;
      return `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
          <span style="font-weight:700">${escHtml(c.title)}</span><span style="color:var(--text-m)">${pct}%</span>
        </div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>`;
    }).join('') || '<div style="font-size:13px;color:var(--text-m)">No courses available.</div>';
  }

  // Tutorial progress widget
  const withQs    = categories.filter(c => c.question_count > 0);
  const started   = withQs.filter(c => c.viewed_count > 0);
  const completed = withQs.filter(c => c.completed).length;
  document.getElementById('dash-tutorials-list').innerHTML = started.length === 0
    ? `<div style="font-size:13px;color:var(--text-m)">${withQs.length} topic${withQs.length!==1?'s':''} available — start studying to track your progress!</div>`
    : started.slice(0,3).map(c => {
        const pct = Math.round(c.viewed_count / c.question_count * 100);
        return `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
            <span style="font-weight:700">${escHtml(c.icon||'📚')} ${escHtml(c.name)}</span>
            <span style="color:${c.completed?'var(--success)':'var(--text-m)'}">${pct}%${c.completed?' ✓':''}</span>
          </div>
          <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%;${c.completed?'background:var(--success)':''}"></div></div>
        </div>`;
      }).join('') +
      `<div style="font-size:12px;color:var(--text-m);margin-top:4px">${started.length} of ${withQs.length} topic${withQs.length!==1?'s':''} started · ${completed} completed</div>`;
}

// ── EXAMS ────────────────────────────────────────────────────────
function filterExams(f) {
  state.examFilter = f;
  document.querySelectorAll('#exam-tabs .tab').forEach((t,i)=>{
    t.classList.toggle('active',['upcoming','live','past','progress'][i]===f);
  });
  renderExams();
}

async function renderExams() {
  if (state.examFilter === 'progress') { await renderProgress(); return; }
  const list = document.getElementById('exam-list');
  list.innerHTML = '<div class="empty"><div class="empty-msg" style="color:var(--text-m)">Loading…</div></div>';
  try {
    const data  = await apiGet('exams.php',{action:'list'});
    const exams = data.exams || [];
    const now   = Date.now();
    const f     = state.examFilter;
    const shown = exams.filter(e=>{
      const eff = examEffectiveStatus(e, now);
      if(f==='upcoming') return eff==='upcoming'||eff==='registration_open';
      if(f==='live')     return eff==='live';
      if(f==='past')     return eff==='ended';
      return false;
    });
    if(!shown.length){
      list.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-msg">No ${f} exams for your cadre</div></div>`;
      return;
    }
    list.innerHTML = shown.map(e=>examCard(e,state.user,now)).join('');
  } catch(e) {
    list.innerHTML=`<div class="empty"><div class="empty-msg">Could not load exams: ${escHtml(e.message)}</div></div>`;
  }
}

function examCard(e, u, now) {
  const eff      = examEffectiveStatus(e, now);
  const isLive   = eff === 'live';
  const isPast   = eff === 'ended';
  const isReg    = e.is_registered || false;
  const attempt  = e.my_attempt    || null;
  const regOpen  = eff === 'registration_open' ||
    (eff === 'upcoming' && parseServerDate(e.registration_deadline) > now);
  const released = e.result_release_time &&
    parseReleaseTime(e.result_release_time) <= now;
  const c      = cadreColor[e.cadre] || 'var(--primary)';
  const bg     = cadreBg[e.cadre]   || 'var(--primary-bg)';
  const qCount = e.question_count   || 0;

  let action = '';
  if (attempt) {
    const pct    = qCount > 0 ? Math.round(attempt.score / qCount * 100) : 0;
    const passed = qCount > 0 && attempt.score / qCount >= 0.5;
    const scoreBox = `<div style="text-align:center;background:var(--primary-bg);border-radius:var(--r);padding:14px">
        <div style="font-family:var(--mono);font-size:26px;font-weight:800;color:var(--primary)">${attempt.score}/${qCount}</div>
        <div style="font-size:12px;color:var(--text-m)">${pct}% · ${passed?'✅ Pass':'❌ Fail'}</div>
      </div>`;
    action = released
      ? `${scoreBox}<button class="btn btn-ghost btn-block" style="margin-top:8px;font-size:12.5px" onclick="reviewExam('${e.id}')">📋 Review Answers</button>`
      : `<div class="alert alert-info" style="margin:0;font-size:12px">Results pending — admin will release scores soon</div>`;
  } else if (isLive && isReg) {
    action = `<button class="btn btn-danger btn-block" onclick="verifyMatricAndStart('${e.id}')">🚀 Start Exam Now</button>`;
  } else if (isLive && !isReg) {
    action = `<div class="alert alert-warn" style="margin:0;font-size:12px">Exam is live — registration is closed</div>`;
  } else if (!isPast && isReg) {
    action = `<div class="alert alert-info" style="margin:0;font-size:12px">✅ Registered — exam starts ${fmtDT(e.start_time)}</div>`;
  } else if (!isPast && !isReg && regOpen) {
    action = `<button class="btn btn-primary btn-block" onclick="registerExam('${e.id}')">Register for Exam</button>`;
  } else {
    action = `<span class="badge badge-gray">Registration closed</span>`;
  }

  const statusBadge = isLive  ? '<span class="badge badge-live">● LIVE</span>'
    : attempt ? '<span class="badge badge-gray">Submitted</span>'
    : eff === 'registration_open' ? '<span class="badge badge-success">Reg. Open</span>' : '';

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <span class="badge" style="background:${bg};color:${c}">${escHtml(e.cadre||'All Cadres')}</span>
      ${statusBadge}
    </div>
    <div style="font-weight:800;font-size:14.5px;margin-bottom:10px;line-height:1.4">${escHtml(e.title)}</div>
    <div style="font-size:12px;color:var(--text-m);margin-bottom:14px;display:flex;flex-direction:column;gap:4px">
      <span>📅 ${fmtDT(e.start_time)}</span>
      <span>⏱ ${e.duration_minutes} minutes &nbsp;·&nbsp; ❓ ${qCount} questions</span>
    </div>
    ${action}
  </div>`;
}

async function reviewExam(examId) {
  try {
    const data      = await apiGet('exams.php', {action:'review', exam_id:examId});
    const questions = data.questions || [];
    const score  = data.score;
    const total  = data.total;
    const pct    = total ? Math.round(score / total * 100) : 0;
    const passed = score / total >= 0.5;

    let wrong = 0, unanswered = 0;
    questions.forEach(q => {
      if (q.selected_idx === null || q.selected_idx === undefined) unanswered++;
      else if (q.selected_idx !== q.correct_idx) wrong++;
    });

    const qHtml = questions.map((q, i) => {
      const opts       = q.options || [];
      const notAnswered = q.selected_idx === null || q.selected_idx === undefined;
      const gotRight    = !notAnswered && q.selected_idx === q.correct_idx;

      const optRows = opts.map((opt, idx) => {
        const isCorrect  = idx === q.correct_idx;
        const isSelected = idx === q.selected_idx;
        const isWrong    = isSelected && !isCorrect;
        const bg      = isCorrect ? '#e6f9f0' : isWrong ? '#fde8e8' : 'var(--surface)';
        const border  = isCorrect ? '1.5px solid #1db954' : isWrong ? '1.5px solid var(--danger)' : '1px solid var(--border)';
        const icon    = isWrong ? ' ❌' : '';
        const correct = isCorrect && !gotRight
          ? `<span style="font-size:10px;color:#1db954;font-weight:700;margin-left:6px">← correct</span>` : '';
        const dot    = isSelected ? '●' : '○';
        const dotCol = isWrong ? 'var(--danger)' : isSelected ? 'var(--primary)' : 'var(--text-l)';
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;margin-bottom:6px;border-radius:6px;background:${bg};border:${border};font-size:13px">
          <span style="font-size:10px;color:${dotCol};margin-top:2px;flex-shrink:0">${dot}</span>
          <span style="flex:1">${['A','B','C','D'][idx]}. ${escHtml(opt)}${icon}${correct}</span>
        </div>`;
      }).join('');

      const qStatus = gotRight   ? `<span style="color:#1db954;font-size:11px;font-weight:700;white-space:nowrap">✅ Correct</span>`
        : notAnswered ? `<span style="color:var(--text-m);font-size:11px;font-weight:700;white-space:nowrap">⚪ Not answered</span>`
        :               `<span style="color:var(--danger);font-size:11px;font-weight:700;white-space:nowrap">❌ Wrong</span>`;

      return `<div style="margin-bottom:14px;padding:14px;background:var(--card);border-radius:var(--r);border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
          <div style="font-weight:700;font-size:13px;line-height:1.5;flex:1">${i + 1}. ${escHtml(q.question_text)}</div>
          ${qStatus}
        </div>
        ${optRows}
      </div>`;
    }).join('');

    openModal(`<div class="modal-hdr">
      <div class="modal-hdr-title">Answer Review</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
    </div>
    <div style="padding:14px 20px;background:var(--primary-bg);border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div>
          <div style="font-family:var(--mono);font-size:28px;font-weight:800;color:var(--primary)">${score}/${total}</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px">${pct}% &nbsp;·&nbsp; ${passed ? 'Pass ✅' : 'Fail ❌'}</div>
        </div>
        <div style="display:flex;gap:18px;font-size:13px;flex-wrap:wrap">
          <span><strong style="color:#1db954">${score}</strong> correct</span>
          <span><strong style="color:var(--danger)">${wrong}</strong> wrong</span>
          ${unanswered ? `<span><strong style="color:var(--text-m)">${unanswered}</strong> not answered</span>` : ''}
        </div>
      </div>
    </div>
    <div class="modal-body" style="max-height:60vh;overflow-y:auto;padding-top:14px">
      ${qHtml}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>`);
  } catch(e) { toast('Could not load review: ' + e.message); }
}

async function renderProgress() {
  const list = document.getElementById('exam-list');
  list.innerHTML = '<div class="empty"><div class="empty-msg" style="color:var(--text-m)">Loading…</div></div>';
  try {
    const data     = await apiGet('exams.php', {action:'my_history'});
    const attempts = data.attempts || [];

    if (!attempts.length) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><div class="empty-msg">No exam history yet.<br><span style="font-size:12.5px">Complete your first exam to start tracking your progress here.</span></div></div>`;
      return;
    }

    const now    = Date.now();
    const count  = attempts.length;

    // Stats only count released results so scores stay hidden until admin releases
    const relList   = attempts.filter(a => a.result_release_time && parseReleaseTime(a.result_release_time) <= now);
    const relScores = relList.map(a => a.total ? Math.round(a.score / a.total * 100) : 0);
    const avgPct    = relList.length ? Math.round(relScores.reduce((s,v)=>s+v,0) / relList.length) : null;
    const passes    = relList.filter(a => a.total && a.score / a.total >= 0.5).length;
    const passRate  = relList.length ? Math.round(passes / relList.length * 100) : null;

    const lastTwo      = relList.slice(-2);
    const latestTrend  = lastTwo.length >= 2
      ? (lastTwo[1].total ? Math.round(lastTwo[1].score/lastTwo[1].total*100) : 0)
        - (lastTwo[0].total ? Math.round(lastTwo[0].score/lastTwo[0].total*100) : 0)
      : null;

    const trendCard = latestTrend !== null
      ? `<div class="stat-card"><div class="stat-val" style="color:${latestTrend>0?'var(--success)':latestTrend<0?'var(--danger)':'var(--text-m)'}">${latestTrend>0?'▲ +':latestTrend<0?'▼ ':''}${latestTrend}%</div><div class="stat-lbl">vs Last Exam</div></div>`
      : '';

    const statsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-val">${count}</div><div class="stat-lbl">Exams Taken</div></div>
      <div class="stat-card"><div class="stat-val">${avgPct !== null ? avgPct+'%' : '—'}</div><div class="stat-lbl">Avg Score</div></div>
      <div class="stat-card"><div class="stat-val">${passRate !== null ? passRate+'%' : '—'}</div><div class="stat-lbl">Pass Rate</div></div>
      ${trendCard}
    </div>`;

    // Chart bars: grey + "?" for unreleased, colored for released
    const bars = attempts.map((a, i) => {
      const rel  = a.result_release_time && parseReleaseTime(a.result_release_time) <= now;
      const pct  = rel && a.total ? Math.round(a.score / a.total * 100) : null;
      const col  = pct !== null ? (pct >= 50 ? 'var(--success)' : 'var(--danger)') : '#D8E4E0';
      const barH = pct !== null ? pct : 30;
      const lbl  = pct !== null ? pct+'%' : '?';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:0" title="${escHtml(a.title)} — ${pct!==null?pct+'%':'Pending'}">
        <div style="font-size:9px;color:var(--text-m);font-weight:700">${lbl}</div>
        <div style="width:100%;height:72px;background:var(--border);border-radius:4px;position:relative;overflow:hidden">
          <div style="position:absolute;bottom:0;width:100%;height:${barH}%;background:${col};border-radius:4px"></div>
        </div>
        <div style="font-size:9px;color:var(--text-l)">${i+1}</div>
      </div>`;
    }).join('');

    const chartHtml = `<div class="card" style="margin-bottom:20px">
      <div style="font-weight:800;font-size:13px;margin-bottom:12px">Score History</div>
      <div style="display:flex;gap:5px;align-items:flex-end">${bars}</div>
      <div style="font-size:10.5px;color:var(--text-m);text-align:center;margin-top:6px">Exam # (oldest → newest) &nbsp;·&nbsp; Green = pass &nbsp;·&nbsp; Red = fail &nbsp;·&nbsp; Grey = pending</div>
    </div>`;

    // For trend lines, only compare against adjacent released attempts
    const sorted    = [...attempts].reverse();
    const cardsHtml = sorted.map((a) => {
      const rel    = a.result_release_time && parseReleaseTime(a.result_release_time) <= now;
      const pct    = rel && a.total ? Math.round(a.score / a.total * 100) : null;
      const passed = rel && a.total && a.score / a.total >= 0.5;

      let trend = '';
      if (rel) {
        const myIdx = relList.findIndex(r => r.exam_id === a.exam_id);
        if (myIdx > 0) {
          const prev = relList[myIdx - 1];
          const prevPct = prev.total ? Math.round(prev.score / prev.total * 100) : 0;
          const diff = pct - prevPct;
          trend = diff > 0 ? `<span style="color:var(--success);font-size:12px;font-weight:700">▲ +${diff}%</span>`
            : diff < 0    ? `<span style="color:var(--danger);font-size:12px;font-weight:700">▼ ${diff}%</span>`
            :               `<span style="color:var(--text-m);font-size:12px">= same</span>`;
        }
      }

      const scoreArea = rel
        ? `<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:var(--primary)">${a.score}/${a.total||'?'}</div>
           <div style="font-size:12px;color:var(--text-m)">${pct}%</div>`
        : `<div style="font-size:12px;color:var(--text-m);padding-top:6px">Pending release</div>`;

      const bottomArea = rel
        ? `<span class="badge ${passed?'badge-success':'badge-danger'}">${passed?'✅ Pass':'❌ Fail'}</span>
           ${trend}
           <div class="progress-wrap" style="flex:1;min-width:60px">
             <div class="progress-bar" style="width:${pct}%;background:${passed?'var(--success)':'var(--danger)'}"></div>
           </div>
           <button class="btn btn-ghost btn-sm" style="font-size:12px" onclick="reviewExam('${a.exam_id}')">📋 Review Answers</button>`
        : `<span style="font-size:11px;color:var(--text-m)">Your score and answers will appear once the admin releases this result</span>`;

      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:14px;margin-bottom:3px">${escHtml(a.title)}</div>
            <div style="font-size:11.5px;color:var(--text-m)">📅 ${fmtDT(a.submitted_at)}&nbsp;·&nbsp;${escHtml(a.cadre||'')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">${scoreArea}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${bottomArea}</div>
      </div>`;
    }).join('');

    list.innerHTML = statsHtml + chartHtml + `<div style="font-weight:800;font-size:14px;margin-bottom:12px">Exam History (newest first)</div>` + cardsHtml;
  } catch(e) {
    list.innerHTML = `<div class="empty"><div class="empty-msg">Could not load progress: ${escHtml(e.message)}</div></div>`;
  }
}

async function registerExam(id) {
  try {
    await apiPost('exams.php',{action:'register', exam_id:id});
    toast('Registered for exam successfully!');
    renderExams();
  } catch(e) { toast(e.message); }
}

// ── MATRIC VERIFICATION ──────────────────────────────────────────
function verifyMatricAndStart(id) {
  const u = state.user;
  if(!u.matric_no||u.role==='admin'||u.role==='tutor'){startExam(id);return;}
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Verify Your Identity</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div style="font-size:13.5px;color:var(--text-m);margin-bottom:18px;line-height:1.6">Enter your Member ID exactly as issued at registration to begin the exam.</div>
      <div class="form-group">
        <label class="lbl">Member ID</label>
        <input class="inp" id="matric-verify" placeholder="e.g. HIMV/ND/0001" style="font-family:var(--mono);font-size:15px;letter-spacing:1.5px;text-transform:uppercase" onkeydown="if(event.key==='Enter')confirmMatricAndStart('${id}')">
      </div>
      <div id="matric-err" class="alert alert-danger" style="display:none;margin-top:8px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmMatricAndStart('${id}')">Begin Exam →</button>
    </div>`);
  setTimeout(()=>{const el=document.getElementById('matric-verify');if(el)el.focus();},100);
}

function confirmMatricAndStart(id) {
  const entered  = (document.getElementById('matric-verify').value||'').trim().toUpperCase();
  const expected = (state.user.matric_no||'').toUpperCase();
  if(entered!==expected){
    const err = document.getElementById('matric-err');
    err.style.display = '';
    err.textContent = 'Incorrect Member ID. Please check and try again.';
    return;
  }
  closeModal();
  startExam(id);
}

// ── CBT ENGINE ───────────────────────────────────────────────────
async function startExam(id) {
  try {
    const data = await apiPost('exams.php',{action:'start', exam_id:id});
    const exam  = data.exam;
    const questions = (data.questions||[]).map(q=>({
      id:      q.id,
      text:    q.question_text,
      options: [q.option_a,q.option_b,q.option_c,q.option_d].filter(Boolean),
    }));
    examState.active    = exam;
    examState.questions = questions;
    examState.answers   = {};
    examState.current   = 0;
    examState.timeLeft  = (exam.duration_minutes||90)*60;
    document.getElementById('exam-screen').style.display = 'block';
    document.getElementById('exam-screen-title').textContent = exam.title;
    document.getElementById('exam-screen-matric').textContent =
      state.user.matric_no ? `Member ID: ${state.user.matric_no}` : '';
    renderExamQuestion();
    buildQNav();
    startExamTimer();
    setupExamSecurity();
    showExamSecurityBanner('🔒 Exam in progress — Do not switch tabs, minimize, or exit fullscreen. Violations will auto-submit your exam.', 8000);
  } catch(e) { toast('Could not start exam: '+e.message); }
}

// ── EXAM SECURITY ────────────────────────────────────────────────
let examSecurity = { violations: 0, hiddenTimer: null };

function setupExamSecurity() {
  examSecurity = { violations: 0, hiddenTimer: null };
  document.addEventListener('visibilitychange', onExamVisChange);
  document.addEventListener('fullscreenchange', onExamFullscreenChange);
  document.addEventListener('contextmenu', blockExamContextMenu);
  document.addEventListener('keydown', blockExamKeys);
  document.addEventListener('copy', blockExamCopy);
  document.addEventListener('cut', blockExamCopy);
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

function teardownExamSecurity() {
  document.removeEventListener('visibilitychange', onExamVisChange);
  document.removeEventListener('fullscreenchange', onExamFullscreenChange);
  document.removeEventListener('contextmenu', blockExamContextMenu);
  document.removeEventListener('keydown', blockExamKeys);
  document.removeEventListener('copy', blockExamCopy);
  document.removeEventListener('cut', blockExamCopy);
  if (examSecurity.hiddenTimer) { clearTimeout(examSecurity.hiddenTimer); examSecurity.hiddenTimer = null; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function onExamVisChange() {
  if (!examState.active) return;
  if (document.hidden) {
    // Left the exam tab — auto-submit after 3 s if they don't return
    examSecurity.hiddenTimer = setTimeout(() => {
      triggerSecuritySubmit('You switched tabs or left the exam window');
    }, 3000);
  } else {
    // Returned within 3 s — clear the timer and log a warning
    if (examSecurity.hiddenTimer) {
      clearTimeout(examSecurity.hiddenTimer);
      examSecurity.hiddenTimer = null;
      recordExamViolation('Tab switch detected');
    }
  }
}

function onExamFullscreenChange() {
  if (!examState.active || document.fullscreenElement) return;
  recordExamViolation('Fullscreen mode was exited');
  if (examSecurity.violations < 2) {
    setTimeout(() => {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    }, 1500);
  }
}

function blockExamContextMenu(e) {
  if (examState.active) e.preventDefault();
}

function blockExamKeys(e) {
  if (!examState.active) return;
  if (e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && 'ICJ'.includes(e.key.toUpperCase())) ||
      (e.ctrlKey && ['U','S','P'].includes(e.key.toUpperCase())) ||
      e.key === 'PrintScreen') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // P = Previous, N = Next (no modifier keys, not inside an input)
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    if (e.key.toUpperCase() === 'P') { e.preventDefault(); examNav(-1); }
    if (e.key.toUpperCase() === 'N') { e.preventDefault(); examNav(1); }
  }
}

function blockExamCopy(e) {
  if (examState.active) {
    e.preventDefault();
    showExamSecurityBanner('⚠️ Copying exam content is not permitted.', 3000);
  }
}

function recordExamViolation(reason) {
  if (!examState.active) return;
  examSecurity.violations++;
  const vEl = document.getElementById('exam-violations');
  if (vEl) {
    vEl.style.display = '';
    vEl.textContent = `⚠️ ${examSecurity.violations} integrity violation${examSecurity.violations > 1 ? 's' : ''} recorded`;
  }
  if (examSecurity.violations >= 2) {
    triggerSecuritySubmit(reason);
  } else {
    showExamSecurityBanner(`⚠️ WARNING: ${reason}. One more violation will automatically submit your exam.`, 10000);
  }
}

function showExamSecurityBanner(msg, duration) {
  let el = document.getElementById('exam-sec-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'exam-sec-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#D94040;color:#fff;padding:13px 20px;font-size:13px;font-weight:700;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.4);letter-spacing:.2px';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { if (el.parentNode) el.remove(); }, duration || 5000);
}

async function triggerSecuritySubmit(reason) {
  if (!examState.active) return;
  const exam = examState.active;
  stopExamTimer(); // also calls teardownExamSecurity
  const answers = {};
  examState.questions.forEach((q, i) => { if (examState.answers[i] !== undefined) answers[q.id] = examState.answers[i]; });
  try {
    await apiPost('exams.php', { action: 'submit', exam_id: exam.id, answers, flagged: true, flag_reason: reason });
  } catch (e) {}
  examState.active = null;
  document.getElementById('exam-screen').style.display = 'none';
  const el = document.getElementById('exam-sec-banner');
  if (el) el.remove();
  openModal(`
    <div class="modal-hdr"><div class="modal-hdr-title" style="color:var(--danger)">🚨 Exam Auto-Submitted</div></div>
    <div class="modal-body" style="text-align:center;padding:24px">
      <div style="font-size:44px;margin-bottom:14px">🚫</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:12px;color:var(--danger)">Integrity Violation Detected</div>
      <div class="alert alert-danger" style="text-align:left;line-height:1.7;margin-bottom:16px">
        <strong>Reason:</strong> ${escHtml(reason)}.<br>
        Your exam was automatically submitted and this incident has been flagged for admin review.
      </div>
      <div style="font-size:12.5px;color:var(--text-m)">Your answers up to the point of violation have been saved. Results will be available once the admin releases them.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-primary" onclick="closeModal();state.examFilter='progress';navTo('exams')">View My Results</button>
    </div>`);
}

function stopExamTimer() {
  if(examState.timerInterval){clearInterval(examState.timerInterval);examState.timerInterval=null;}
  teardownExamSecurity();
}

// ── CALCULATOR ────────────────────────────────────────────────────
let calcState = { display: '0', operator: null, operand: null, reset: false };

function toggleCalc() {
  const w = document.getElementById('calc-widget');
  if (!w) return;
  w.style.display = w.style.display === 'none' ? '' : 'none';
}

function calcAction(key) {
  const disp = document.getElementById('calc-display');
  if (!disp) return;
  const cur = disp.textContent;

  if (key === 'C') {
    calcState = { display: '0', operator: null, operand: null, reset: false };
    disp.textContent = '0';
    return;
  }
  if (key === '⌫') {
    disp.textContent = cur.length > 1 ? cur.slice(0, -1) : '0';
    return;
  }
  if (key === '=') {
    if (calcState.operator !== null && calcState.operand !== null) {
      const a = parseFloat(calcState.operand);
      const b = parseFloat(cur);
      let result;
      if      (calcState.operator === '+') result = a + b;
      else if (calcState.operator === '-') result = a - b;
      else if (calcState.operator === '*') result = a * b;
      else if (calcState.operator === '/') result = b !== 0 ? a / b : 'Error';
      disp.textContent = (typeof result === 'string') ? result : String(parseFloat(result.toFixed(10)));
      calcState = { display: disp.textContent, operator: null, operand: null, reset: true };
    }
    return;
  }
  if (['+', '-', '*', '/'].includes(key)) {
    calcState.operator = key;
    calcState.operand  = cur;
    calcState.reset    = true;
    return;
  }
  if (key === '.') {
    if (calcState.reset) { disp.textContent = '0.'; calcState.reset = false; return; }
    if (!cur.includes('.')) disp.textContent = cur + '.';
    return;
  }
  // digit
  if (calcState.reset) { disp.textContent = key; calcState.reset = false; }
  else { disp.textContent = cur === '0' ? key : cur.length < 15 ? cur + key : cur; }
}

function startExamTimer() {
  stopExamTimer();
  updateTimerDisplay();
  examState.timerInterval = setInterval(()=>{
    examState.timeLeft--;
    updateTimerDisplay();
    if(examState.timeLeft<=0){stopExamTimer();submitExamFinal();}
  },1000);
}

function updateTimerDisplay() {
  const t=examState.timeLeft;
  const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;
  const str=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const el=document.getElementById('exam-timer');
  el.textContent=str;
  el.className='timer-display'+(t<300?' timer-warn':'');
}

function renderExamQuestion() {
  const qs=examState.questions, i=examState.current, q=qs[i];
  const answered=Object.keys(examState.answers).length;
  document.getElementById('exam-screen-meta').textContent=`${answered}/${qs.length} answered`;
  document.getElementById('exam-progress-bar').style.width=`${Math.round(answered/qs.length*100)}%`;
  document.getElementById('btn-prev').disabled=(i===0);
  document.getElementById('btn-next').style.display=i<qs.length-1?'':'none';
  document.getElementById('btn-submit').style.display=i===qs.length-1?'':'none';
  document.getElementById('q-card').innerHTML=
    `<div class="q-num">Question ${i+1} of ${qs.length}</div>
     <div class="q-text">${escHtml(q.text)}</div>
     ${q.options.map((opt,idx)=>`
       <div class="option${examState.answers[i]===idx?' sel':''}" onclick="selectOption(${idx})">
         <div class="opt-letter">${['A','B','C','D'][idx]}</div>
         <span>${escHtml(opt)}</span>
       </div>`).join('')}`;
  buildQNav();
}

function selectOption(idx) { examState.answers[examState.current]=idx; renderExamQuestion(); }
function examNav(dir) { const n=examState.current+dir; if(n>=0&&n<examState.questions.length){examState.current=n;renderExamQuestion();} }
function goQ(idx)     { examState.current=idx; renderExamQuestion(); }

function buildQNav() {
  const qs=examState.questions,i=examState.current;
  document.getElementById('q-nav').innerHTML=qs.map((_,idx)=>
    `<div class="q-dot${idx===i?' cur':examState.answers[idx]!==undefined?' ans':''}" onclick="goQ(${idx})">${idx+1}</div>`
  ).join('');
}

function confirmSubmit() {
  const total=examState.questions.length, answered=Object.keys(examState.answers).length;
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Submit Exam?</div></div>
    <div class="modal-body">
      <div class="alert alert-warn">You have answered <strong>${answered}/${total}</strong> questions. Unanswered questions will be marked as incorrect.</div>
      <p style="font-size:13.5px;color:var(--text-m)">This action cannot be undone.</p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Continue Exam</button>
      <button class="btn btn-danger" onclick="closeModal();submitExamFinal()">Yes, Submit Now</button>
    </div>`);
}

async function submitExamFinal() {
  if (!examState.active) return;
  stopExamTimer();
  const exam = examState.active;
  const answers = {};
  examState.questions.forEach((q,i)=>{ if(examState.answers[i]!==undefined) answers[q.id]=examState.answers[i]; });
  try {
    const result = await apiPost('exams.php',{action:'submit', exam_id:exam.id, answers});
    document.getElementById('exam-screen').style.display='none';
    openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Exam Submitted!</div></div>
      <div class="modal-body" style="text-align:center">
        <div style="font-size:40px;margin-bottom:12px">🎉</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:8px">Your exam has been submitted</div>
        <div style="font-size:13px;color:var(--text-m);margin-bottom:20px">Results will be visible once the admin releases them.</div>
        <div style="background:var(--primary-bg);border-radius:var(--r);padding:16px;margin-bottom:20px">
          <div style="font-family:var(--mono);font-size:32px;font-weight:800;color:var(--primary)">${Object.keys(answers).length}/${result.total||'?'}</div>
          <div style="font-size:12px;color:var(--text-m)">Questions answered</div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();state.examFilter='progress';navTo('exams')">View My Results</button></div>`);
  } catch(e) { toast('Submission error: '+e.message); }
  examState.active = null;
}

// ── LEARNING ─────────────────────────────────────────────────────
async function renderLearn() {
  document.getElementById('learn-sub').textContent=`Structured content for ${state.user.cadre} students`;
  await showCoursesView();
}

async function showCoursesView() {
  document.getElementById('learn-courses-view').style.display='';
  document.getElementById('learn-topics-view').style.display='none';
  document.getElementById('learn-lesson-view').style.display='none';
  document.getElementById('course-list').innerHTML='<div class="empty"><div class="empty-msg">Loading courses…</div></div>';
  try {
    const data    = await apiGet('courses.php',{action:'list'});
    const courses = data.courses||[];
    if(!courses.length){
      document.getElementById('course-list').innerHTML=`<div class="empty"><div class="empty-icon">📚</div><div class="empty-msg">No courses for your cadre yet</div></div>`;
      return;
    }
    document.getElementById('course-list').innerHTML=courses.map(c=>{
      const pct = c.topic_count?Math.round((c.completed_count||0)/c.topic_count*100):0;
      const col = cadreColor[c.cadre]||'var(--primary)', bg2=cadreBg[c.cadre]||'var(--primary-bg)';
      return `<div class="card" style="cursor:pointer" onclick="openCourse('${c.id}')">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span class="badge" style="background:${bg2};color:${col}">${cadreLabel[c.cadre]||'?'}</span>
          <span style="font-size:12px;color:var(--text-m)">${c.topic_count||0} topics</span>
        </div>
        <div style="font-size:22px;margin-bottom:8px">${c.icon||'📚'}</div>
        <div style="font-weight:800;font-size:15px;margin-bottom:4px">${escHtml(c.title)}</div>
        <div style="font-size:12px;color:var(--text-m);margin-bottom:14px">${escHtml(c.description||'')}</div>
        <div style="font-size:12px;color:var(--text-m);margin-bottom:6px">${c.completed_count||0}/${c.topic_count||0} topics completed</div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%;background:${col}"></div></div>
        <button class="btn btn-outline btn-sm" style="margin-top:14px;border-color:${col};color:${col}" onclick="event.stopPropagation();openCourse('${c.id}')">
          ${pct>0?'Continue':'Start'} Course →
        </button>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('course-list').innerHTML=`<div class="empty"><div class="empty-msg">Could not load courses</div></div>`;
  }
}

async function openCourse(id) { state.currentCourse={id}; await showTopicsView(); }

async function showTopicsView() {
  document.getElementById('learn-courses-view').style.display='none';
  document.getElementById('learn-topics-view').style.display='';
  document.getElementById('learn-lesson-view').style.display='none';
  document.getElementById('topics-card').innerHTML='<div style="padding:20px;color:var(--text-m)">Loading…</div>';
  try {
    const data   = await apiGet('courses.php',{action:'topics', course_id:state.currentCourse.id});
    const c      = data.course;
    const topics = data.topics||[];
    state.currentCourse = c;
    const done = topics.filter(t=>t.completed).length;
    const pct  = topics.length?Math.round(done/topics.length*100):0;
    document.getElementById('topics-card').innerHTML=`
      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${escHtml(c.cadre||'')}</div>
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">${c.icon||'📚'} ${escHtml(c.title)}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-m);margin-bottom:6px">
          <span>${done}/${topics.length} completed</span><span>${pct}%</span>
        </div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div><hr>
      ${topics.map(t=>`
        <div class="topic-item" onclick="openLesson('${t.id}')">
          <div class="topic-check${t.completed?' done':''}">${t.completed?'✓':''}</div>
          <div style="flex:1">
            <div class="topic-text">${escHtml(t.title)}</div>
            <div class="topic-type">${{text:'📖 Text Lesson',video:'🎬 Video',audio:'🎧 Audio',pdf:'📄 PDF'}[t.type]||'📖 Lesson'}</div>
          </div>
          <span style="color:var(--text-l);font-size:18px">›</span>
        </div>`).join('')}`;
  } catch(e) {
    document.getElementById('topics-card').innerHTML='<div class="empty"><div class="empty-msg">Could not load topics</div></div>';
  }
}

async function openLesson(tid) {
  document.getElementById('learn-courses-view').style.display='none';
  document.getElementById('learn-topics-view').style.display='none';
  document.getElementById('learn-lesson-view').style.display='';
  document.getElementById('lesson-card').innerHTML='<div style="padding:20px;color:var(--text-m)">Loading…</div>';
  try {
    const data = await apiGet('courses.php',{action:'topic', topic_id:tid});
    const t    = data.topic;
    state.currentTopic = t;
    document.getElementById('lesson-card').innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${escHtml(t.course_title||'')}</div>
          <div style="font-size:20px;font-weight:800">${escHtml(t.title)}</div>
        </div>
        <span class="badge badge-gray">${(t.type||'text').toUpperCase()}</span>
      </div>
      <div class="lesson-body">${escHtml(t.content||'')}</div>
      ${!t.completed
        ?`<button class="btn btn-primary" style="margin-top:20px" onclick="completeTopic('${t.id}')">✓ Mark as Completed</button>`
        :`<div class="alert alert-success" style="margin-top:16px">✅ You have completed this topic</div>`}`;
  } catch(e) {
    document.getElementById('lesson-card').innerHTML='<div class="empty"><div class="empty-msg">Could not load lesson</div></div>';
  }
}

async function completeTopic(tid) {
  try {
    await apiPost('courses.php',{action:'complete', topic_id:tid});
    toast('Topic marked as completed!');
    openLesson(tid);
  } catch(e) { toast(e.message); }
}

// ── COMMUNITY ─────────────────────────────────────────────────────
async function renderCommunity() {
  document.getElementById('community-actions').innerHTML =
    `<button class="btn btn-primary btn-sm" onclick="openCreateGroupModal()">＋ Create Group</button>`;
  await renderGroupList();
  document.getElementById('chat-main').innerHTML=`<div class="chat-empty"><div style="font-size:36px">💬</div><div style="font-size:14px;font-weight:600">Select a group to start chatting</div><div style="font-size:12px;color:var(--text-l)">Join or create a group to connect with peers</div></div>`;
}

async function renderGroupList() {
  try {
    const data  = await apiGet('groups.php',{action:'list'});
    const groups = data.groups||[];
    const mine  = groups.filter(g=>g.is_member);
    const other = groups.filter(g=>!g.is_member);
    let html='';
    if(mine.length){
      html+=`<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:1px">My Groups</div>`;
      html+=mine.map(g=>groupItem(g)).join('');
    }
    if(other.length){
      html+=`<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:1px">Discover</div>`;
      html+=other.map(g=>groupItem(g,true)).join('');
    }
    if(!groups.length) html=`<div class="empty" style="padding:24px">No groups yet</div>`;
    document.getElementById('group-list').innerHTML=html;
  } catch(e) {
    document.getElementById('group-list').innerHTML='<div class="empty" style="padding:16px">Could not load groups</div>';
  }
}

function groupItem(g, join=false) {
  const last = g.last_message;
  return `<div class="group-item${state.activeGroup===g.id?' active':''}" onclick="${join?`joinGroup('${g.id}')`:`openGroup('${g.id}')`}">
    <div class="group-name">${escHtml(g.name)}</div>
    <div class="group-preview">${join?'Tap to join · '+escHtml(g.cadre||''):last?escHtml(last.sender_name)+': '+escHtml(last.message_text.slice(0,45)):escHtml(g.cadre||'')}</div>
  </div>`;
}

async function joinGroup(id) {
  try { await apiPost('groups.php',{action:'join', group_id:id}); await openGroup(id); renderGroupList(); }
  catch(e) { toast(e.message); }
}

async function leaveGroup(id) {
  try {
    await apiPost('groups.php', {action:'leave', group_id:id});
    state.activeGroup = null;
    toast('You left the group.');
    renderCommunity();
  } catch(e) { toast(e.message); }
}

function confirmDeleteGroup(id, name) {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Delete Group</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="alert alert-danger" style="margin-bottom:0">Are you sure you want to delete <strong>${escHtml(name)}</strong>? This will permanently delete all messages and remove all members.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteGroup('${id}')">Delete Group</button>
    </div>`);
}

async function deleteGroup(id) {
  try {
    await apiPost('groups.php', {action:'delete_group', group_id:id});
    closeModal();
    state.activeGroup = null;
    toast('Group deleted.');
    renderCommunity();
  } catch(e) { toast(e.message); }
}

async function openGroup(id) {
  state.activeGroup = id;
  renderGroupList();
  try {
    const [msgsRes, groupsRes] = await Promise.all([
      apiGet('groups.php',{action:'messages', group_id:id}),
      apiGet('groups.php',{action:'list'}),
    ]);
    const msgs = msgsRes.messages||[];
    const g    = (groupsRes.groups||[]).find(x=>x.id===id)||{name:'Group',cadre:'',type:'general',member_count:0,tutor_id:''};
    const isCreator = g.tutor_id === state.user.id;
    const safeName = escHtml(g.name).replace(/"/g,'&quot;');
    const groupAction = isCreator
      ? `<button class="btn btn-danger btn-sm" style="margin-left:auto" data-gid="${id}" data-gname="${safeName}" onclick="confirmDeleteGroup(this.dataset.gid,this.dataset.gname)">Delete Group</button>`
      : `<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="leaveGroup('${id}')">Leave</button>`;
    document.getElementById('chat-main').innerHTML=`
      <div class="chat-main-hdr">
        <div class="avatar" style="width:38px;height:38px;background:var(--primary-bg);color:var(--primary);font-size:13px">${escHtml(g.name.slice(0,2).toUpperCase())}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px">${escHtml(g.name)}</div>
          <div style="font-size:11.5px;color:var(--text-m)">${g.member_count||0} members · ${escHtml(g.cadre||'')} · ${g.type==='tutorial'?'📖 Tutorial':'💬 General'}</div>
        </div>
        ${groupAction}
      </div>
      <div class="chat-msgs" id="chat-msgs">${renderMessages(msgs)}</div>
      <div class="chat-input-bar">
        <input class="inp" id="chat-input" placeholder="Type a message…" style="flex:1" onkeydown="if(event.key==='Enter')sendMsg('${id}')">
        <button class="btn btn-primary" onclick="sendMsg('${id}')">➤ Send</button>
      </div>`;
    scrollChat();
  } catch(e) { toast('Could not load group: '+e.message); }
}

function renderMessages(msgs) {
  if(!msgs.length) return `<div class="empty"><div class="empty-icon">💬</div><div class="empty-msg">No messages yet. Start the conversation!</div></div>`;
  return msgs.map(m=>{
    const isOwn = m.user_id===state.user.id;
    return `<div class="msg ${isOwn?'msg-own':'msg-other'}">
      ${!isOwn?`<div class="msg-sender">${escHtml(m.sender_name||'Unknown')}</div>`:''}
      <div class="msg-bubble">${escHtml(m.message_text)}</div>
      <div class="msg-time">${fmtTime(m.sent_at)}</div>
    </div>`;
  }).join('');
}

async function sendMsg(gid) {
  const inp  = document.getElementById('chat-input');
  const text = (inp.value||'').trim();
  if(!text) return;
  inp.value = '';
  try {
    const data = await apiPost('groups.php',{action:'send', group_id:gid, text});
    const m    = data.message;
    const msgs = document.getElementById('chat-msgs');
    if(msgs){
      msgs.innerHTML+=`<div class="msg msg-own"><div class="msg-bubble">${escHtml(m.message_text)}</div><div class="msg-time">${fmtTime(m.sent_at)}</div></div>`;
      scrollChat();
    }
    renderGroupList();
  } catch(e) { inp.value=text; toast(e.message); }
}

function scrollChat() {
  setTimeout(()=>{const el=document.getElementById('chat-msgs');if(el)el.scrollTop=el.scrollHeight;},50);
}

function openCreateGroupModal() {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Create New Group</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="lbl">Group Name</label><input class="inp" id="ng-name" placeholder="e.g. ND ICD-10 Study Circle" onkeydown="if(event.key==='Enter')createGroup()"></div>
      <div class="form-group"><label class="lbl">Type</label>
        <select class="inp" id="ng-type"><option value="general">General Group (open discussion)</option><option value="tutorial">Tutorial Group (tutor-led)</option></select>
      </div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="ng-cadre"><option>Professional Diploma</option><option>National Diploma (ND)</option><option>HND/BSc</option></select>
      </div>
      <div class="alert alert-info" style="font-size:12px;margin-bottom:0">Messages in this group are automatically deleted after 30 days.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createGroup()">Create Group</button>
    </div>`);
}

async function createGroup() {
  const name = document.getElementById('ng-name').value.trim();
  if(!name) return;
  try {
    await apiPost('groups.php',{action:'create', name, type:document.getElementById('ng-type').value, cadre:document.getElementById('ng-cadre').value});
    closeModal(); renderGroupList(); toast(`Group "${name}" created!`);
  } catch(e) { toast(e.message); }
}

// ── PROFILE ───────────────────────────────────────────────────────
async function renderProfile() {
  state.editingProfile = false;
  document.getElementById('edit-profile-btn').textContent = 'Edit Profile';
  const u = state.user;
  const c = cadreColor[u.cadre]||'var(--primary)';
  document.getElementById('profile-header-card').innerHTML=`
    <div style="display:flex;align-items:flex-start;gap:20px">
      <div class="avatar" style="width:78px;height:78px;background:${c};font-size:24px">${initials(u.name)}</div>
      <div style="flex:1">
        <div style="font-size:22px;font-weight:800;margin-bottom:6px">${escHtml(u.name)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span class="badge" style="background:${cadreBg[u.cadre]||'#eee'};color:${c}">${escHtml(u.cadre||'')}</span>
          <span class="badge badge-gray" style="text-transform:capitalize">${u.role}</span>
        </div>
        <div style="font-size:12.5px;color:var(--text-m)">Member since ${u.joined_at||u.joined ? fmtDate(u.joined_at||u.joined) : 'Unknown'}</div>
      </div>
    </div>`;
  renderProfileDetails(false);
}

function toggleEditProfile() {
  state.editingProfile = !state.editingProfile;
  document.getElementById('edit-profile-btn').textContent = state.editingProfile?'Cancel':'Edit Profile';
  renderProfileDetails(state.editingProfile);
}

function renderProfileDetails(editing) {
  const u = state.user;
  if(editing) {
    document.getElementById('profile-details-card').innerHTML=`
      <div style="font-weight:800;font-size:14px;margin-bottom:16px">Edit Profile</div>
      <div class="form-group"><label class="lbl">Full Name</label><input class="inp" id="pd-name" value="${escHtml(u.name)}"></div>
      <div class="form-group"><label class="lbl">Email (cannot change)</label><input class="inp" value="${escHtml(u.email)}" disabled style="opacity:.6"></div>
      <div class="form-group"><label class="lbl">Institution</label><input class="inp" id="pd-inst" value="${escHtml(u.institution||'')}"></div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="pd-cadre">
          ${['Professional Diploma','National Diploma (ND)','HND/BSc'].map(c2=>`<option${c2===u.cadre?' selected':''}>${c2}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="lbl">Bio</label><textarea class="inp" id="pd-bio" placeholder="Tell others about yourself…">${escHtml(u.bio||'')}</textarea></div>
      <button class="btn btn-primary" onclick="saveProfile()">Save Changes</button>`;
  } else {
    const rows = [
      ...(u.matric_no?[['Member ID',`<span style="font-family:var(--mono);font-size:14px;color:var(--primary);font-weight:700">${escHtml(u.matric_no)}</span>`]]:[]),
      ['Email', escHtml(u.email)],
      ['Institution', escHtml(u.institution||'—')],
      ['Cadre', escHtml(u.cadre||'—')],
      ['Bio', escHtml(u.bio||'No bio added yet.')],
    ];
    document.getElementById('profile-details-card').innerHTML=`
      <div style="font-weight:800;font-size:14px;margin-bottom:16px">Profile Details</div>
      ${rows.map(([l,v])=>`
        <div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;gap:16px;align-items:flex-start">
          <div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.5px;min-width:100px">${l}</div>
          <div style="font-size:13.5px;flex:1;line-height:1.6">${v}</div>
        </div>`).join('')}`;
  }
}

async function saveProfile() {
  const name = document.getElementById('pd-name').value.trim();
  const inst = document.getElementById('pd-inst').value.trim();
  const cadre = document.getElementById('pd-cadre').value;
  const bio   = document.getElementById('pd-bio').value.trim();
  try {
    const data = await apiPost('profile.php',{action:'update', name, institution:inst, cadre, bio});
    state.user = Object.assign({},state.user,data.user);
    toast('Profile updated successfully!');
    buildSidebar(); buildHeader(); renderProfile();
  } catch(e) { toast(e.message); }
}

// ── ADMIN ─────────────────────────────────────────────────────────
async function renderAdmin() {
  const u = state.user, isTutor = u.role==='tutor';
  document.getElementById('admin-title').textContent = isTutor?'Tutor Panel':'Admin Dashboard';
  const tabs = isTutor
    ? [['groups','My Groups'],['content','Content'],['tutorials','Tutorials']]
    : [['overview','Overview'],['users','Users'],['exams','Exams'],['results','Results'],['courses','Courses'],['tutorials','Tutorials']];
  // Reset adminTab if it's not valid for this role (e.g. tutor inheriting admin's tab)
  if (!tabs.find(([k])=>k===state.adminTab)) state.adminTab = tabs[0][0];
  document.getElementById('admin-tabs').innerHTML = tabs.map(([k,l])=>
    `<button class="tab${state.adminTab===k?' active':''}" data-tab="${k}" onclick="switchAdminTab('${k}')">${l}</button>`).join('');
  document.getElementById('admin-actions').innerHTML = !isTutor
    ? `<button class="btn btn-ghost btn-sm" onclick="openAddUserModal()">＋ Add User</button>
       <button class="btn btn-primary btn-sm" onclick="openCreateExamModal()">＋ Create Exam</button>`
    : `<button class="btn btn-primary btn-sm" onclick="openCreateGroupModal()">＋ Create Group</button>`;
  await renderAdminTab();
}

async function switchAdminTab(tab) {
  state.tutAdminCatId = null;
  state.adminTab = tab;
  document.querySelectorAll('#admin-tabs .tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  await renderAdminTab();
}

async function renderAdminTab() {
  const tab = state.adminTab;
  const el  = document.getElementById('admin-content');
  el.innerHTML='<div class="empty"><div class="empty-msg" style="color:var(--text-m)">Loading…</div></div>';
  try {
    if(tab==='overview')  el.innerHTML = await buildAdminOverview();
    else if(tab==='users') el.innerHTML = await buildAdminUsers();
    else if(tab==='exams') el.innerHTML = await buildAdminExams();
    else if(tab==='results') await buildAdminResults(el);
    else if(tab==='groups') el.innerHTML = await buildTutorGroups();
    else if(tab==='courses') el.innerHTML = await buildAdminCourses();
    else if(tab==='tutorials') await buildAdminTutorials(el);
    else el.innerHTML='<div class="empty"><div class="empty-icon">🔧</div><div class="empty-msg">Coming soon</div></div>';
  } catch(e) { el.innerHTML=`<div class="empty"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`; }
}

async function buildAdminOverview() {
  // allSettled so one failing API doesn't blank the whole overview
  const [ur,er,cr,gr] = await Promise.allSettled([
    apiGet('users.php',{action:'list'}), apiGet('exams.php',{action:'list'}),
    apiGet('courses.php',{action:'list'}), apiGet('groups.php',{action:'list'}),
  ]);
  const users   = ur.status==='fulfilled' ? (ur.value.users||[])   : [];
  const exams   = er.status==='fulfilled' ? (er.value.exams||[])   : [];
  const courses = cr.status==='fulfilled' ? (cr.value.courses||[]) : [];
  const groups  = gr.status==='fulfilled' ? (gr.value.groups||[])  : [];
  const students=users.filter(u=>u.role==='student').length;
  const tutors  =users.filter(u=>u.role==='tutor').length;
  const stats=[['Students',students],['Tutors',tutors],['Exams',exams.length],['Groups',groups.length],['Courses',courses.length]];
  const cadreRows=['Professional Diploma','National Diploma (ND)','HND/BSc'].map(c2=>{
    const n=users.filter(u=>u.cadre===c2).length;
    const pct=users.length?Math.round(n/users.length*100):0;
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
        <span style="font-weight:600">${c2}</span><span style="color:var(--text-m)">${n} users</span>
      </div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%;background:${cadreColor[c2]||'var(--primary)'}"></div></div>
    </div>`;
  }).join('');
  return `<div class="stat-grid">${stats.map(([l,v])=>`<div class="stat-card"><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="two-col">
      <div class="card"><div style="font-weight:800;font-size:14px;margin-bottom:16px">Users by Cadre</div>${cadreRows}</div>
      <div class="card"><div style="font-weight:800;font-size:14px;margin-bottom:14px">Recent Exams</div>
        ${exams.slice(0,4).map(e=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:700;font-size:13px">${escHtml(e.title)}</div>
          <div style="font-size:11.5px;color:var(--text-m)">${e.registered_count||0} registered · ${escHtml(e.cadre||'')}</div>
        </div>`).join('')}
      </div>
    </div>`;
}

async function buildAdminUsers() {
  const data  = await apiGet('users.php', {action:'list'});
  const users = data.users || [];
  const cadreOptions = ['Professional Diploma','National Diploma (ND)','HND/BSc'];
  return `
    <div class="card" style="margin-bottom:14px;background:var(--danger-bg);border-color:#f0a0a0">
      <div style="font-weight:800;font-size:13.5px;color:#7A1818;margin-bottom:10px">⚠️ Bulk Delete by Cadre</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px">
        ${cadreOptions.map(c=>`
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text)">
            <input type="checkbox" class="bulk-cadre-chk" value="${c}" style="width:15px;height:15px;cursor:pointer">
            ${escHtml(c)}
          </label>`).join('')}
      </div>
      <button class="btn btn-danger btn-sm" onclick="bulkDeleteUsers()">🗑 Delete All Members of Selected Cadres</button>
    </div>
    <div class="tbl-wrap"><table>
    <thead><tr><th>Name</th><th>Member ID</th><th>Email</th><th>Role</th><th>Cadre</th><th>Institution</th><th>Joined</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u=>`<tr>
      <td><strong>${escHtml(u.name)}</strong></td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--primary);font-weight:700">${escHtml(u.matric_no||'—')}</td>
      <td style="color:var(--text-m);font-size:12.5px">${escHtml(u.email)}</td>
      <td><span class="badge badge-gray" style="text-transform:capitalize">${u.role}</span></td>
      <td>${u.cadre?`<span class="badge" style="background:${cadreBg[u.cadre]||'#eee'};color:${cadreColor[u.cadre]||'#333'}">${cadreLabel[u.cadre]||'?'}</span>`:'—'}</td>
      <td style="font-size:12.5px">${escHtml(u.institution||'—')}</td>
      <td style="font-size:12px;color:var(--text-m)">${fmtDate(u.joined_at||u.joined)}</td>
      <td style="white-space:nowrap;display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" onclick="toggleUserRole('${u.id}')">Toggle Role</button>
        <button class="btn btn-danger btn-sm"
          data-uid="${u.id}"
          data-name="${escHtml(u.name).replace(/"/g,'&quot;')}"
          onclick="deleteUser(this.dataset.uid, this.dataset.name)">🗑 Delete</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function toggleUserRole(uid) {
  try {
    const data = await apiPost('users.php', {action:'toggle_role', user_id:uid});
    toast(`Role changed to ${data.new_role}`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function deleteUser(uid, name) {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Delete Member</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="alert alert-danger">You are about to permanently delete <strong>${escHtml(name)}</strong>.<br><br>
      This will erase all their exam attempts, registrations and account data. This cannot be undone.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDeleteUser('${uid}')">Yes, Delete Permanently</button>
    </div>`);
}

async function confirmDeleteUser(uid) {
  try {
    await apiPost('users.php', {action:'delete', user_id:uid});
    closeModal();
    toast('Member deleted.');
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

let _bulkDeleteCadres = null;

function bulkDeleteUsers() {
  const checked = [...document.querySelectorAll('.bulk-cadre-chk:checked')].map(c => c.value);
  if (!checked.length) { toast('Select at least one cadre first.'); return; }
  _bulkDeleteCadres = checked;
  const cadreList = checked.map(c => `<strong>${escHtml(c)}</strong>`).join(', ');
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Bulk Delete Members</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="alert alert-danger">You are about to permanently delete <strong>all members</strong> in:<br><br>
      ${cadreList}<br><br>
      This will erase all their exam attempts, registrations and account data. This cannot be undone.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmBulkDeleteUsers()">Yes, Delete All</button>
    </div>`);
}

async function confirmBulkDeleteUsers() {
  const cadres = _bulkDeleteCadres;
  _bulkDeleteCadres = null;
  if (!cadres || !cadres.length) return;
  try {
    const data = await apiPost('users.php', {action:'bulk_delete', cadres});
    closeModal();
    toast(`${data.deleted} member(s) deleted.`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

async function buildAdminExams() {
  const data  = await apiGet('exams.php',{action:'list'});
  const exams = data.exams||[];
  const now   = Date.now();
  const statusOpts = [
    ['auto',              'Auto (time-based)'],
    ['registration_open', 'Registration Open'],
    ['upcoming',          'Upcoming'],
    ['live',              'Live'],
    ['ended',             'Ended'],
  ];
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Exam Title</th><th>Cadre</th><th>Start Time</th><th>Duration</th><th>Registered</th><th>Status</th><th>Override Status</th><th>Actions</th></tr></thead>
    <tbody>${exams.map(e=>{
      const eff      = examEffectiveStatus(e, now);
      const released = e.result_release_time && parseReleaseTime(e.result_release_time)<=now;
      const statusBadge = eff==='live'?'<span class="badge badge-live">Live</span>'
        :eff==='ended'?'<span class="badge badge-gray">Ended</span>'
        :eff==='registration_open'?'<span class="badge badge-success">Reg. Open</span>'
        :'<span class="badge badge-info">Upcoming</span>';
      const cur = e.status||'auto';
      const sel = statusOpts.map(([v,l])=>`<option value="${v}"${v===cur?' selected':''}>${l}</option>`).join('');
      return `<tr>
        <td><strong>${escHtml(e.title)}</strong></td>
        <td><span class="badge badge-accent">${escHtml(e.cadre||'All')}</span></td>
        <td style="font-size:12px">${fmtDT(e.start_time)}</td>
        <td>${e.duration_minutes} min</td>
        <td>${e.registered_count||0}</td>
        <td>${statusBadge}</td>
        <td><select class="inp" style="padding:5px 8px;font-size:12px;min-width:140px"
          onchange="setExamStatus('${e.id}',this.value)">${sel}</select></td>
        <td style="white-space:nowrap;display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openEditExamModal('${e.id}')">✏ Edit</button>
          ${eff==='ended'&&!released?`<button class="btn btn-outline btn-sm" onclick="releaseResults('${e.id}')">📊 Release</button>`:''}
          <button class="btn btn-danger btn-sm" data-id="${e.id}" data-title="${e.title.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" onclick="deleteExam(this.dataset.id,this.dataset.title)">🗑 Delete</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

async function buildAdminResults(el) {
  const data = await apiGet('exams.php',{action:'list'});
  const past = (data.exams||[]).filter(e=>examEffectiveStatus(e,Date.now())==='ended');
  if(!past.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📊</div><div class="empty-msg">No completed exams yet</div></div>`;return;}
  el.innerHTML=`<div class="alert alert-info">Click "Release Results" to make scores visible to students.</div>`;
  for(const e of past){
    const card = document.createElement('div');
    card.className='card'; card.style.marginBottom='12px';
    try {
      const res  = await apiGet('exams.php',{action:'results', exam_id:e.id});
      const atts = res.attempts||[];
      const qN   = e.question_count||1;
      const avg  = atts.length?Math.round(atts.reduce((s,a)=>s+parseInt(a.score),0)/atts.length):0;
      const pass = atts.length?Math.round(atts.filter(a=>a.score/qN>=.5).length/atts.length*100):0;
      const rel  = e.result_release_time&&parseReleaseTime(e.result_release_time)<=Date.now();
      card.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:800;font-size:15px">${escHtml(e.title)}</div>
            <div style="font-size:12px;color:var(--text-m);margin-top:4px">${atts.length} submissions · Avg: ${avg}/${qN} · Pass rate: ${pass}%</div>
          </div>
          ${rel?`<span class="badge badge-success">✅ Results Released</span>`:`<button class="btn btn-primary btn-sm" onclick="releaseResults('${e.id}')">Release Results</button>`}
        </div>
        ${atts.length?`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px">
          ${[['Submitted',atts.length],['Avg',`${avg}/${qN}`],['Pass Rate',`${pass}%`],
             ['Highest',Math.max(...atts.map(a=>+a.score))],['Lowest',Math.min(...atts.map(a=>+a.score))]].map(([l,v])=>
            `<div style="background:var(--surface);border-radius:var(--r);padding:10px 12px">
              <div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--primary)">${v}</div>
              <div style="font-size:10.5px;color:var(--text-m);margin-top:2px">${l}</div>
            </div>`).join('')}
        </div>
        <div style="margin-top:14px;overflow-x:auto"><table style="font-size:12px">
          <thead><tr><th>Name</th><th>Member ID</th><th>Score</th><th>%</th><th>Submitted</th><th>Integrity</th></tr></thead>
          <tbody>${atts.map(a=>`<tr>
            <td>${escHtml(a.name)}</td>
            <td style="font-family:var(--mono)">${escHtml(a.matric_no||'—')}</td>
            <td><strong>${a.score}/${qN}</strong></td>
            <td>${Math.round(a.score/qN*100)}%</td>
            <td style="color:var(--text-m)">${fmtDT(a.submitted_at)}</td>
            <td>${a.flagged==1
              ? `<span class="badge badge-danger" title="${escHtml(a.flag_reason||'')}">🚨 Flagged</span>`
              : '<span class="badge badge-success">✅ Clean</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`:'<div style="font-size:13px;color:var(--text-m);margin-top:10px">No submissions yet.</div>'}`;
    } catch(err) {
      card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${escHtml(e.title)}</strong>
        <span style="font-size:12px;color:var(--danger)">Could not load results</span>
      </div>`;
    }
    el.appendChild(card);
  }
}

async function releaseResults(id) {
  try { await apiPost('exams.php',{action:'release_results', exam_id:id}); toast('Results released!'); renderAdminTab(); }
  catch(e) { toast(e.message); }
}

async function buildTutorGroups() {
  const data = await apiGet('groups.php',{action:'list'});
  const mine = (data.groups||[]).filter(g=>g.tutor_id===state.user.id);
  if(!mine.length) return `<div class="empty"><div class="empty-icon">👥</div><div class="empty-msg">You haven't created any groups yet.<br><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="openCreateGroupModal()">＋ Create Your First Group</button></div></div>`;
  return `<div class="card-grid">${mine.map(g=>`
    <div class="card">
      <div style="font-weight:800;font-size:14.5px;margin-bottom:6px">${escHtml(g.name)}</div>
      <div style="font-size:12.5px;color:var(--text-m);margin-bottom:12px">${escHtml(g.cadre||'')} · ${g.type==='tutorial'?'📖 Tutorial':'💬 General'}</div>
      <span class="badge badge-gray">${g.member_count||0} members</span>
    </div>`).join('')}</div>`;
}

// ── ADMIN COURSES ─────────────────────────────────────────────────
async function buildAdminCourses() {
  const data    = await apiGet('courses.php', {action:'list'});
  const courses = data.courses || [];
  if (!courses.length) return `<div class="empty"><div class="empty-icon">📚</div><div class="empty-msg">No courses in the system yet.<br><span style="font-size:12px;color:var(--text-l)">Add courses via the database, then publish them here.</span></div></div>`;
  return `
    <div class="alert alert-info" style="margin-bottom:16px;font-size:13px">
      <strong>Learning is currently hidden from students.</strong> Publish a course when you're ready to make it visible.
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Course Title</th><th>Cadre</th><th>Topics</th><th>Status</th><th style="text-align:right">Action</th></tr></thead>
        <tbody>
          ${courses.map(c => {
            const isPublished = c.published == 1;
            return `<tr>
              <td><strong>${escHtml(c.title)}</strong></td>
              <td>${escHtml(c.cadre||'—')}</td>
              <td>${c.topic_count||0}</td>
              <td>${isPublished
                ? '<span class="badge badge-success">Published</span>'
                : '<span class="badge badge-gray">Draft</span>'}</td>
              <td style="text-align:right">
                <button class="btn btn-sm ${isPublished ? 'btn-ghost' : 'btn-primary'}"
                  onclick="togglePublishCourse('${escHtml(c.id)}',${isPublished?1:0})">
                  ${isPublished ? 'Unpublish' : 'Publish'}
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function togglePublishCourse(id, currentPublished) {
  try {
    await apiPost('courses.php', {action:'publish', course_id: id, published: currentPublished ? 0 : 1});
    toast(currentPublished ? 'Course unpublished — students can no longer see it.' : 'Course published — students can now access it!', 4000);
    await renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── MODALS ────────────────────────────────────────────────────────
function openModal(html)  { document.getElementById('modal-box').innerHTML=html; document.getElementById('modal-bg').style.display='flex'; }
function closeModal()     { document.getElementById('modal-bg').style.display='none'; document.getElementById('modal-box').innerHTML=''; }

function openAddUserModal() {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Add New User</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="lbl">Full Name</label><input class="inp" id="au-name" placeholder="e.g. Ngozi Adeyemi"></div>
      <div class="form-group"><label class="lbl">Email</label><input class="inp" type="email" id="au-email"></div>
      <div class="form-group"><label class="lbl">Password</label><input class="inp" type="password" id="au-pwd" value="himvault2025"></div>
      <div class="form-group"><label class="lbl">Role</label>
        <select class="inp" id="au-role"><option value="student">Student</option><option value="tutor">Tutor</option><option value="admin">Admin</option></select>
      </div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="au-cadre"><option>Professional Diploma</option><option>National Diploma (ND)</option><option>HND/BSc</option></select>
      </div>
      <div class="form-group"><label class="lbl">Institution</label><input class="inp" id="au-inst" placeholder="e.g. UNILAG"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addUser()">Add User</button>
    </div>`);
}

async function addUser() {
  const name = document.getElementById('au-name').value.trim();
  const email= document.getElementById('au-email').value.trim();
  if(!name||!email){toast('Please fill in name and email');return;}
  try {
    const data = await apiPost('users.php',{
      action:'add', name, email,
      password:    document.getElementById('au-pwd').value,
      role:        document.getElementById('au-role').value,
      cadre:       document.getElementById('au-cadre').value,
      institution: document.getElementById('au-inst').value,
    });
    closeModal();
    toast(data.matric_no?`User "${name}" added — Member ID: ${data.matric_no}`:`User "${name}" added!`, 5000);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function openCreateExamModal() {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Create New Exam</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="lbl">Exam Title</label><input class="inp" id="ce-title" placeholder="e.g. HIM Foundation Exam 2025"></div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="ce-cadre">
          <option value="All Cadres">All Cadres (visible to everyone)</option>
          <option>Professional Diploma</option>
          <option>National Diploma (ND)</option>
          <option>HND/BSc</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="lbl">Start Date &amp; Time</label><input type="datetime-local" class="inp" id="ce-start"></div>
        <div class="form-group"><label class="lbl">End Date &amp; Time</label><input type="datetime-local" class="inp" id="ce-end"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="lbl">Registration Deadline</label><input type="datetime-local" class="inp" id="ce-reg"></div>
        <div class="form-group"><label class="lbl">Duration (minutes)</label><input type="number" class="inp" id="ce-dur" value="90" min="10" max="360"></div>
      </div>
      <hr>
      <div style="font-weight:800;font-size:13px;margin-bottom:10px">Questions</div>
      <div class="alert alert-info" style="font-size:12px;margin-bottom:12px;line-height:1.8">
        <strong>Accepted .txt format — each block separated by a blank line:</strong><br>
        1. Question text?<br>A. Option one<br>B. Option two<br>C. Option three<br>D. Option four<br>Answer: A
      </div>
      <div class="form-group"><label class="lbl">Upload .txt File</label><input type="file" accept=".txt" class="inp" id="ce-file" onchange="handleQFile(this)" style="padding:8px;cursor:pointer"></div>
      <div class="form-group"><label class="lbl">Or Paste Questions Text</label><textarea class="inp" id="ce-qtext" rows="5" placeholder="Paste your questions here…" oninput="previewQs()"></textarea></div>
      <div id="ce-qpreview" style="font-size:12.5px;margin-top:4px;min-height:20px"></div>
      <div style="font-size:12px;color:var(--text-m);margin-top:8px">Leave blank to use 10 sample placeholder questions.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createExam()">Create Exam</button>
    </div>`);
}

async function createExam() {
  const title = document.getElementById('ce-title').value.trim();
  const start = document.getElementById('ce-start').value;
  if(!title||!start){toast('Please fill in exam title and start time');return;}
  const qtext = (document.getElementById('ce-qtext').value||'').trim();
  let questions;
  if(qtext){
    questions = parseQuestionsText(qtext);
    if(!questions.length){toast('Could not parse questions. Please check the format.');return;}
  } else {
    questions = Array.from({length:10},(_,i)=>({
      text:`[Sample Q${i+1}] What is the correct HIM principle regarding ${['record ownership','ICD-10 coding','PHI protection','EHR benefits','NHIA compliance','retention periods','medical terminology','body systems','coding guidelines','health legislation'][i]}?`,
      options:['Option A — Correct answer','Option B — Incorrect','Option C — Incorrect','Option D — Incorrect'],
      correct:0,
    }));
  }
  try {
    const toISO = v => v ? v.replace('T', ' ') : '';
    await apiPost('exams.php',{
      action:'create', title,
      cadre:                  document.getElementById('ce-cadre').value,
      start_time:             toISO(start),
      end_time:               toISO(document.getElementById('ce-end').value),
      registration_deadline:  toISO(document.getElementById('ce-reg').value||start),
      duration:               parseInt(document.getElementById('ce-dur').value)||90,
      questions,
    });
    closeModal();
    toast(`Exam "${title}" created with ${questions.length} questions!`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── QUESTION PARSER ───────────────────────────────────────────────
function parseQuestionsText(raw) {
  const text   = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const blocks = text.split(/\n[ \t]*\n/).map(b=>b.trim()).filter(Boolean);
  const questions = [];
  for(const block of blocks){
    const lines = block.split('\n').map(l=>l.trim()).filter(Boolean);
    if(lines.length<3) continue;
    const qText = lines[0].replace(/^[Qq]?\d+[\.\)]\s*/,'').trim();
    if(!qText) continue;
    const options=[]; let correct=0;
    for(let i=1;i<lines.length;i++){
      const line=lines[i];
      if(/^(answer|ans|correct)\s*[:\-]/i.test(line)){
        const m=line.match(/[:\-]\s*([a-dA-D1-4])/);
        if(m){const ch=m[1].toLowerCase(); correct='abcd'.includes(ch)?'abcd'.indexOf(ch):Math.max(0,parseInt(ch)-1);}
        continue;
      }
      const m=line.match(/^[(\[]?([a-dA-D1-4])[)\].\s:]+(.+)/);
      if(m) options.push(m[2].trim());
    }
    if(qText&&options.length>=2)
      questions.push({text:qText, options:options.slice(0,4), correct:Math.min(correct,options.length-1)});
  }
  return questions;
}

function handleQFile(input) {
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=e=>{document.getElementById('ce-qtext').value=e.target.result; previewQs();};
  r.readAsText(file);
}

function previewQs() {
  const text=(document.getElementById('ce-qtext').value||'').trim();
  const el=document.getElementById('ce-qpreview'); if(!el) return;
  if(!text){el.innerHTML='';return;}
  const qs=parseQuestionsText(text);
  el.innerHTML=qs.length
    ?`<span style="color:var(--success);font-weight:700">✅ ${qs.length} question${qs.length>1?'s':''} detected.</span>`
    :`<span style="color:var(--danger);font-weight:700">⚠ Could not parse — check the format.</span>`;
}

// ── EXAM STATUS OVERRIDE ─────────────────────────────────────────
async function setExamStatus(examId, status) {
  try {
    await apiPost('exams.php', {action:'set_status', exam_id:examId, status: status==='auto' ? null : status});
    toast('Status updated');
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── EDIT / DELETE EXAM ───────────────────────────────────────────
async function openEditExamModal(examId) {
  try {
    const data = await apiGet('exams.php', {action:'get', exam_id:examId});
    const e = data.exam;
    const toLocal = d => d ? d.replace(' ', 'T').slice(0, 16) : '';
    const qText = (e.questions||[]).map((q,i)=>{
      const ans = ['A','B','C','D'][parseInt(q.correct_option)] || 'A';
      return `${i+1}. ${q.question_text}\nA. ${q.option_a}\nB. ${q.option_b}\nC. ${q.option_c}\nD. ${q.option_d}\nAnswer: ${ans}`;
    }).join('\n\n');
    openModal(`<div class="modal-hdr">
      <div class="modal-hdr-title">Edit Exam</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="lbl">Exam Title</label><input class="inp" id="ee-title" value="${escHtml(e.title)}"></div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="ee-cadre">
          ${['All Cadres','Professional Diploma','National Diploma (ND)','HND/BSc'].map(c=>`<option${c===e.cadre?' selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="lbl">Start Date &amp; Time</label><input type="datetime-local" class="inp" id="ee-start" value="${toLocal(e.start_time)}"></div>
        <div class="form-group"><label class="lbl">End Date &amp; Time</label><input type="datetime-local" class="inp" id="ee-end" value="${toLocal(e.end_time)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="lbl">Registration Deadline</label><input type="datetime-local" class="inp" id="ee-reg" value="${toLocal(e.registration_deadline)}"></div>
        <div class="form-group"><label class="lbl">Duration (minutes)</label><input type="number" class="inp" id="ee-dur" value="${e.duration_minutes}" min="10" max="360"></div>
      </div>
      <hr>
      <div style="font-weight:800;font-size:13px;margin-bottom:6px">Questions</div>
      <div class="alert alert-info" style="font-size:12px;margin-bottom:10px;line-height:1.8">Edit or replace questions below. Leave the box as-is to keep existing questions.<br><strong>Format:</strong> 1. Question?&nbsp; A. Option &nbsp;B. Option &nbsp;C. Option &nbsp;D. Option &nbsp;Answer: A</div>
      <div class="form-group">
        <textarea class="inp" id="ee-qtext" rows="7" oninput="previewEditQs()">${escHtml(qText)}</textarea>
      </div>
      <div id="ee-qpreview" style="font-size:12.5px;margin-top:4px;min-height:20px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveExamEdit('${examId}')">Save Changes</button>
    </div>`);
    previewEditQs();
  } catch(e) { toast('Could not load exam: '+e.message); }
}

function previewEditQs() {
  const text = (document.getElementById('ee-qtext').value||'').trim();
  const el   = document.getElementById('ee-qpreview'); if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const qs = parseQuestionsText(text);
  el.innerHTML = qs.length
    ? `<span style="color:var(--success);font-weight:700">✅ ${qs.length} question${qs.length>1?'s':''} detected.</span>`
    : `<span style="color:var(--danger);font-weight:700">⚠ Could not parse — check the format.</span>`;
}

async function saveExamEdit(examId) {
  const title = document.getElementById('ee-title').value.trim();
  const start = document.getElementById('ee-start').value;
  if (!title || !start) { toast('Please fill in exam title and start time'); return; }
  const qtext = (document.getElementById('ee-qtext').value||'').trim();
  let questions = null;
  if (qtext) {
    questions = parseQuestionsText(qtext);
    if (!questions.length) { toast('Could not parse questions. Check the format.'); return; }
  }
  try {
    const toISO = v => v ? v.replace('T', ' ') : '';
    await apiPost('exams.php', {
      action:'update', exam_id:examId, title,
      cadre:                 document.getElementById('ee-cadre').value,
      start_time:            toISO(start),
      end_time:              toISO(document.getElementById('ee-end').value),
      registration_deadline: toISO(document.getElementById('ee-reg').value||start),
      duration:              parseInt(document.getElementById('ee-dur').value)||90,
      questions,
    });
    closeModal();
    toast(`Exam "${title}" updated!`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function deleteExam(examId, title) {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Delete Exam</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="alert alert-danger">You are about to permanently delete <strong>${escHtml(title)}</strong>.<br><br>
      This will also erase all registrations, attempts and scores. This cannot be undone.</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDeleteExam('${examId}')">Yes, Delete Permanently</button>
    </div>`);
}

async function confirmDeleteExam(examId) {
  try {
    await apiPost('exams.php', {action:'delete', exam_id:examId});
    closeModal();
    toast('Exam deleted.');
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── TUTORIALS (MEMBER VIEW) ───────────────────────────────────────
async function renderTutorials() {
  await showTutCategories();
}

async function showTutCategories() {
  state.tutCatId = null;
  document.getElementById('tut-categories-view').style.display = '';
  document.getElementById('tut-flashcard-view').style.display  = 'none';
  const el = document.getElementById('tut-cat-grid');
  el.innerHTML = '<div class="empty"><div class="empty-msg" style="color:var(--text-m)">Loading…</div></div>';
  try {
    const { categories } = await apiGet('tutorials.php', { action: 'list_categories' });
    if (!categories.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">📚</div><div class="empty-msg">No tutorial topics available yet. Check back soon!</div></div>';
      return;
    }
    el.innerHTML = categories.map(c => {
      const pct  = c.question_count > 0 ? Math.round(c.viewed_count / c.question_count * 100) : 0;
      const done = c.completed ? '<div class="tut-complete-badge">✓ Complete</div>' : '';
      return `<div class="tut-cat-card${c.completed ? ' completed' : ''}" onclick="openTutCategory(${c.id})">
        ${done}
        <div class="tut-cat-icon">${escHtml(c.icon || '📚')}</div>
        <div class="tut-cat-name">${escHtml(c.name)}</div>
        <div class="tut-cat-desc">${escHtml(c.description || '')}</div>
        <div class="tut-cat-meta">
          <span>${c.question_count} question${c.question_count !== 1 ? 's' : ''}</span>
          <span>${c.viewed_count}/${c.question_count} viewed</span>
        </div>
        <div class="tut-progress-bar"><div class="tut-progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<div class="empty"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
  }
}

async function openTutCategory(catId) {
  document.getElementById('tut-categories-view').style.display = 'none';
  document.getElementById('tut-flashcard-view').style.display  = '';
  const card = document.getElementById('tut-flashcard');
  card.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-m)">Loading…</div>';
  document.getElementById('tut-nav').innerHTML  = '';
  document.getElementById('tut-dots').innerHTML = '';
  try {
    const { questions, category } = await apiGet('tutorials.php', { action: 'list_questions', category_id: catId });
    if (!questions.length) {
      card.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-m)">No questions published in this topic yet.</div>';
      return;
    }
    state.tutCatId     = catId;
    state.tutQuestions = questions;
    state.tutIndex     = 0;
    document.getElementById('tut-cat-header').innerHTML =
      `<div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:26px">${escHtml(category.icon || '📚')}</span>
        <div>
          <div style="font-weight:800;font-size:16px">${escHtml(category.name)}</div>
          <div style="font-size:12px;color:var(--text-m)">${questions.length} question${questions.length !== 1 ? 's' : ''} · Use ← → keys or buttons to navigate · Space to reveal answer</div>
        </div>
      </div>`;
    renderTutCard('right');
    markTutViewed(questions[0]);
  } catch(e) {
    document.getElementById('tut-flashcard').innerHTML = `<div style="padding:20px;color:var(--danger)">${escHtml(e.message)}</div>`;
  }
}

function renderTutCard(dir) {
  const qs  = state.tutQuestions;
  const idx = state.tutIndex;
  const q   = qs[idx];
  const card = document.getElementById('tut-flashcard');
  card.className = 'tut-flashcard';
  void card.offsetWidth; // force reflow so animation re-triggers
  card.classList.add(dir === 'right' ? 'slide-in-right' : 'slide-in-left');
  card.innerHTML = `
    <div class="tut-q-num">Question ${idx + 1} of ${qs.length}</div>
    <div class="tut-q-text">${escHtml(q.question)}</div>
    <div class="tut-card-controls">
      <button class="btn btn-primary btn-sm" id="tut-show-btn" onclick="tutShowAnswer()">💡 Show Answer</button>
    </div>
    <div class="tut-answer-wrap" id="tut-answer">
      <div class="tut-answer-label">Answer</div>
      <div class="tut-answer-text">${escHtml(q.answer)}</div>
    </div>`;

  document.getElementById('tut-nav').innerHTML =
    `<button class="btn btn-outline btn-sm" onclick="tutPrev()" ${idx === 0 ? 'disabled' : ''}>← Previous</button>
     <span style="font-size:13px;color:var(--text-m);font-weight:600">${idx + 1} / ${qs.length}</span>
     <button class="btn btn-primary btn-sm" onclick="tutNext()" ${idx === qs.length - 1 ? 'disabled' : ''}>Next →</button>`;

  document.getElementById('tut-dots').innerHTML = qs.map((q2, i) =>
    `<span class="tut-viewed-dot" title="Q${i + 1}${q2.viewed ? ' (viewed)' : ''}"
      style="background:${q2.viewed ? 'var(--primary)' : 'var(--border)'};${i === idx ? 'transform:scale(1.6)' : ''}"></span>`
  ).join('');
}

function tutShowAnswer() {
  const wrap = document.getElementById('tut-answer');
  if (wrap) wrap.classList.add('visible');
  const btn = document.getElementById('tut-show-btn');
  if (btn) { btn.textContent = '✓ Answer shown'; btn.disabled = true; btn.style.opacity = '.5'; }
}

function tutNext() {
  if (state.tutIndex >= state.tutQuestions.length - 1) return;
  state.tutIndex++;
  const q = state.tutQuestions[state.tutIndex];
  renderTutCard('right');
  markTutViewed(q);
}

function tutPrev() {
  if (state.tutIndex <= 0) return;
  state.tutIndex--;
  renderTutCard('left');
}

async function markTutViewed(q) {
  if (q.viewed) return;
  q.viewed = true;
  try { await apiPost('tutorials.php', { action: 'mark_viewed', question_id: q.id }); } catch(_) {}
}

// ── TUTORIALS (ADMIN / TUTOR VIEW) ───────────────────────────────
async function buildAdminTutorials(el) {
  if (state.tutAdminCatId) {
    await buildTutAdminQuestions(el, state.tutAdminCatId);
  } else {
    await buildTutAdminCategories(el);
  }
}

async function buildTutAdminCategories(el) {
  try {
    const { categories } = await apiGet('tutorials.php', { action: 'list_categories' });
    const rows = categories.map(c => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:14px 16px;font-size:20px;width:44px">${escHtml(c.icon || '📚')}</td>
        <td style="padding:14px 16px">
          <div style="font-weight:700;font-size:13.5px">${escHtml(c.name)}</div>
          <div style="font-size:11.5px;color:var(--text-m);margin-top:2px">${escHtml(c.description || '')}</div>
        </td>
        <td style="padding:14px 16px;text-align:center;width:100px">
          <span class="badge" style="background:var(--primary-bg);color:var(--primary)">${c.total_count ?? c.question_count} total</span>
        </td>
        <td style="padding:14px 16px;text-align:center;width:110px">
          <span class="badge" style="background:var(--success-bg);color:var(--success)">${c.question_count} published</span>
        </td>
        <td style="padding:14px 16px;text-align:right;white-space:nowrap;width:220px">
          <button class="btn btn-ghost btn-sm" onclick="tutAdminSelectCat(${c.id})">Manage Questions →</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditCatModal(${c.id})">Edit</button>
          ${state.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteTutCat(${c.id},'${escHtml(c.name).replace(/'/g,"\\'")}')">Delete</button>` : ''}
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-weight:700;font-size:15px">Tutorial Categories</div>
        <button class="btn btn-primary btn-sm" onclick="openAddCatModal()">＋ Add Category</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="padding:11px 16px;text-align:left;font-size:11.5px;color:var(--text-m);font-weight:700"></th>
            <th style="padding:11px 16px;text-align:left;font-size:11.5px;color:var(--text-m);font-weight:700">Category</th>
            <th style="padding:11px 16px;text-align:center;font-size:11.5px;color:var(--text-m);font-weight:700">Questions</th>
            <th style="padding:11px 16px;text-align:center;font-size:11.5px;color:var(--text-m);font-weight:700">Published</th>
            <th style="padding:11px 16px;text-align:right;font-size:11.5px;color:var(--text-m);font-weight:700">Actions</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="padding:32px;text-align:center;color:var(--text-m)">No categories yet. Add one above.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="empty"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
  }
}

async function buildTutAdminQuestions(el, catId) {
  try {
    const { questions, category } = await apiGet('tutorials.php', { action: 'list_questions', category_id: catId });
    const rows = questions.map((q, i) => `
      <tr style="border-bottom:1px solid var(--border)" id="tq-row-${q.id}">
        <td style="padding:14px 16px;width:40px;text-align:center">
          <input type="checkbox" class="tq-sel" value="${q.id}" onchange="updateTutBulkBar()"
            style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary)">
        </td>
        <td style="padding:14px 16px">
          <div style="font-size:11px;color:var(--text-l);font-weight:600;margin-bottom:3px">#${i + 1}</div>
          <div style="font-weight:600;font-size:13px;margin-bottom:5px">${escHtml(q.question)}</div>
          <div style="font-size:12px;color:var(--text-m);line-height:1.6;white-space:pre-wrap">${escHtml(q.answer)}</div>
        </td>
        <td style="padding:14px 16px;text-align:center;width:120px">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:${q.published ? 'var(--success)' : 'var(--text-m)'}">
            <input type="checkbox" ${q.published ? 'checked' : ''} onchange="toggleTutPublish(${q.id},this.checked)"
              style="width:15px;height:15px;cursor:pointer;accent-color:var(--success)">
            ${q.published ? 'Published' : 'Draft'}
          </label>
        </td>
        <td style="padding:14px 16px;text-align:right;white-space:nowrap;width:130px">
          <button class="btn btn-ghost btn-sm" onclick="openEditQuestionModal(${q.id},${catId})">Edit</button>
          ${state.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteTutQuestion(${q.id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="tutAdminBack()">← All Categories</button>
        <span style="font-size:20px">${escHtml(category.icon || '📚')}</span>
        <div style="font-weight:800;font-size:15px;flex:1">${escHtml(category.name)}</div>
        <button class="btn btn-ghost btn-sm" onclick="openBulkUploadModal(${catId})">📋 Bulk Upload</button>
        <button class="btn btn-primary btn-sm" onclick="openAddQuestionModal(${catId})">＋ Add Question</button>
      </div>
      <div id="tut-bulk-bar" style="display:none;align-items:center;gap:10px;background:var(--primary-bg);border:1px solid var(--primary-l);border-radius:var(--r);padding:10px 16px;margin-bottom:12px;flex-wrap:wrap">
        <span id="tut-bulk-count" style="font-size:13px;font-weight:700;color:var(--primary);flex:1">0 selected</span>
        <button class="btn btn-primary btn-sm" onclick="bulkTutPublish(1)">✓ Publish Selected</button>
        <button class="btn btn-outline btn-sm" onclick="bulkTutPublish(0)">Set to Draft</button>
        <button class="btn btn-ghost btn-sm" onclick="selectAllTutQuestions(false)">✕ Deselect All</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="padding:11px 16px;width:40px;text-align:center">
              <input type="checkbox" id="tq-sel-all" onchange="selectAllTutQuestions(this.checked)"
                style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary)" title="Select all">
            </th>
            <th style="padding:11px 16px;text-align:left;font-size:11.5px;color:var(--text-m);font-weight:700">Question & Answer</th>
            <th style="padding:11px 16px;text-align:center;font-size:11.5px;color:var(--text-m);font-weight:700">Status</th>
            <th style="padding:11px 16px;text-align:right;font-size:11.5px;color:var(--text-m);font-weight:700">Actions</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="padding:32px;text-align:center;color:var(--text-m)">No questions yet. Add one above.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="empty"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
  }
}

function selectAllTutQuestions(checked) {
  document.querySelectorAll('.tq-sel').forEach(cb => { cb.checked = checked; });
  const master = document.getElementById('tq-sel-all');
  if (master) master.checked = checked;
  updateTutBulkBar();
}

function updateTutBulkBar() {
  const all      = [...document.querySelectorAll('.tq-sel')];
  const selected = all.filter(cb => cb.checked);
  const bar      = document.getElementById('tut-bulk-bar');
  const count    = document.getElementById('tut-bulk-count');
  const master   = document.getElementById('tq-sel-all');
  if (!bar) return;
  bar.style.display   = selected.length > 0 ? 'flex' : 'none';
  if (count)  count.textContent = `${selected.length} question${selected.length !== 1 ? 's' : ''} selected`;
  if (master) master.indeterminate = selected.length > 0 && selected.length < all.length;
  if (master && selected.length === all.length && all.length > 0) master.checked = true;
}

async function bulkTutPublish(published) {
  const ids = [...document.querySelectorAll('.tq-sel:checked')].map(cb => parseInt(cb.value));
  if (!ids.length) return;
  try {
    await apiPost('tutorials.php', { action: 'bulk_publish', ids, published });
    toast(`${ids.length} question${ids.length !== 1 ? 's' : ''} ${published ? 'published' : 'set to draft'}`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function tutAdminSelectCat(catId) {
  state.tutAdminCatId = catId;
  renderAdminTab();
}

function tutAdminBack() {
  state.tutAdminCatId = null;
  renderAdminTab();
}

// Category modals
function openAddCatModal() {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">Add Category</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label class="lbl">Icon (emoji)</label>
      <input class="inp" id="tc-icon" value="📚" maxlength="4" style="max-width:80px">
    </div>
    <div class="form-group">
      <label class="lbl">Category Name *</label>
      <input class="inp" id="tc-name" placeholder="e.g. Clinical Coding">
    </div>
    <div class="form-group">
      <label class="lbl">Description</label>
      <input class="inp" id="tc-desc" placeholder="Brief description of this topic">
    </div>
    <input type="hidden" id="tc-id" value="">
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveTutCat()">Save Category</button>
  </div>`);
}

async function openEditCatModal(id) {
  try {
    const { categories } = await apiGet('tutorials.php', { action: 'list_categories' });
    const c = categories.find(x => x.id === id);
    if (!c) { toast('Category not found'); return; }
    openModal(`<div class="modal-hdr">
      <div class="modal-hdr-title">Edit Category</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="lbl">Icon (emoji)</label>
        <input class="inp" id="tc-icon" value="${escHtml(c.icon || '📚')}" maxlength="4" style="max-width:80px">
      </div>
      <div class="form-group">
        <label class="lbl">Category Name *</label>
        <input class="inp" id="tc-name" value="${escHtml(c.name)}">
      </div>
      <div class="form-group">
        <label class="lbl">Description</label>
        <input class="inp" id="tc-desc" value="${escHtml(c.description || '')}">
      </div>
      <input type="hidden" id="tc-id" value="${c.id}">
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTutCat()">Save Changes</button>
    </div>`);
  } catch(e) { toast(e.message); }
}

async function saveTutCat() {
  const name = document.getElementById('tc-name').value.trim();
  const desc = document.getElementById('tc-desc').value.trim();
  const icon = document.getElementById('tc-icon').value.trim() || '📚';
  const id   = document.getElementById('tc-id').value;
  if (!name) { toast('Category name is required'); return; }
  try {
    if (id) {
      await apiPost('tutorials.php', { action: 'update_category', id: parseInt(id), name, description: desc, icon });
      toast('Category updated');
    } else {
      await apiPost('tutorials.php', { action: 'create_category', name, description: desc, icon });
      toast('Category created');
    }
    closeModal();
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function deleteTutCat(id, name) {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">Delete Category</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="alert alert-danger">You are about to permanently delete <strong>${escHtml(name)}</strong> and all its questions and progress records. This cannot be undone.</div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="confirmDeleteTutCat(${id})">Delete Permanently</button>
  </div>`);
}

async function confirmDeleteTutCat(id) {
  try {
    await apiPost('tutorials.php', { action: 'delete_category', id });
    closeModal();
    toast('Category deleted');
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// Question modals
function openAddQuestionModal(catId) {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">Add Question</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label class="lbl">Question *</label>
      <textarea class="inp" id="tq-question" rows="3" placeholder="Enter the question…" style="resize:vertical"></textarea>
    </div>
    <div class="form-group">
      <label class="lbl">Answer *</label>
      <textarea class="inp" id="tq-answer" rows="4" placeholder="Enter the full answer…" style="resize:vertical"></textarea>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="tq-published" style="width:16px;height:16px;accent-color:var(--success)">
      <label for="tq-published" style="font-size:13px;font-weight:600;cursor:pointer">Publish immediately (visible to members)</label>
    </div>
    <input type="hidden" id="tq-cat-id" value="${catId}">
    <input type="hidden" id="tq-id" value="">
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveTutQuestion()">Save Question</button>
  </div>`);
}

async function openEditQuestionModal(id, catId) {
  try {
    const { questions } = await apiGet('tutorials.php', { action: 'list_questions', category_id: catId });
    const q = questions.find(x => x.id === id);
    if (!q) { toast('Question not found'); return; }
    openModal(`<div class="modal-hdr">
      <div class="modal-hdr-title">Edit Question</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="lbl">Question *</label>
        <textarea class="inp" id="tq-question" rows="3" style="resize:vertical">${escHtml(q.question)}</textarea>
      </div>
      <div class="form-group">
        <label class="lbl">Answer *</label>
        <textarea class="inp" id="tq-answer" rows="4" style="resize:vertical">${escHtml(q.answer)}</textarea>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="tq-published" ${q.published ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--success)">
        <label for="tq-published" style="font-size:13px;font-weight:600;cursor:pointer">Published (visible to members)</label>
      </div>
      <input type="hidden" id="tq-cat-id" value="${catId}">
      <input type="hidden" id="tq-id" value="${id}">
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTutQuestion()">Save Changes</button>
    </div>`);
  } catch(e) { toast(e.message); }
}

async function saveTutQuestion() {
  const question  = document.getElementById('tq-question').value.trim();
  const answer    = document.getElementById('tq-answer').value.trim();
  const catId     = parseInt(document.getElementById('tq-cat-id').value);
  const id        = document.getElementById('tq-id').value;
  const published = document.getElementById('tq-published').checked ? 1 : 0;
  if (!question || !answer) { toast('Question and answer are both required'); return; }
  try {
    if (id) {
      await apiPost('tutorials.php', { action: 'update_question', id: parseInt(id), question, answer, published });
      toast('Question updated');
    } else {
      await apiPost('tutorials.php', { action: 'create_question', category_id: catId, question, answer, published });
      toast('Question added');
    }
    closeModal();
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

async function toggleTutPublish(id, published) {
  try {
    await apiPost('tutorials.php', { action: 'toggle_publish', id, published: published ? 1 : 0 });
    toast(published ? 'Question published' : 'Question set to draft');
  } catch(e) { toast(e.message); renderAdminTab(); }
}

function deleteTutQuestion(id) {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">Delete Question</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="alert alert-danger">Delete this question permanently? All member progress for this question will also be removed. This cannot be undone.</div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="confirmDeleteTutQuestion(${id})">Delete</button>
  </div>`);
}

async function confirmDeleteTutQuestion(id) {
  try {
    await apiPost('tutorials.php', { action: 'delete_question', id });
    closeModal();
    toast('Question deleted');
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────
async function fetchNotifCount() {
  try {
    const { unread } = await apiGet('tutorials.php', { action: 'get_notifications' });
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const n = unread || 0;
    badge.textContent = n > 99 ? '99+' : n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  } catch(_) {}
}

async function openNotificationsPanel() {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">🔔 Notifications</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div id="notif-list" style="max-height:420px;overflow-y:auto">
    <div style="padding:24px;text-align:center;color:var(--text-m)">Loading…</div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost btn-sm" onclick="markAllNotifsRead()">Mark all as read</button>
    <button class="btn btn-ghost" onclick="closeModal()">Close</button>
  </div>`);
  try {
    const { notifications } = await apiGet('tutorials.php', { action: 'get_notifications' });
    const el = document.getElementById('notif-list');
    if (!el) return;
    if (!notifications.length) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-m)">No notifications yet</div>';
    } else {
      el.innerHTML = notifications.map(n => `
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start;${!+n.is_read?'background:var(--primary-bg)':''}">
          <span style="font-size:22px;flex-shrink:0">${escHtml(n.category_icon||'📚')}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:${+n.is_read?'500':'700'};color:var(--text)">${escHtml(n.message)}</div>
            <div style="font-size:11px;color:var(--text-m);margin-top:3px">${fmtDate(n.created_at)}</div>
            <button class="btn btn-ghost btn-sm" style="margin-top:6px;font-size:11.5px"
              onclick="goToTutCategory(${n.category_id})">Go to topic →</button>
          </div>
          ${!+n.is_read?'<span style="width:8px;height:8px;background:var(--primary);border-radius:50%;flex-shrink:0;margin-top:4px"></span>':''}
        </div>`).join('');
    }
    // Mark all read silently after opening
    await apiPost('tutorials.php', { action: 'mark_read' });
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'none';
  } catch(e) {
    const el = document.getElementById('notif-list');
    if (el) el.innerHTML = `<div style="padding:20px;color:var(--danger)">${escHtml(e.message)}</div>`;
  }
}

async function markAllNotifsRead() {
  try {
    await apiPost('tutorials.php', { action: 'mark_read' });
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'none';
    closeModal();
    toast('All notifications marked as read');
  } catch(e) { toast(e.message); }
}

async function goToTutCategory(catId) {
  closeModal();
  await navTo('tutorials');
  await openTutCategory(catId);
}

// ── BULK TUTORIAL UPLOAD ──────────────────────────────────────────
function parseTutorialQA(raw) {
  const text   = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.split(/\n[ \t]*\n/).map(b => b.trim()).filter(Boolean);
  const pairs  = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // Q: ... / A: ... format
    if (/^[Qq][:.]\s*/.test(lines[0])) {
      const q    = lines[0].replace(/^[Qq][:.]\s*/, '').trim();
      const aRaw = lines.slice(1).map(l => l.replace(/^[Aa][:.]\s*/, '')).join('\n').trim();
      if (q && aRaw) { pairs.push({ question: q, answer: aRaw }); continue; }
    }
    // 1. Question / answer lines format
    if (/^[0-9]+[.)]\s*/.test(lines[0])) {
      const q    = lines[0].replace(/^[0-9]+[.)]\s*/, '').trim();
      const aRaw = lines.slice(1).map(l => l.replace(/^[Aa][:.]\s*/, '')).join('\n').trim();
      if (q && aRaw) { pairs.push({ question: q, answer: aRaw }); continue; }
    }
    // Plain two-line: question / answer
    if (lines.length >= 2) {
      const q = lines[0].trim();
      const a = lines.slice(1).join('\n').trim();
      if (q && a) pairs.push({ question: q, answer: a });
    }
  }
  return pairs;
}

function openBulkUploadModal(catId) {
  openModal(`<div class="modal-hdr">
    <div class="modal-hdr-title">📋 Bulk Upload Questions</div>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div style="background:var(--surface);border-radius:var(--r);padding:12px 14px;font-size:12px;color:var(--text-m);margin-bottom:14px;line-height:1.7;border:1px solid var(--border)">
      <strong style="color:var(--text);display:block;margin-bottom:4px">Supported formats (separate each pair with a blank line):</strong>
      <code style="font-size:11px">Q: What is a health record?<br>A: A systematic documentation…</code><br><br>
      <code style="font-size:11px">1. Define clinical coding<br>Medical classification of diagnoses…</code><br><br>
      <code style="font-size:11px">What does SOAP stand for?<br>Subjective, Objective, Assessment, Plan</code>
    </div>
    <div class="form-group">
      <label class="lbl">Paste Q&A pairs *</label>
      <textarea class="inp" id="bulk-qa-text" rows="10" placeholder="Paste your questions and answers here…" style="resize:vertical;font-family:var(--mono);font-size:12px" oninput="previewTutBulk()"></textarea>
    </div>
    <div id="bulk-preview" style="font-size:12.5px;min-height:20px;margin-top:-6px"></div>
    <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-top:10px">
      <input type="checkbox" id="bulk-published" style="width:16px;height:16px;accent-color:var(--success)">
      <label for="bulk-published" style="font-size:13px;font-weight:600;cursor:pointer">Publish immediately (visible to members)</label>
    </div>
    <input type="hidden" id="bulk-cat-id" value="${catId}">
  </div>
  <div class="modal-foot">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveBulkTutQuestions()">Upload Questions</button>
  </div>`);
}

function previewTutBulk() {
  const text = (document.getElementById('bulk-qa-text').value || '').trim();
  const el   = document.getElementById('bulk-preview');
  if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const pairs = parseTutorialQA(text);
  el.innerHTML = pairs.length
    ? `<span style="color:var(--success);font-weight:700">✅ ${pairs.length} Q&A pair${pairs.length > 1 ? 's' : ''} detected</span>`
    : `<span style="color:var(--danger);font-weight:700">⚠ No pairs found — check the format above</span>`;
}

async function saveBulkTutQuestions() {
  const text      = (document.getElementById('bulk-qa-text').value || '').trim();
  const catId     = parseInt(document.getElementById('bulk-cat-id').value);
  const published = document.getElementById('bulk-published').checked ? 1 : 0;
  const pairs     = parseTutorialQA(text);
  if (!pairs.length) { toast('No valid Q&A pairs found. Check the format.'); return; }
  try {
    const { saved } = await apiPost('tutorials.php', {
      action: 'bulk_create', category_id: catId, questions: pairs, published,
    });
    closeModal();
    toast(`${saved} question${saved !== 1 ? 's' : ''} uploaded successfully!`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.getElementById('modal-bg').style.display!=='none') { closeModal(); return; }
  if(state.page==='tutorials'&&state.tutCatId!==null) {
    if(e.key==='ArrowRight') tutNext();
    else if(e.key==='ArrowLeft') tutPrev();
    else if(e.key===' '){ e.preventDefault(); tutShowAnswer(); }
  }
});

// Check for existing PHP session on page load; also handle ?reset=TOKEN links
(async()=>{
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken) {
    showResetPasswordForm(resetToken);
    return;
  }
  try {
    const data = await apiPost('auth.php',{action:'me'});
    if(data.user) loginUser(data.user);
  } catch(e) {
    // No active session — auth screen stays visible (default HTML state)
  }
})();

// Refresh exam list every 30 s while on exams page
setInterval(()=>{ if(state.page==='exams') renderExams(); }, 30000);

// Refresh notification badge every 60 s while logged in
setInterval(()=>{ if(state.user) fetchNotifCount(); }, 60000);
