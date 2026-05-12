const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTYFOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();
    const results = [];

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(now - TWO_HOURS_MS).toISOString())
      .gt('created_at', new Date(now - TWENTYFOUR_HOURS_MS).toISOString());

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!msgs || msgs.length === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: isHinglish(lead.market)
              ? ['Maddy ka $20 trial try karo — ek Zoom session mein dekhlo kaisa hota hai!', 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial']
              : ['Try Maddy\'s $20 trial — one Zoom session to see what it\'s all about!', 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial']
          });
          results.push({ phone: lead.phone, action: 'nudge_trial' });
        }
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(now - TWENTYFOUR_HOURS_MS).toISOString())
      .gt('created_at', new Date(now - SEVEN_DAYS_MS).toISOString());

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!msgs || msgs.length === 0) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          results.push({ phone: lead.phone, action: 'dropped' });
        }
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', new Date(now - SEVEN_DAYS_MS).toISOString());

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', new Date(now - SEVEN_DAYS_MS).toISOString())
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        await sendTemplate(lead.phone, 'reengagement_7day', {
          name: lead.name || 'there',
          templateParams: isHinglish(lead.market)
            ? ['Abhi bhi interested ho fitness mein? Maddy ke programs check karo — limited slots available.']
            : ['Still interested in fitness? Check out Maddy\'s programs — limited slots available.']
        });
        results.push({ phone: lead.phone, action: 'reengagement' });
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const { data: lastNudge } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1);

        const lastNudgeTime = lastNudge?.[0]?.sent_at ? new Date(lastNudge[0].sent_at).getTime() : 0;
        if (now - lastNudgeTime > TWENTYFOUR_HOURS_MS) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge', {
            name: client.name || 'there',
            templateParams: [client.name || 'there', checkinUrl]
          });
          results.push({ client_id: client.id, action: 'checkin_nudge' });
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
