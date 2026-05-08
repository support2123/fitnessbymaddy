const { getSupabase } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
    ] = await Promise.all([
      db.from("leads").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      db.from("leads").select("*", { count: "exact", head: true }).gte("created_at", weekStart),
      db.from("leads").select("*", { count: "exact", head: true }),
      db.from("leads").select("*", { count: "exact", head: true }).eq("status", "converted"),
      db.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
      db.from("clients").select("program").eq("status", "active"),
      getPendingCheckins(db),
      db.from("programs").select("*", { count: "exact", head: true }).gte("generated_at", weekStart),
      db.from("messages").select("phone, body, sent_at")
        .eq("template_name", "escalation_alert")
        .order("sent_at", { ascending: false })
        .limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0.0";

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: total,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map((e) => ({
        phone: e.phone ? e.phone.slice(0, 4) + "XXX..." + e.phone.slice(-3) : "***",
        body: e.body,
        time: e.sent_at,
      })),
    });
  } catch (err) {
    console.error("Admin stats error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function getPendingCheckins(db) {
  const { data: activeClients } = await db
    .from("clients")
    .select("id, phone, name, program_started_at")
    .eq("status", "active");

  if (!activeClients) return 0;

  const now = new Date();
  let pending = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: checkin } = await db
      .from("checkins")
      .select("id")
      .eq("client_id", client.id)
      .eq("week_no", currentWeek)
      .single();

    if (!checkin) pending++;
  }

  return pending;
}
