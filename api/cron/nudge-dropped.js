const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (recentMessages && recentMessages.length > 0) continue;

        const hinglish = isHinglish(lead.phone);
        if (hinglish) {
          await sendWhatsApp(lead.phone, 'nudge_trial_hi', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html',
          ]);
        } else {
          await sendWhatsApp(lead.phone, 'nudge_trial_en', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html',
          ]);
        }
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', sevenDaysAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        const hinglish = isHinglish(client.phone);
        if (hinglish) {
          await sendWhatsApp(client.phone, 'checkin_nudge_hi', [
            client.name || 'Champion',
            checkinUrl,
          ]);
        } else {
          await sendWhatsApp(client.phone, 'checkin_nudge_en', [
            client.name || 'Champion',
            checkinUrl,
          ]);
        }
        checkinNudges++;
      }
    }

    return res.json({ nudged, dropped, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
