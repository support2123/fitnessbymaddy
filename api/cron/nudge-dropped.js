const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const trialUrl = 'https://www.fitnessbymaddy.com/intake.html?program=zoom_trial';

        const msg = hinglish
          ? `Hey ${lead.name || ''}! Maddy ka $20 Zoom trial try karna chahoge? Ek session mein samajh aa jayega ki program sahi hai ya nahi.\n\n${trialUrl}`
          : `Hey ${lead.name || ''}! Want to try Maddy's $20 Zoom trial? One session to see if the program is right for you.\n\n${trialUrl}`;

        const result = await sendWhatsApp(lead.phone, 'nudge_trial', msg);
        if (result.ok) {
          nudged++;
          console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
        }
      }
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .lte('created_at', thirtyDaysAgo);

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
