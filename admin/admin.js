var SUPABASE_URL = '';
var SUPABASE_ANON_KEY = '';
var supabase = null;

(function() {
  var loginScreen = document.getElementById('loginScreen');
  var dashboard = document.getElementById('dashboard');

  SUPABASE_URL = document.querySelector('meta[name="supabase-url"]')?.content || '';
  SUPABASE_ANON_KEY = document.querySelector('meta[name="supabase-anon-key"]')?.content || '';

  function initSupabase(url, key) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.onload = function() {
      supabase = window.supabase.createClient(url || SUPABASE_URL, key || SUPABASE_ANON_KEY);
      checkSession();
    };
    document.head.appendChild(script);
  }

  function checkSession() {
    supabase.auth.getSession().then(function(result) {
      if (result.data.session) {
        showDashboard();
      }
    });
  }

  document.getElementById('loginBtn').addEventListener('click', function() {
    var email = document.getElementById('loginEmail').value;
    var password = document.getElementById('loginPassword').value;
    if (!email || !password) return;

    this.textContent = 'Signing in...';
    this.disabled = true;

    supabase.auth.signInWithPassword({ email: email, password: password })
      .then(function(result) {
        if (result.error) {
          alert('Login failed: ' + result.error.message);
          document.getElementById('loginBtn').textContent = 'Sign In';
          document.getElementById('loginBtn').disabled = false;
          return;
        }
        showDashboard();
      });
  });

  document.getElementById('logoutBtn').addEventListener('click', function() {
    supabase.auth.signOut().then(function() {
      dashboard.style.display = 'none';
      loginScreen.style.display = 'flex';
    });
  });

  function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    loadStats();
    loadLeads();
    loadClients();
    loadEscalations();
    loadPrograms();
  }

  function maskPhone(phone) {
    if (!phone || phone.length < 6) return '***';
    return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function badge(text) {
    var cls = 'badge badge-' + text.toLowerCase().replace(/[^a-z]/g, '');
    return '<span class="' + cls + '">' + text + '</span>';
  }

  function loadStats() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayISO = today.toISOString();

    var weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    var weekISO = weekAgo.toISOString();

    Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekISO),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('escalations').select('id', { count: 'exact', head: true }).eq('resolved', false),
    ]).then(function(results) {
      document.getElementById('leadsToday').textContent = results[0].count || 0;
      document.getElementById('leadsWeek').textContent = results[1].count || 0;
      document.getElementById('activeClients').textContent = results[2].count || 0;

      var total = results[3].count || 0;
      var converted = results[4].count || 0;
      var rate = total > 0 ? Math.round((converted / total) * 100) : 0;
      document.getElementById('conversionRate').textContent = rate + '%';

      document.getElementById('escalations').textContent = results[5].count || 0;
    });

    supabase.from('clients').select('id').eq('status', 'active').then(function(result) {
      document.getElementById('pendingCheckins').textContent = result.data ? result.data.length : 0;
    });
  }

  function loadLeads() {
    supabase.from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(function(result) {
        var tbody = document.getElementById('leadsTable');
        if (!result.data || result.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No leads yet</td></tr>';
          return;
        }
        tbody.innerHTML = result.data.map(function(lead) {
          return '<tr>' +
            '<td>' + maskPhone(lead.phone) + '</td>' +
            '<td>' + (lead.name || '—') + '</td>' +
            '<td>' + badge(lead.status) + '</td>' +
            '<td>' + (lead.program_interest || '—') + '</td>' +
            '<td>' + (lead.market || '—') + '</td>' +
            '<td>' + formatDate(lead.created_at) + '</td>' +
          '</tr>';
        }).join('');
      });
  }

  function loadClients() {
    supabase.from('clients')
      .select('*')
      .eq('status', 'active')
      .order('program_started_at', { ascending: false })
      .limit(20)
      .then(function(result) {
        var tbody = document.getElementById('clientsTable');
        if (!result.data || result.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active clients</td></tr>';
          return;
        }
        tbody.innerHTML = result.data.map(function(client) {
          var start = new Date(client.program_started_at);
          var weekNo = Math.ceil((Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
          return '<tr>' +
            '<td>' + (client.name || maskPhone(client.phone)) + '</td>' +
            '<td>' + client.program + '</td>' +
            '<td>' + formatDate(client.program_started_at) + '</td>' +
            '<td>Week ' + Math.max(1, weekNo) + '</td>' +
            '<td>' + badge('Active') + '</td>' +
          '</tr>';
        }).join('');
      });
  }

  function loadEscalations() {
    supabase.from('escalations')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(function(result) {
        var tbody = document.getElementById('escalationsTable');
        if (!result.data || result.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No pending escalations</td></tr>';
          return;
        }
        tbody.innerHTML = result.data.map(function(esc) {
          return '<tr>' +
            '<td>' + maskPhone(esc.phone) + '</td>' +
            '<td>' + badge('Escalation') + ' ' + esc.reason + '</td>' +
            '<td>' + (esc.trigger_message ? esc.trigger_message.slice(0, 60) + '...' : '—') + '</td>' +
            '<td>' + formatDate(esc.created_at) + '</td>' +
          '</tr>';
        }).join('');
      });
  }

  function loadPrograms() {
    var weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('programs')
      .select('*, clients(name, phone)')
      .gte('generated_at', weekAgo)
      .order('generated_at', { ascending: false })
      .limit(10)
      .then(function(result) {
        var tbody = document.getElementById('programsTable');
        if (!result.data || result.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No programs generated this week</td></tr>';
          return;
        }
        tbody.innerHTML = result.data.map(function(prog) {
          var clientName = prog.clients ? (prog.clients.name || maskPhone(prog.clients.phone)) : '—';
          return '<tr>' +
            '<td>' + clientName + '</td>' +
            '<td>Week ' + prog.week_no + '</td>' +
            '<td>' + formatDate(prog.generated_at) + '</td>' +
            '<td>' + (prog.whatsapp_sent_at ? formatDate(prog.whatsapp_sent_at) : 'Pending') + '</td>' +
            '<td>' + (prog.pdf_url ? '<a href="' + prog.pdf_url + '" target="_blank" style="color:var(--gold)">View PDF</a>' : '—') + '</td>' +
          '</tr>';
        }).join('');
      });
  }

  initSupabase();
})();
