const supabase = require("../lib/supabase");
const { maskPhone } = require("../lib/helpers");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple auth check
  const auth = req.headers["authorization"];
  if (!auth || auth !== "Bearer valid") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // --- Leads today ---
    const { count: leadsToday } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());

    // --- Leads this week ---
    const { count: leadsWeek } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString());

    // --- Conversion rate ---
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true });

    const { count: convertedLeads } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "converted");

    const conversionRate =
      totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    // --- Active clients ---
    const { count: activeClients } = await supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    // --- Pending check-ins ---
    // Clients who are active but haven't submitted a check-in this week
    const { data: activeClientsList } = await supabase
      .from("clients")
      .select("id, phone, name, program, program_started_at, status")
      .eq("status", "active");

    let pendingCheckins = 0;
    const clientsWithCheckinInfo = [];

    for (const client of activeClientsList || []) {
      const startedAt = new Date(client.program_started_at);
      const msElapsed = now.getTime() - startedAt.getTime();
      const weekNo = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .maybeSingle();

      if (!checkin) {
        pendingCheckins++;
      }

      // Calculate next check-in due (next Sunday)
      const nextSunday = new Date(now);
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
      nextSunday.setDate(now.getDate() + daysUntilSunday);
      const nextCheckinDue = nextSunday.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      clientsWithCheckinInfo.push({
        id: client.id,
        name: client.name || "Unknown",
        program: client.program,
        program_started_at: client.program_started_at,
        status: client.status,
        current_week: weekNo,
        checkin_submitted: !!checkin,
        next_checkin_due: checkin ? "Submitted" : "Week " + weekNo + " — due " + nextCheckinDue,
      });
    }

    // --- Programs generated this week ---
    const { count: programsThisWeek } = await supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString());

    // --- Recent leads (last 20) ---
    const { data: recentLeads } = await supabase
      .from("leads")
      .select("id, name, phone, status, program_interest, market, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    // Mask phone numbers for display
    const maskedLeads = (recentLeads || []).map((lead) => ({
      ...lead,
      phone_masked: maskPhone(lead.phone),
      phone: undefined,
    }));

    // --- Escalations ---
    const { data: escalations } = await supabase
      .from("messages")
      .select("id, phone, body, created_at, template_name")
      .or("template_name.ilike.%escalation%,body.ilike.%ESCALATION ALERT%")
      .order("created_at", { ascending: false })
      .limit(20);

    const maskedEscalations = (escalations || []).map((msg) => ({
      ...msg,
      phone_masked: maskPhone(msg.phone),
      phone: undefined,
    }));

    console.log("[admin-data] Dashboard data loaded successfully");

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek || 0,
      recent_leads: maskedLeads,
      active_clients_list: clientsWithCheckinInfo,
      escalations: maskedEscalations,
    });
  } catch (err) {
    console.error("[admin-data] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
