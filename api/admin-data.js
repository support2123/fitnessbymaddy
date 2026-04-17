const { getSupabase } = require("./lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();
    const token = authHeader.replace("Bearer ", "");

    const { data: user, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      programsWeek,
      recentLeads,
      escalations,
    ] = await Promise.all([
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
      db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", weekStart),
      db.from("leads").select("id", { count: "exact", head: true }),
      db.from("leads").select("id", { count: "exact", head: true }).eq("status", "converted"),
      db.from("clients").select("*").eq("status", "active"),
      db.from("programs").select("id", { count: "exact", head: true }).gte("generated_at", weekStart),
      db.from("leads").select("*").order("created_at", { ascending: false }).limit(10),
      db.from("messages").select("*").eq("direction", "in").ilike("body", "%escalat%").order("sent_at", { ascending: false }).limit(5),
    ]);

    const clients = (activeClients.data || []).map((c) => ({
      ...c,
      current_week: getClientWeek(c),
    }));

    const pendingCheckins = [];
    for (const client of clients) {
      const weekNo = client.current_week;
      const { data: checkin } = await db
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .single();

      if (!checkin) {
        pendingCheckins.push({ name: client.name, week: weekNo, client_id: client.id });
      }
    }

    const programCounts = {};
    for (const c of clients) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
    const breakdown = Object.entries(programCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const escalationMessages = await getEscalationMessages(db);

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: rate,
      active_clients: clients.length,
      program_breakdown: breakdown,
      programs_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      pending_checkins: pendingCheckins,
      clients,
      escalations: escalationMessages,
    });
  } catch (err) {
    console.error("Admin data error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function getClientWeek(client) {
  if (!client.program_started_at) return 1;
  const start = new Date(client.program_started_at);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

async function getEscalationMessages(db) {
  const keywords = ["refund", "lawyer", "complaint", "pain", "injury", "side effect"];
  const { data } = await db
    .from("messages")
    .select("*")
    .eq("direction", "in")
    .order("sent_at", { ascending: false })
    .limit(100);

  if (!data) return [];

  return data
    .filter((m) => keywords.some((kw) => m.body.toLowerCase().includes(kw)))
    .slice(0, 10)
    .map((m) => ({
      phone: m.phone,
      body: m.body.slice(0, 120),
      sent_at: m.sent_at,
    }));
}
