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
  return json;
}

async function apiGet(file, params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`${API_BASE}/${file}${qs}`, { credentials: 'include' });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error);
  return json;
}

// ── RESET SHARED STATE (declared by inline script) ───────────────
state.user        = null;
state.page        = 'dashboard';
state.activeGroup = null;
state.examFilter  = 'upcoming';
state.adminTab    = 'overview';

// ── UTILITIES ────────────────────────────────────────────────────
const fmtDate = d => new Date(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
const fmtTime = d => new Date(d).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'});
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
  try {
    const data = await apiPost('auth.php', {action:'login', email, password});
    loginUser(data.user);
  } catch(e) {
    errEl.style.display = '';
    errEl.textContent = e.message || 'Invalid email or password.';
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
    if (data.matric_no) toast(`Your Matric No: ${data.matric_no} — please keep it safe!`, 7000);
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
  state.user = null;
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
    community:'Community', profile:'My Profile',
    admin: state.user.role==='admin' ? 'Admin Dashboard' : 'Tutor Panel',
  }[page] || page;
  const renders = {
    dashboard:renderDashboard, exams:renderExams, learn:renderLearn,
    community:renderCommunity, profile:renderProfile, admin:renderAdmin,
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
    {page:'dashboard', icon:'⊞', label:'Dashboard'},
    {page:'exams',     icon:'📋', label:'CBT Exams'},
    {page:'learn',     icon:'📚', label:'Learning'},
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
  const u = state.user;
  const c  = cadreColor[u.cadre]||'#0D6B52';
  const bg = cadreBg[u.cadre]||'#E0F5EE';
  document.getElementById('header-right').innerHTML =
    `<span class="badge" style="background:${bg};color:${c}">${escHtml(u.cadre||'')}</span>
     <div class="avatar" style="width:36px;height:36px;background:${c};font-size:13px">${initials(u.name)}</div>`;
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

  const [examsRes, coursesRes] = await Promise.all([
    apiGet('exams.php',{action:'list'}),
    apiGet('courses.php',{action:'list'}),
  ]);
  const exams   = examsRes.exams   || [];
  const courses = coursesRes.courses || [];
  const now     = Date.now();
  const upcoming = exams.filter(e => new Date(e.start_time)>now);
  const totalT   = courses.reduce((s,c)=>s+(c.topic_count||0),0);
  const doneT    = courses.reduce((s,c)=>s+(c.completed_count||0),0);

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

  document.getElementById('dash-learn-list').innerHTML = courses.slice(0,3).map(c=>{
    const pct = c.topic_count ? Math.round((c.completed_count||0)/c.topic_count*100) : 0;
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
        <span style="font-weight:700">${escHtml(c.title)}</span><span style="color:var(--text-m)">${pct}%</span>
      </div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    </div>`;
  }).join('') || '<div style="font-size:13px;color:var(--text-m)">No courses for your cadre.</div>';
}

// ── EXAMS ────────────────────────────────────────────────────────
function filterExams(f) {
  state.examFilter = f;
  document.querySelectorAll('#exam-tabs .tab').forEach((t,i)=>{
    t.classList.toggle('active',['upcoming','live','past'][i]===f);
  });
  renderExams();
}

async function renderExams() {
  const list = document.getElementById('exam-list');
  list.innerHTML = '<div class="empty"><div class="empty-msg" style="color:var(--text-m)">Loading…</div></div>';
  try {
    const data  = await apiGet('exams.php',{action:'list'});
    const exams = data.exams || [];
    const now   = Date.now();
    const f     = state.examFilter;
    const shown = exams.filter(e=>{
      const s=new Date(e.start_time).getTime(), en=new Date(e.end_time).getTime();
      if(f==='upcoming') return s>now;
      if(f==='live')     return s<=now&&en>=now;
      if(f==='past')     return en<now;
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
  const isReg     = e.is_registered||false;
  const attempt   = e.my_attempt||null;
  const s         = new Date(e.start_time).getTime();
  const en        = new Date(e.end_time).getTime();
  const isLive    = s<=now&&en>=now;
  const regOpen   = new Date(e.registration_deadline)>now;
  const released  = e.result_release_time && new Date(e.result_release_time)<=now;
  const c         = cadreColor[e.cadre]||'var(--primary)';
  const bg        = cadreBg[e.cadre]||'var(--primary-bg)';
  const qCount    = e.question_count||0;
  let action = '';
  if(attempt) {
    action = released
      ? `<div style="text-align:center;background:var(--primary-bg);border-radius:var(--r);padding:14px">
          <div style="font-family:var(--mono);font-size:26px;font-weight:800;color:var(--primary)">${attempt.score}/${qCount}</div>
          <div style="font-size:12px;color:var(--text-m)">${Math.round(attempt.score/qCount*100)}% · ${attempt.score/qCount>=0.5?'✅ Pass':'❌ Fail'}</div>
        </div>`
      : `<div class="alert alert-info" style="margin:0;font-size:12px">Results pending — admin will release scores soon</div>`;
  } else if(isLive&&isReg) {
    action=`<button class="btn btn-danger btn-block" onclick="verifyMatricAndStart('${e.id}')">🚀 Start Exam Now</button>`;
  } else if(!isLive&&s>now&&isReg) {
    action=`<div class="alert alert-info" style="margin:0;font-size:12px">✅ Registered — exam starts ${fmtDT(e.start_time)}</div>`;
  } else if(!isLive&&s>now&&!isReg&&regOpen) {
    action=`<button class="btn btn-primary btn-block" onclick="registerExam('${e.id}')">Register for Exam</button>`;
  } else {
    action=`<span class="badge badge-gray">Registration closed</span>`;
  }
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <span class="badge" style="background:${bg};color:${c}">${escHtml(e.cadre||'')}</span>
      ${isLive?'<span class="badge badge-live">● LIVE</span>':attempt?'<span class="badge badge-gray">Submitted</span>':''}
    </div>
    <div style="font-weight:800;font-size:14.5px;margin-bottom:10px;line-height:1.4">${escHtml(e.title)}</div>
    <div style="font-size:12px;color:var(--text-m);margin-bottom:14px;display:flex;flex-direction:column;gap:4px">
      <span>📅 ${fmtDT(e.start_time)}</span>
      <span>⏱ ${e.duration_minutes} minutes &nbsp;·&nbsp; ❓ ${qCount} questions</span>
    </div>
    ${action}
  </div>`;
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
      <div style="font-size:13.5px;color:var(--text-m);margin-bottom:18px;line-height:1.6">Enter your Matriculation Number exactly as issued at registration to begin the exam.</div>
      <div class="form-group">
        <label class="lbl">Matriculation Number</label>
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
    err.textContent = 'Incorrect Matric Number. Please check and try again.';
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
      state.user.matric_no ? `Matric: ${state.user.matric_no}` : '';
    renderExamQuestion();
    buildQNav();
    startExamTimer();
    document.addEventListener('visibilitychange', onVisChange);
  } catch(e) { toast('Could not start exam: '+e.message); }
}

function onVisChange() {
  if(document.hidden) toast('⚠️ Tab switching detected! Please stay on the exam page.',4000);
}

function stopExamTimer() {
  if(examState.timerInterval){clearInterval(examState.timerInterval);examState.timerInterval=null;}
  document.removeEventListener('visibilitychange',onVisChange);
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
      <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();navTo('exams')">Back to Exams</button></div>`);
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
  const u = state.user;
  document.getElementById('community-actions').innerHTML =
    (u.role==='tutor'||u.role==='admin')
      ? `<button class="btn btn-primary btn-sm" onclick="openCreateGroupModal()">＋ Create Group</button>` : '';
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

async function openGroup(id) {
  state.activeGroup = id;
  renderGroupList();
  try {
    const [msgsRes, groupsRes] = await Promise.all([
      apiGet('groups.php',{action:'messages', group_id:id}),
      apiGet('groups.php',{action:'list'}),
    ]);
    const msgs = msgsRes.messages||[];
    const g    = (groupsRes.groups||[]).find(x=>x.id===id)||{name:'Group',cadre:'',type:'general',member_count:0};
    document.getElementById('chat-main').innerHTML=`
      <div class="chat-main-hdr">
        <div class="avatar" style="width:38px;height:38px;background:var(--primary-bg);color:var(--primary);font-size:13px">${escHtml(g.name.slice(0,2).toUpperCase())}</div>
        <div>
          <div style="font-weight:800;font-size:14px">${escHtml(g.name)}</div>
          <div style="font-size:11.5px;color:var(--text-m)">${g.member_count||0} members · ${escHtml(g.cadre||'')} · ${g.type==='tutorial'?'📖 Tutorial':'💬 General'}</div>
        </div>
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
      <div class="form-group"><label class="lbl">Group Name</label><input class="inp" id="ng-name" placeholder="e.g. ND ICD-10 Study Circle"></div>
      <div class="form-group"><label class="lbl">Type</label>
        <select class="inp" id="ng-type"><option value="tutorial">Tutorial Group (tutor-led)</option><option value="general">General Group (open discussion)</option></select>
      </div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="ng-cadre"><option>Professional Diploma</option><option>National Diploma (ND)</option><option>HND/BSc</option></select>
      </div>
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
        <div style="font-size:12.5px;color:var(--text-m)">Member since ${fmtDate(u.joined_at||u.joined||new Date())}</div>
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
      ...(u.matric_no?[['Matric No',`<span style="font-family:var(--mono);font-size:14px;color:var(--primary);font-weight:700">${escHtml(u.matric_no)}</span>`]]:[]),
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
    ? [['groups','My Groups'],['content','Content']]
    : [['overview','Overview'],['users','Users'],['exams','Exams'],['results','Results']];
  document.getElementById('admin-tabs').innerHTML = tabs.map(([k,l])=>
    `<button class="tab${state.adminTab===k?' active':''}" onclick="switchAdminTab('${k}')">${l}</button>`).join('');
  document.getElementById('admin-actions').innerHTML = !isTutor
    ? `<button class="btn btn-ghost btn-sm" onclick="openAddUserModal()">＋ Add User</button>
       <button class="btn btn-primary btn-sm" onclick="openCreateExamModal()">＋ Create Exam</button>`
    : `<button class="btn btn-primary btn-sm" onclick="openCreateGroupModal()">＋ Create Group</button>`;
  await renderAdminTab();
}

async function switchAdminTab(tab) {
  state.adminTab = tab;
  document.querySelectorAll('#admin-tabs .tab').forEach(t=>{
    t.classList.toggle('active',t.textContent.toLowerCase().includes(tab.slice(0,4).toLowerCase()));
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
    else el.innerHTML='<div class="empty"><div class="empty-icon">🔧</div><div class="empty-msg">Coming soon</div></div>';
  } catch(e) { el.innerHTML=`<div class="empty"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`; }
}

async function buildAdminOverview() {
  const [ur,er,cr,gr] = await Promise.all([
    apiGet('users.php',{action:'list'}), apiGet('exams.php',{action:'list'}),
    apiGet('courses.php',{action:'list'}), apiGet('groups.php',{action:'list'}),
  ]);
  const users=ur.users||[], exams=er.exams||[], courses=cr.courses||[], groups=gr.groups||[];
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
  const data  = await apiGet('users.php',{action:'list'});
  const users = data.users||[];
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Name</th><th>Matric No</th><th>Email</th><th>Role</th><th>Cadre</th><th>Institution</th><th>Joined</th><th>Action</th></tr></thead>
    <tbody>${users.map(u=>`<tr>
      <td><strong>${escHtml(u.name)}</strong></td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--primary);font-weight:700">${escHtml(u.matric_no||'—')}</td>
      <td style="color:var(--text-m);font-size:12.5px">${escHtml(u.email)}</td>
      <td><span class="badge badge-gray" style="text-transform:capitalize">${u.role}</span></td>
      <td>${u.cadre?`<span class="badge" style="background:${cadreBg[u.cadre]||'#eee'};color:${cadreColor[u.cadre]||'#333'}">${cadreLabel[u.cadre]||'?'}</span>`:'—'}</td>
      <td style="font-size:12.5px">${escHtml(u.institution||'—')}</td>
      <td style="font-size:12px;color:var(--text-m)">${fmtDate(u.joined_at||u.joined)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="toggleUserRole('${u.id}')">Toggle Role</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function toggleUserRole(uid) {
  try {
    const data = await apiPost('users.php',{action:'toggle_role', user_id:uid});
    toast(`Role changed to ${data.new_role}`);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

async function buildAdminExams() {
  const data  = await apiGet('exams.php',{action:'list'});
  const exams = data.exams||[];
  const now   = Date.now();
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Exam Title</th><th>Cadre</th><th>Start Time</th><th>Duration</th><th>Registered</th><th>Status</th></tr></thead>
    <tbody>${exams.map(e=>{
      const s=new Date(e.start_time).getTime(), en=new Date(e.end_time).getTime();
      const status = s<=now&&en>=now?'<span class="badge badge-live">Live</span>':en<now?'<span class="badge badge-gray">Ended</span>':'<span class="badge badge-info">Upcoming</span>';
      return `<tr>
        <td><strong>${escHtml(e.title)}</strong></td>
        <td><span class="badge badge-accent">${escHtml(e.cadre||'')}</span></td>
        <td style="font-size:12px">${fmtDT(e.start_time)}</td>
        <td>${e.duration_minutes} min</td>
        <td>${e.registered_count||0}</td>
        <td>${status}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

async function buildAdminResults(el) {
  const data = await apiGet('exams.php',{action:'list'});
  const past = (data.exams||[]).filter(e=>new Date(e.end_time)<Date.now());
  if(!past.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📊</div><div class="empty-msg">No completed exams yet</div></div>`;return;}
  el.innerHTML=`<div class="alert alert-info">Click "Release Results" to make scores visible to students.</div>`;
  for(const e of past){
    const res  = await apiGet('exams.php',{action:'results', exam_id:e.id});
    const atts = res.attempts||[];
    const qN   = e.question_count||1;
    const avg  = atts.length?Math.round(atts.reduce((s,a)=>s+parseInt(a.score),0)/atts.length):0;
    const pass = atts.length?Math.round(atts.filter(a=>a.score/qN>=.5).length/atts.length*100):0;
    const rel  = e.result_release_time&&new Date(e.result_release_time)<=Date.now();
    const card = document.createElement('div');
    card.className='card'; card.style.marginBottom='12px';
    card.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-weight:800;font-size:15px">${escHtml(e.title)}</div>
          <div style="font-size:12px;color:var(--text-m);margin-top:4px">${atts.length} submissions · Avg: ${avg}/${qN} · Pass rate: ${pass}%</div>
        </div>
        ${rel?`<span class="badge badge-success">✅ Results Released</span>`:`<button class="btn btn-primary btn-sm" onclick="releaseResults('${e.id}')">Release Results</button>`}
      </div>
      ${atts.length?`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px">
        ${[['Submitted',atts.length],[`Avg`,`${avg}/${qN}`],['Pass Rate',`${pass}%`],
           ['Highest',Math.max(...atts.map(a=>+a.score))],['Lowest',Math.min(...atts.map(a=>+a.score))]].map(([l,v])=>
          `<div style="background:var(--surface);border-radius:var(--r);padding:10px 12px">
            <div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--primary)">${v}</div>
            <div style="font-size:10.5px;color:var(--text-m);margin-top:2px">${l}</div>
          </div>`).join('')}
      </div>`:''}`;
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
    toast(data.matric_no?`User "${name}" added — Matric: ${data.matric_no}`:`User "${name}" added!`, 5000);
    renderAdminTab();
  } catch(e) { toast(e.message); }
}

function openCreateExamModal() {
  openModal(`<div class="modal-hdr"><div class="modal-hdr-title">Create New Exam</div><button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="lbl">Exam Title</label><input class="inp" id="ce-title" placeholder="e.g. HIM Foundation Exam 2025"></div>
      <div class="form-group"><label class="lbl">Cadre</label>
        <select class="inp" id="ce-cadre"><option>Professional Diploma</option><option>National Diploma (ND)</option><option>HND/BSc</option></select>
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
    const toISO = v => v ? new Date(v).toISOString().replace('T',' ').slice(0,19) : '';
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

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.getElementById('modal-bg').style.display!=='none') closeModal();
});

// Check for existing PHP session on page load
(async()=>{
  try {
    const data = await apiPost('auth.php',{action:'me'});
    if(data.user) loginUser(data.user);
  } catch(e) {
    // No active session — auth screen stays visible (default HTML state)
  }
})();

// Refresh exam list every 30 s while on exams page
setInterval(()=>{ if(state.page==='exams') renderExams(); }, 30000);
