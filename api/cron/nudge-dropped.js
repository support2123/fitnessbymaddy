const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, sendEscalation, maskPhone } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  let nudged = 0;
  let escalated = 0;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (leads?.length) {
      for (const lead of leads) {
        try {
          const hinglish = isHinglish(lead.market);
          const msg = hinglish
            ? `Hey ${lead.name || ''}! 👋 Maddy ki team se — abhi bhi fitness journey start karna hai? Humare $20 trial session se try karo, koi commitment nahi:\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply karo agar koi sawaal hai!`
            : `Hey ${lead.name || ''}! 👋 From Maddy's team — still thinking about starting your fitness journey? Try our $20 trial session, no commitment:\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply if you have any questions!`;
          await sendWhatsApp({ phone: lead.phone, body: msg });
          nudged++;
        } catch (e) {
          console.error(`Nudge failed for lead ${lead.id}:`, e.message);
        }
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('*, checkins(*)')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const currentWeek = Math.floor(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const checkinWeeks = new Set((client.checkins || []).map(c => c.week_no));
        let consecutiveMissed = 0;

        for (let w = currentWeek; w >= 1; w--) {
          if (!checkinWeeks.has(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await sendEscalation(
            `Client ${maskPhone(client.phone)} has missed ${consecutiveMissed} consecutive check-ins. Follow up needed.`
          );
          escalated++;
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
