// Admin dashboard — reads-only view onto Supabase (RLS enforces that
// only authenticated users see data; resolve-escalation updates go
// through the same authed client).

// Config is injected at build time via /admin/config.js (git-ignored in prod).
// For local dev, set these two values and commit a non-secret anon key.
const CONFIG_URL = '/admin/config.js';

let supabase = null;

async function loadConfig() {
  try {
    const mod = await import(CONFIG_URL);
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(mod.SUPABASE_URL, mod.SUPABASE_ANON_KEY);
    return true;
  } catch (e) {
    console.error('config load failed', e);
    document.getElementById('login-err').textContent =
      'Admin config missing. Set /admin/config.js with SUPABASE_URL + SUPABASE_ANON_KEY.';
    return false;
  }
}

// ─── auth bootstrap ─────────────────────────────────────────
const loginEl = document.getElementById('login');
const appEl   = document.getElementById('app');

async function boot() {
  if (!(await loadConfig())) return show(loginEl);
  const { data } = await supabase.auth.getSession();
  if (data.session) { show(appEl); await loadAll(); }
  else              { show(loginEl); }
}

document.getElementById('sign-in').addEventListener('click', async () => {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const err      = document.getElementById('login-err');
  err.textContent = '';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { err.textContent = error.message; return; }
  show(appEl); loadAll();
});

document.getElementById('sign-out').addEventListener('click', async () => {
  await supabase.auth.signOut();
  show(loginEl);
});

function show(el) {
  loginEl.style.display = el === loginEl ? 'block' : 'none';
  appEl.style.display   = el === appEl   ? 'block' : 'none';
}

// ─── data loaders ───────────────────────────────────────────
async function loadAll() {
  const now = new Date();
  document.getElementById('meta-line').textContent =
    now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();

  await Promise.all([
    loadKpis(), loadEscalations(), loadLeads(),
    loadClients(), loadCheckins(), loadPrograms(),
  ]);
}

async function loadKpis() {
  const { data } = await supabase.from('dashboard_kpis').select('*').single();
  const k = data || {};
  const grid = document.getElementById('kpi-grid');
  grid.innerHTML = [
    kpi('Leads today',    k.leads_today),
    kpi('Leads / 7 days', k.leads_7d),
    kpi('Active clients', k.active_clients),
    kpi('Conversion 30d', (k.conversion_pct_30d ?? 0) + '%'),
    kpi('Pending check-ins', k.pending_checkins),
    kpi('Programs / 7 days', k.programs_7d),
    kpi('Open escalations', k.open_escalations, k.open_escalations > 0 ? 'alert' : ''),
  ].join('');
}
function kpi(label, val, mod='') {
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-val">${val ?? '—'}</div>
  </div>`;
}

async function loadEscalations() {
  const { data } = await supabase.from('escalations')
    .select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20);
  const body = document.getElementById('esc-body');
  if (!data || !data.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">Nothing pending — all clear.</td></tr>`;
    return;
  }
  body.innerHTML = data.map(e => `
    <tr>
      <td class="muted">${relTime(e.created_at)}</td>
      <td><span class="pill flagged">${escapeHtml(e.reason)}</span></td>
      <td>${escapeHtml(maskPhone(e.phone))}</td>
      <td class="muted">${escapeHtml(e.payload?.snippet?.slice(0,120) || '')}</td>
      <td><button class="btn-resolve" data-id="${e.id}">Resolve</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('button[data-id]').forEach(b => {
    b.addEventListener('click', async () => {
      await supabase.from('escalations')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', b.dataset.id);
      loadEscalations(); loadKpis();
    });
  });
}

async function loadLeads() {
  const { data } = await supabase.from('leads')
    .select('*').order('created_at', { ascending: false }).limit(20);
  const body = document.getElementById('leads-body');
  body.innerHTML = (data || []).map(l => `
    <tr>
      <td class="muted">${relTime(l.created_at)}</td>
      <td>${escapeHtml(maskPhone(l.phone))}</td>
      <td>${escapeHtml(l.market || '')}</td>
      <td><span class="pill ${l.status}">${l.status}</span></td>
      <td class="muted">${escapeHtml(l.program_interest || '')}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">No leads yet.</td></tr>`;
}

async function loadClients() {
  const { data } = await supabase.from('clients')
    .select('*').eq('status', 'active').order('program_started_at', { ascending: false }).limit(30);
  const body = document.getElementById('clients-body');
  body.innerHTML = (data || []).map(c => `
    <tr>
      <td>${escapeHtml(c.name || maskPhone(c.phone))}</td>
      <td>${escapeHtml(c.program)}</td>
      <td class="muted">${fmt(c.program_started_at)}</td>
      <td class="muted">${fmt(c.program_ends_at)}</td>
      <td><span class="pill active">${c.status}</span></td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">No active clients.</td></tr>`;
}

async function loadCheckins() {
  const { data } = await supabase.from('checkins')
    .select('*, clients(name, phone)')
    .is('form_submitted_at', null).not('form_sent_at', 'is', null)
    .order('form_sent_at', { ascending: false }).limit(25);
  const body = document.getElementById('checkins-body');
  body.innerHTML = (data || []).map(c => `
    <tr>
      <td>${escapeHtml(c.clients?.name || maskPhone(c.clients?.phone || ''))}</td>
      <td>Week ${c.week_no}</td>
      <td class="muted">${relTime(c.form_sent_at)}</td>
      <td>${c.nudge_count || 0}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="empty">Nothing pending.</td></tr>`;
}

async function loadPrograms() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('programs')
    .select('*, clients(name, phone)').gte('generated_at', since)
    .order('generated_at', { ascending: false }).limit(40);
  const body = document.getElementById('programs-body');
  body.innerHTML = (data || []).map(p => `
    <tr>
      <td>${escapeHtml(p.clients?.name || maskPhone(p.clients?.phone || ''))}</td>
      <td>Week ${p.week_no}</td>
      <td class="muted">${relTime(p.generated_at)}</td>
      <td class="muted">${p.whatsapp_sent_at ? relTime(p.whatsapp_sent_at) : '—'}</td>
      <td>${p.flagged_for_review
        ? `<span class="pill flagged">${escapeHtml(p.flag_reason || 'flagged')}</span>`
        : `<span class="pill converted">sent</span>`}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">No programs yet.</td></tr>`;
}

// ─── tiny utils ────────────────────────────────────────────
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]); }
function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  return s.length < 7 ? s.replace(/\d/g,'X') : s.slice(0,3) + 'XXX...' + s.slice(-3);
}
function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600)  return Math.round(diff/60) + 'm';
  if (diff < 86400) return Math.round(diff/3600) + 'h';
  return Math.round(diff/86400) + 'd';
}

boot();
