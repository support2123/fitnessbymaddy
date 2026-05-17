const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Find leads with no reply after 2 hours (for nudge) and not yet nudged
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours (still 'new')
    const { data: freshLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    const results = [];

    if (freshLeads) {
      for (const lead of freshLeads) {
        // Check if we already sent a nudge
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || '',
          templateParams: [lead.name || 'there']
        });

        results.push({ phone: lead.phone, action: 'nudge_sent' });
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);

        results.push({ phone: lead.phone, action: 'dropped' });
      }
    }

    // Re-engage dropped leads from 7 days ago (one-time only)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (count > 0) continue;

        const market = detectMarket(lead.phone);
        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || '',
          templateParams: [lead.name || 'there']
        });

        results.push({ phone: lead.phone, action: 'reengage_sent' });
      }
    }

    // Nudge clients who haven't submitted check-in (+24h and +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        // Check when the check-in was sent (last Sunday)
        const daysSinceSunday = (now.getDay() + 7) % 7;
        if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
          const market = detectMarket(client.phone);
          const msg = market === 'IN'
            ? `Hey ${client.name || ''}! Tumhara Week ${weekNo} check-in abhi pending hai. Jaldi submit karo: https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
            : `Hey ${client.name || ''}! Your Week ${weekNo} check-in is still pending. Submit here: https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

          const { sendText } = require('../../lib/whatsapp');
          await sendText(client.phone, msg, true);

          results.push({ client_id: client.id, action: 'checkin_nudge' });
        }
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
