const { getSupabase } = require('../lib/supabase');
const { sendText, detectMarket, canSendMessage } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads who haven't replied in 2 hours (new leads only)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', oneDayAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = lead.market || detectMarket(lead.phone);
        const msg = market === 'IN'
          ? 'Hey! 👋 Humara $20 trial session bahut popular hai — ek Zoom call pe Maddy personally guide karti hain.\n\nInterested? Just reply "trial" and we\'ll set it up!'
          : 'Hey! 👋 Our $20 trial session is super popular — one Zoom call where Maddy personally guides you.\n\nInterested? Just reply "trial" and we\'ll set it up!';

        await sendText(lead.phone, msg);
        nudged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Mark leads older than 24hrs with no reply as dropped
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const expiredIds = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', expiredIds);
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNumber(client.program_started_at);
        if (weekNo < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .order('week_no', { ascending: false });

        if (!recentCheckins || recentCheckins.length === 0) {
          await notifyMaddy(`Client ${client.name} (ID: ${client.id}) has missed 2+ consecutive check-ins. Week ${weekNo}. Please follow up.`);
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, expired: expiredLeads?.length || 0 });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7));
}
