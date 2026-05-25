const { getSupabase } = require("../_lib/supabase");

// ---- CORS headers ----
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * Mask a phone number to only show the last 4 digits.
 * e.g. "+917082478374" -> "***8374"
 */
function maskPhone(phone) {
  if (!phone) return "***unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***" + digits;
  return "***" + digits.slice(-4);
}

/**
 * Returns the Monday 00:00:00 UTC of the current ISO week.
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff)
  );
  return monday.toISOString();
}

/**
 * Returns today's start in UTC: YYYY-MM-DDT00:00:00.000Z
 */
function getTodayStart() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

/**
 * Calculate the expected week number for an active client
 * based on their program_started_at date.
 */
function currentWeekNo(programStartedAt) {
  if (!programStartedAt) return 1;
  const start = new Date(programStartedAt);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - start.getTime()) / msPerWeek) + 1;
}

module.exports = async (req, res) => {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple auth check via Authorization header
  const authHeader = req.headers.authorization || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminPassword && authHeader !== `Bearer ${adminPassword}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();
    const todayStart = getTodayStart();
    const weekStart = getWeekStart();

    // ── Run all queries in parallel ──────────────────────────────────
    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      leadsConverted,
      activeClients,
      programsWeek,
      escalationMessages,
      recentLeads,
    ] = await Promise.all([
      // 1. New leads today
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart),

      // 2. New leads this week
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekStart),

      // 3. Total leads
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true }),

      // 4. Converted leads (for conversion rate)
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "converted"),

      // 5. Active clients (with their program and start date)
      supabase
        .from("clients")
        .select("id, program, program_started_at")
        .eq("status", "active"),

      // 6. Programs generated this week
      supabase
        .from("programs")
        .select("id", { count: "exact", head: true })
        .gte("generated_at", weekStart),

      // 7. Escalation messages — messages sent to Maddy's phone OR
      //    outbound messages containing "ESCALATION"
      supabase
        .from("messages")
        .select("phone, body, created_at")
        .or(
          "phone.eq.+917082478374,body.ilike.%ESCALATION%"
        )
        .eq("direction", "out")
        .order("created_at", { ascending: false })
        .limit(10),

      // 8. Recent leads
      supabase
        .from("leads")
        .select("name, phone, status, program_interest, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // ── Active clients by program ────────────────────────────────────
    const activeClientsList = activeClients.data || [];
    const activeByProgram = {};
    for (const c of activeClientsList) {
      const prog = c.program || "unknown";
      activeByProgram[prog] = (activeByProgram[prog] || 0) + 1;
    }

    // ── Pending check-ins ────────────────────────────────────────────
    // For each active client, calculate the current expected week_no and
    // check if a checkin row exists for that week.
    let pendingCheckins = 0;

    if (activeClientsList.length > 0) {
      // Build a map of client_id -> expected week_no
      const clientWeeks = activeClientsList.map((c) => ({
        id: c.id,
        expectedWeek: currentWeekNo(c.program_started_at),
      }));

      // Fetch all checkins for active clients for their expected week
      const clientIds = clientWeeks.map((cw) => cw.id);
      const { data: recentCheckins } = await supabase
        .from("checkins")
        .select("client_id, week_no")
        .in("client_id", clientIds);

      const checkinSet = new Set();
      for (const ci of recentCheckins || []) {
        checkinSet.add(`${ci.client_id}__${ci.week_no}`);
      }

      for (const cw of clientWeeks) {
        const key = `${cw.id}__${cw.expectedWeek}`;
        if (!checkinSet.has(key)) {
          pendingCheckins++;
        }
      }
    }

    // ── Conversion rate ──────────────────────────────────────────────
    const totalCount = leadsTotal.count || 0;
    const convertedCount = leadsConverted.count || 0;
    const conversionRate =
      totalCount > 0
        ? Math.round((convertedCount / totalCount) * 1000) / 10
        : 0;

    // ── Format escalations (mask phones) ─────────────────────────────
    const recentEscalations = (escalationMessages.data || []).map((m) => ({
      phone: maskPhone(m.phone),
      reason: m.body || "",
      created_at: m.created_at,
    }));

    // ── Format recent leads (mask phones) ────────────────────────────
    const formattedLeads = (recentLeads.data || []).map((l) => ({
      name: l.name || "Unknown",
      phone: maskPhone(l.phone),
      status: l.status,
      program_interest: l.program_interest || null,
      created_at: l.created_at,
    }));

    // ── Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      new_leads_today: leadsToday.count || 0,
      new_leads_week: leadsWeek.count || 0,
      total_leads: totalCount,
      conversion_rate: conversionRate,
      active_clients_by_program: activeByProgram,
      total_active_clients: activeClientsList.length,
      pending_checkins: pendingCheckins,
      programs_generated_week: programsWeek.count || 0,
      recent_escalations: recentEscalations,
      recent_leads: formattedLeads,
    });
  } catch (err) {
    console.error("[admin/stats] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
