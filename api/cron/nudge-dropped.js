const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../../lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .eq('opted_out', false)
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ nudged: 0, message: 'No leads to nudge' });
    }

    let nudged = 0;

    for (const lead of leads) {
      try {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglishMarket(market);

        const body = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ke programs abhi bhi available hain. Sirf $20 mein ek trial zoom session try karo — koi commitment nahi.\n\nhttps://fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || 'there'}! Maddy's programs are still available. Try a $20 trial zoom session — no commitment.\n\nhttps://fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body,
          params: [lead.name || 'there'],
        });

        nudged++;
      } catch (e) {
        console.error('Nudge error:', lead.phone?.slice(-4), e.message);
      }
    }

    const { data: checkinNudges } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (checkinNudges) {
      for (const client of checkinNudges) {
        const weeksIn = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksIn)
          .single();

        if (checkin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (lastMsg) {
          const hoursSinceMsg = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceMsg >= 24 && hoursSinceMsg <= 72) {
            const allowed = await canSendMessage(client.phone);
            if (!allowed) continue;

            const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksIn}`;
            await sendWhatsApp({
              phone: client.phone,
              body: `Reminder: Your Week ${weeksIn} check-in is still pending. Fill it out here: ${formUrl}`,
            });
            checkinNudged++;
          }
        }
      }
    }

    return res.json({ nudged, checkin_nudged: checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
