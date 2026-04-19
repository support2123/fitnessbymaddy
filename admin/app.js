/* Admin Dashboard — Fitness by Maddy */

(function () {
  var SUPABASE_URL = '';
  var SUPABASE_ANON_KEY = '';

  var configEl = document.querySelector('meta[name="supabase-url"]');
  if (configEl) SUPABASE_URL = configEl.content;
  var configKey = document.querySelector('meta[name="supabase-anon-key"]');
  if (configKey) SUPABASE_ANON_KEY = configKey.content;

  if (!SUPABASE_URL) SUPABASE_URL = window.__SUPABASE_URL__ || '';
  if (!SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase credentials not configured. Set meta tags or window globals.');
  }

  var sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  var loginPage = document.getElementById('loginPage');
  var dashboard = document.getElementById('dashboard');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var logoutBtn = document.getElementById('logoutBtn');

  function maskPhone(p) {
    if (!p || p.length < 6) return '***';
    return p.slice(0, 4) + '***' + p.slice(-3);
  }

  function badge(status) {
    var cls = 'badge-' + (status || 'new');
    return '<span class="badge ' + cls + '">' + (status || 'unknown') + '</span>';
  }

  function shortDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  function shortTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function truncate(s, n) {
    if (!s) return '-';
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  async function checkSession() {
    if (!sb) return showLogin();
    var { data } = await sb.auth.getSession();
    if (data.session) {
      showDashboard();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    loginPage.style.display = 'flex';
    dashboard.classList.remove('active');
  }

  function showDashboard() {
    loginPage.style.display = 'none';
    dashboard.classList.add('active');
    loadMetrics();
    loadTab('leads');
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    loginError.style.display = 'none';
    if (!sb) {
      loginError.textContent = 'Database not configured';
      loginError.style.display = 'block';
      return;
    }
    var email = document.getElementById('loginEmail').value;
    var password = document.getElementById('loginPassword').value;
    var { error } = await sb.auth.signInWithPassword({ email: email, password: password });
    if (error) {
      loginError.textContent = error.message;
      loginError.style.display = 'block';
    } else {
      showDashboard();
    }
  });

  logoutBtn.addEventListener('click', async function () {
    if (sb) await sb.auth.signOut();
    showLogin();
  });

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      tab.classList.add('active');
      var target = tab.getAttribute('data-tab');
      document.getElementById('tab-' + target).classList.add('active');
      loadTab(target);
    });
  });

  async function loadMetrics() {
    if (!sb) return;
    var grid = document.getElementById('metricsGrid');

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    var [leadsToday, leadsWeek, allLeads, activeClients, pendingCheckins, programs] = await Promise.all([
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      sb.from('leads').select('id, status', { count: 'exact' }),
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('checkins').select('id', { count: 'exact', head: true }).gte('form_submitted_at', weekAgo.toISOString()),
      sb.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekAgo.toISOString()),
    ]);

    var converted = allLeads.data ? allLeads.data.filter(function (l) { return l.status === 'converted'; }).length : 0;
    var totalLeads = allLeads.count || 0;
    var convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

    grid.innerHTML =
      metricCard('Leads Today', leadsToday.count || 0, 'This week: ' + (leadsWeek.count || 0)) +
      metricCard('Conversion Rate', convRate + '%', converted + ' of ' + totalLeads + ' leads') +
      metricCard('Active Clients', activeClients.count || 0, '') +
      metricCard('Programs This Week', programs.count || 0, 'Check-ins: ' + (pendingCheckins.count || 0));
  }

  function metricCard(label, value, sub) {
    return '<div class="metric-card"><div class="metric-label">' + label + '</div><div class="metric-value">' + value + '</div><div class="metric-sub">' + sub + '</div></div>';
  }

  async function loadTab(tab) {
    if (!sb) return;
    switch (tab) {
      case 'leads': return loadLeads();
      case 'clients': return loadClients();
      case 'checkins': return loadCheckins();
      case 'programs': return loadPrograms();
      case 'messages': return loadMessages();
    }
  }

  async function loadLeads() {
    var { data } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(100);
    var tbody = document.querySelector('#leadsTable tbody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No leads yet</p></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function (l) {
      return '<tr><td>' + maskPhone(l.phone) + '</td><td>' + (l.name || '-') + '</td><td>' + (l.source || '-') + '</td><td>' + (l.program_interest || '-') + '</td><td>' + (l.market || '-') + '</td><td>' + badge(l.status) + '</td><td>' + shortDate(l.created_at) + '</td></tr>';
    }).join('');
  }

  async function loadClients() {
    var { data } = await sb.from('clients').select('*').order('created_at', { ascending: false }).limit(100);
    var tbody = document.querySelector('#clientsTable tbody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No clients yet</p></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function (c) {
      return '<tr><td>' + (c.name || maskPhone(c.phone)) + '</td><td>' + (c.program || '-') + '</td><td>' + shortDate(c.program_started_at) + '</td><td>' + shortDate(c.program_ends_at) + '</td><td>$' + (c.paid_amount || 0) + '</td><td>' + badge(c.status) + '</td></tr>';
    }).join('');
  }

  async function loadCheckins() {
    var { data } = await sb.from('checkins').select('*, clients(name, phone)').order('form_submitted_at', { ascending: false }).limit(100);
    var tbody = document.querySelector('#checkinsTable tbody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>No check-ins yet</p></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function (ci) {
      var clientName = ci.clients ? (ci.clients.name || maskPhone(ci.clients.phone)) : '-';
      return '<tr><td>' + clientName + '</td><td>' + ci.week_no + '</td><td>' + (ci.weight || '-') + 'kg</td><td>' + (ci.compliance_score || '-') + '/10</td><td>' + (ci.energy || '-') + '/10</td><td>' + truncate(ci.issues, 40) + '</td><td>' + shortTime(ci.form_submitted_at) + '</td></tr>';
    }).join('');
  }

  async function loadPrograms() {
    var { data } = await sb.from('programs').select('*, clients(name, phone)').order('generated_at', { ascending: false }).limit(100);
    var tbody = document.querySelector('#programsTable tbody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>No programs generated yet</p></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function (p) {
      var clientName = p.clients ? (p.clients.name || maskPhone(p.clients.phone)) : '-';
      var pdfLink = p.pdf_url ? '<a href="' + p.pdf_url + '" target="_blank" style="color:var(--gold)">Download</a>' : '-';
      return '<tr><td>' + clientName + '</td><td>Week ' + p.week_no + '</td><td>' + shortTime(p.generated_at) + '</td><td>' + (p.whatsapp_sent_at ? shortTime(p.whatsapp_sent_at) : 'Not sent') + '</td><td>' + pdfLink + '</td></tr>';
    }).join('');
  }

  async function loadMessages() {
    var { data } = await sb.from('messages').select('*').order('sent_at', { ascending: false }).limit(200);
    var tbody = document.querySelector('#messagesTable tbody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No messages yet</p></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function (m) {
      var dir = m.direction === 'in' ? '<span style="color:var(--blue)">IN</span>' : '<span style="color:var(--green)">OUT</span>';
      return '<tr><td>' + maskPhone(m.phone) + '</td><td>' + dir + '</td><td>' + truncate(m.body, 60) + '</td><td>' + (m.template_name || '-') + '</td><td>' + (m.status || '-') + '</td><td>' + shortTime(m.sent_at) + '</td></tr>';
    }).join('');
  }

  checkSession();
})();
