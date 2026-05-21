const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    let nudgedLeads = 0;
    let nudgedCheckins = 0;

    // --- PART 1: Nudge new leads who haven't replied (2hr mark) ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        const msg = isHinglish(lead.market)
          ? 'Hey! Maddy ka $20 trial try karo — 1 Zoom session mein samajh aa jayega. Link: https://fitnessbymaddy.com/intake?lead=' + lead.id
          : "Hey! Try Maddy's $20 trial — one Zoom session to see if it's right for you. Link: https://fitnessbymaddy.com/intake?lead=" + lead.id;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: [lead.name || 'there', msg],
        });
        nudgedLeads++;
      }
    }

    // --- PART 2: Mark 24hr+ no-reply leads as dropped ---
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    // --- PART 3: Nudge missing check-ins (24hr and 48hr) ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));
        const dayOfWeek = now.getDay();

        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_reminder',
          bodyValues: [client.name || 'there', checkinUrl],
        });
        nudgedCheckins++;

        // Check for 2 consecutive missed check-ins → escalate
        if (weekNo >= 2) {
          const { data: prevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .limit(1);

          if (!prevCheckin || prevCheckin.length === 0) {
            await db.from('escalations').insert({
              phone: client.phone.slice(0, 4) + 'XXX...' + client.phone.slice(-3),
              client_id: client.id,
              reason: '2_consecutive_missed_checkins',
              message_body: `Client missed check-ins for weeks ${weekNo - 1} and ${weekNo}`,
            });
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged_leads: nudgedLeads,
      nudged_checkins: nudgedCheckins,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
