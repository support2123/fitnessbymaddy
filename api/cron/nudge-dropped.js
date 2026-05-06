const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { getLanguage, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          continue;
        }

        if (hoursSinceLastMsg >= 2) {
          const market = detectMarket(lead.phone);
          const lang = getLanguage(market);

          const msg = lang === 'hinglish'
            ? `Hey! Abhi tak decide nahi hua? Ek $20 trial session try karo — Maddy ke saath live Zoom call. Risk-free!\n\nhttps://www.fitnessbymaddy.com/program-trial.html`
            : `Hey! Still deciding? Try a $20 trial session — a live Zoom call with Maddy. Risk-free!\n\nhttps://www.fitnessbymaddy.com/program-trial.html`;

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            body: msg,
            params: [lead.name || 'there']
          });
        }
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: msgCount } = await db
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (msgCount && msgCount.length > 0) continue;

        const market = detectMarket(lead.phone);
        const lang = getLanguage(market);

        const msg = lang === 'hinglish'
          ? `Hey ${lead.name || 'there'}! Maddy ka special offer — 6-Week Shred program pe limited time discount. Interest ho toh reply karo!`
          : `Hey ${lead.name || 'there'}! Special offer from Maddy — limited time discount on the 6-Week Shred program. Reply if interested!`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          body: msg,
          params: [lead.name || 'there']
        });

        await db
          .from('leads')
          .update({ status: 'new', last_msg_at: now.toISOString() })
          .eq('id', lead.id);

        reEngaged++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let nudgedClients = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const sundayDate = new Date(now);
        sundayDate.setDate(sundayDate.getDate() - sundayDate.getDay());
        const daysSinceSunday = Math.floor((now - sundayDate) / (1000 * 60 * 60 * 24));

        if (daysSinceSunday !== 1 && daysSinceSunday !== 2) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          body: `Reminder: Your Week ${weekNo} check-in is still pending. Fill it in so we can keep your program on track!\n\n${checkinUrl}`,
          params: [client.name || 'there', String(weekNo)]
        });

        nudgedClients++;
      }
    }

    return res.status(200).json({
      success: true,
      reEngaged,
      nudgedClients
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
