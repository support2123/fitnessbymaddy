const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const SITE = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();

    const { data: activeClients, error } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (error) {
      console.error(`[weekly-checkin] Query error: ${error.message}`);
      return res.status(500).json({ error: 'Database error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of (activeClients || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existingCheckin } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = await getClientMarket(sb, client);
      const hinglish = isHinglish(market);

      const message = hinglish
        ? `Week ${weekNo} check-in time! Apna progress share karo: ${checkinUrl}`
        : `Week ${weekNo} check-in time! Share your progress: ${checkinUrl}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinUrl]
      });

      await sb.from('nudges').insert({
        client_id: client.id,
        nudge_type: `checkin_w${weekNo}_initial`,
        sent_at: new Date().toISOString()
      });

      sent++;
    }

    console.log(`[weekly-checkin] Sent: ${sent}, Skipped: ${skipped}`);
    return res.status(200).json({ ok: true, sent, skipped });

  } catch (err) {
    console.error(`[weekly-checkin] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

async function getClientMarket(sb, client) {
  if (client.lead_id) {
    const { data: lead } = await sb
      .from('leads')
      .select('market')
      .eq('id', client.lead_id)
      .single();
    if (lead) return lead.market;
  }
  const phone = client.phone || '';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}
