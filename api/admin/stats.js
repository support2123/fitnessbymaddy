const { createClient } = require("@supabase/supabase-js");

// Service-role client — bypasses RLS
let _supa;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supa;
}

// Anon client for verifying the admin session token
let _anonClient;
function anonClient() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return _anonClient;
}

// Allowed admin emails
const ADMIN_EMAILS = ["support@fitnessbymaddy.com"];

function maskPhone(phone) {
  if (!phone) return "";
  if (phone.length <= 6) return "***" + phone.slice(-2);
  return phone.slice(0, 3) + "***" + phone.slice(-3);
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ---- Auth check ----
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  // Check admin token shortcut (for cron / internal calls)
  if (token === process.env.ADMIN_API_TOKEN && process.env.ADMIN_API_TOKEN) {
    // trusted — skip Supabase session verification
  } else {
    // Verify the JWT via Supabase
    const { data: { user }, error } = await anonClient().auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    if (!ADMIN_EMAILS.includes(user.email)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  try {
    const db = supa();
    const now = new Date();

    // Start of today (UTC)
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    // Start of this week (Monday)
    const dayOfWeek = now.getUTCDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset)
    ).toISOString();

    // ---- Parallel queries ----
    const [
      leadsToday,
      leadsThisWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      programsThisWeek,
      pendingCheckins,
      recentLeads,
      activeClientsList,
      escalations,
      recentMessages,
    ] = await Promise.all([
      // 0 – leads today
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart),

      // 1 – leads this week
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekStart),

      // 2 – total leads (for conversion rate)
      db
        .from("leads")
        .select("id", { count: "exact", head: true }),

      // 3 – converted leads
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "converted"),

      // 4 – active clients count
      db
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),

      // 5 – programs generated this week
      db
        .from("programs")
        .select("id", { count: "exact", head: true })
        .gte("generated_at", weekStart),

      // 6 – pending check-ins: active clients whose current week has no checkin
      db.rpc("get_pending_checkins").catch(() =>
        // Fallback: fetch active clients and their latest checkin
        db
          .from("clients")
          .select("id, name, phone, program, program_started_at, status")
          .eq("status", "active")
      ),

      // 7 – recent leads (last 20)
      db
        .from("leads")
        .select("id, name, phone, status, program_interest, market, created_at")
        .order("created_at", { ascending: false })
        .limit(20),

      // 8 – active clients list
      db
        .from("clients")
        .select(
          "id, name, phone, program, program_started_at, status, created_at"
        )
        .eq("status", "active")
        .order("program_started_at", { ascending: false }),

      // 9 – escalations: flagged programs + any escalation messages
      db
        .from("programs")
        .select(
          "id, client_id, week_no, notes, generated_at, clients(name, phone)"
        )
        .eq("flagged_for_review", true)
        .order("generated_at", { ascending: false })
        .limit(20),

      // 10 – recent messages (last 50)
      db
        .from("messages")
        .select("id, phone, direction, body, template_name, sent_at, status")
        .order("sent_at", { ascending: false })
        .limit(50),
    ]);

    // ---- Compute pending check-ins ----
    let pendingList = [];
    if (pendingCheckins.data && Array.isArray(pendingCheckins.data)) {
      // If the RPC exists it returns the list directly.
      // Otherwise we compute from the active clients list.
      if (pendingCheckins.data.length && pendingCheckins.data[0].week_no !== undefined) {
        pendingList = pendingCheckins.data;
      } else {
        // For each active client figure out their current week number
        const clients = pendingCheckins.data;
        const clientIds = clients.map((c) => c.id);

        if (clientIds.length > 0) {
          // Get latest checkin per client
          const { data: latestCheckins } = await db
            .from("checkins")
            .select("client_id, week_no")
            .in("client_id", clientIds)
            .order("week_no", { ascending: false });

          const latestByClient = {};
          if (latestCheckins) {
            for (const ci of latestCheckins) {
              if (!latestByClient[ci.client_id]) {
                latestByClient[ci.client_id] = ci.week_no;
              }
            }
          }

          for (const c of clients) {
            const startDate = new Date(c.program_started_at);
            const diffMs = now - startDate;
            const currentWeek = Math.max(
              1,
              Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000))
            );
            const lastCheckin = latestByClient[c.id] || 0;

            if (lastCheckin < currentWeek) {
              pendingList.push({
                client_id: c.id,
                name: c.name,
                phone: maskPhone(c.phone),
                program: c.program,
                current_week: currentWeek,
                last_checkin_week: lastCheckin,
              });
            }
          }
        }
      }
    }

    // ---- Build active clients with week info ----
    let activeList = [];
    if (activeClientsList.data) {
      const clientIds = activeClientsList.data.map((c) => c.id);
      let latestCheckinMap = {};

      if (clientIds.length > 0) {
        const { data: allCheckins } = await db
          .from("checkins")
          .select("client_id, week_no, form_submitted_at")
          .in("client_id", clientIds)
          .order("week_no", { ascending: false });

        if (allCheckins) {
          for (const ci of allCheckins) {
            if (!latestCheckinMap[ci.client_id]) {
              latestCheckinMap[ci.client_id] = ci;
            }
          }
        }
      }

      activeList = activeClientsList.data.map((c) => {
        const startDate = new Date(c.program_started_at);
        const diffMs = now - startDate;
        const currentWeek = Math.max(
          1,
          Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000))
        );
        const lastCi = latestCheckinMap[c.id];

        return {
          id: c.id,
          name: c.name,
          phone: maskPhone(c.phone),
          program: c.program,
          current_week: currentWeek,
          last_checkin: lastCi
            ? {
                week_no: lastCi.week_no,
                submitted_at: lastCi.form_submitted_at,
              }
            : null,
          status: c.status,
        };
      });
    }

    // ---- Conversion rate ----
    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate =
      total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;

    // ---- Escalations ----
    let escalationList = [];
    if (escalations.data) {
      escalationList = escalations.data.map((e) => ({
        id: e.id,
        client_name: e.clients?.name || "Unknown",
        client_phone: maskPhone(e.clients?.phone),
        week_no: e.week_no,
        notes: e.notes,
        generated_at: e.generated_at,
      }));
    }

    // ---- Messages (masked) ----
    let messageList = [];
    if (recentMessages.data) {
      messageList = recentMessages.data.map((m) => ({
        id: m.id,
        phone: maskPhone(m.phone),
        direction: m.direction,
        body_preview:
          m.body && m.body.length > 120
            ? m.body.substring(0, 120) + "..."
            : m.body,
        template_name: m.template_name,
        sent_at: m.sent_at,
        status: m.status,
      }));
    }

    // ---- Recent leads (masked) ----
    let leadList = [];
    if (recentLeads.data) {
      leadList = recentLeads.data.map((l) => ({
        id: l.id,
        name: l.name,
        phone: maskPhone(l.phone),
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      }));
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      programs_this_week: programsThisWeek.count || 0,
      pending_checkins: pendingList,
      recent_leads: leadList,
      active_clients_list: activeList,
      escalations: escalationList,
      recent_messages: messageList,
      fetched_at: now.toISOString(),
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
