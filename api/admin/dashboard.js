const { supabase } = require("../../lib/supabase");
const { maskPhone } = require("../../lib/utils");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── Auth check ───────────────────────────────────────────────
    const password = req.query.password;

    if (!password || !ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();

    // ── Date boundaries ──────────────────────────────────────────
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekISO = weekStart.toISOString();

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysISO = sevenDaysAgo.toISOString();

    // ── 1. Leads today count ─────────────────────────────────────
    const { count: leadsToday } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayISO);

    // ── 2. Leads this week count ─────────────────────────────────
    const { count: leadsThisWeek } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekISO);

    // ── 3. Conversion rate ───────────────────────────────────────
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true });

    const { count: convertedLeads } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "converted");

    const conversionRate =
      totalLeads > 0
        ? Math.round((convertedLeads / totalLeads) * 1000) / 10
        : 0;

    // ── 4. Active clients count ──────────────────────────────────
    const { count: activeClientsCount } = await supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    // ── 5. Recent leads (last 20) ────────────────────────────────
    const { data: recentLeadsRaw } = await supabase
      .from("leads")
      .select("id, name, phone, source, status, program_interest, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const recentLeads = (recentLeadsRaw || []).map((lead) => ({
      ...lead,
      phone: maskPhone(lead.phone),
    }));

    // ── 6. Active clients list with current week ─────────────────
    const { data: activeClientsRaw } = await supabase
      .from("clients")
      .select(
        "id, name, program, program_started_at, program_ends_at, status, phone"
      )
      .eq("status", "active")
      .order("program_started_at", { ascending: true });

    // For each active client, get last check-in and compute current week
    const activeClientsList = [];
    for (const client of activeClientsRaw || []) {
      const startDate = new Date(client.program_started_at);
      const diffMs = now.getTime() - startDate.getTime();
      const currentWeek = Math.max(
        1,
        Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000))
      );

      // Get the most recent check-in
      const { data: lastCheckinArr } = await supabase
        .from("checkins")
        .select("submitted_at")
        .eq("client_id", client.id)
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(1);

      const lastCheckin =
        lastCheckinArr && lastCheckinArr.length > 0
          ? lastCheckinArr[0].submitted_at
          : null;

      activeClientsList.push({
        id: client.id,
        name: client.name,
        program: client.program,
        current_week: currentWeek,
        last_checkin: lastCheckin,
        program_ends_at: client.program_ends_at,
        status: client.status,
      });
    }

    // ── 7. Pending check-ins (clients who haven't checked in this week)
    const pendingCheckins = [];
    for (const client of activeClientsList) {
      // Only consider clients whose program is still running
      if (new Date(client.program_ends_at) < now) continue;

      const { data: thisWeekCheckin } = await supabase
        .from("checkins")
        .select("id, submitted_at")
        .eq("client_id", client.id)
        .eq("week_no", client.current_week)
        .not("submitted_at", "is", null)
        .limit(1);

      if (!thisWeekCheckin || thisWeekCheckin.length === 0) {
        pendingCheckins.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          current_week: client.current_week,
          last_checkin: client.last_checkin,
        });
      }
    }

    // ── 8. Escalation messages (last 7 days) ─────────────────────
    const { data: escalationMessagesRaw } = await supabase
      .from("messages")
      .select("id, phone, body, sent_at")
      .eq("direction", "in")
      .gte("sent_at", sevenDaysISO)
      .order("sent_at", { ascending: false })
      .limit(200);

    // Filter for escalation keywords in-app since Supabase doesn't
    // support complex LIKE-OR queries easily
    const escalationKeywords = [
      "injury",
      "medical",
      "pregnancy",
      "medication",
      "pain",
      "dizziness",
      "eating disorder",
      "refund",
      "lawyer",
      "complaint",
      "didn't work",
      "side effect",
    ];

    const escalations = (escalationMessagesRaw || [])
      .filter((msg) => {
        if (!msg.body) return false;
        const lower = msg.body.toLowerCase();
        return escalationKeywords.some((kw) => lower.includes(kw));
      })
      .map((msg) => ({
        id: msg.id,
        phone: maskPhone(msg.phone),
        excerpt: msg.body.length > 120 ? msg.body.slice(0, 120) + "..." : msg.body,
        sent_at: msg.sent_at,
      }));

    // ── 9. Programs generated this week ──────────────────────────
    const { data: programsRaw } = await supabase
      .from("programs")
      .select("id, client_id, week_no, generated_at, status")
      .gte("generated_at", weekISO)
      .order("generated_at", { ascending: false });

    // Enrich with client name and check if WhatsApp was sent
    const programsThisWeek = [];
    for (const prog of programsRaw || []) {
      // Get client name
      const { data: client } = await supabase
        .from("clients")
        .select("name, phone")
        .eq("id", prog.client_id)
        .single();

      // Check if a WhatsApp message was sent for this program
      const { data: whatsappMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("direction", "out")
        .eq("phone", client ? client.phone : "")
        .gte("sent_at", prog.generated_at)
        .limit(1);

      programsThisWeek.push({
        id: prog.id,
        client_name: client ? client.name : "Unknown",
        week_no: prog.week_no,
        generated_at: prog.generated_at,
        sent_via_whatsapp: whatsappMsg && whatsappMsg.length > 0,
        status: prog.status,
      });
    }

    // ── Response ─────────────────────────────────────────────────
    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_this_week: leadsThisWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClientsCount || 0,
      recent_leads: recentLeads,
      active_clients_list: activeClientsList,
      pending_checkins: pendingCheckins,
      escalations,
      programs_this_week: programsThisWeek,
    });
  } catch (err) {
    console.error("[admin/dashboard] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
