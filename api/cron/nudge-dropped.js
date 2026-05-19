const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await nudgeNewLeads();
    const reengaged = await reengageDropped();

    return res.json({ reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeNewLeads() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  if (!staleLeads) return;

  for (const lead of staleLeads) {
    const hinglish = isHinglish(lead.market);
    const params = hinglish
      ? ['Hey! Ek $20 trial session try karein Maddy ke saath. Link: https://www.fitnessbymaddy.com/trial']
      : ['Hey! Try a $20 trial session with Maddy. Link: https://www.fitnessbymaddy.com/trial'];
    await sendWhatsApp(lead.phone, 'nudge_trial', params);
  }

  const { data: expiredLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  if (expiredLeads && expiredLeads.length > 0) {
    const ids = expiredLeads.map(l => l.id);
    await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
  }
}

async function reengageDropped() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reengageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', eightDaysAgo);

  if (!reengageLeads || reengageLeads.length === 0) return 0;

  let count = 0;
  for (const lead of reengageLeads) {
    const hinglish = isHinglish(lead.market);
    const params = hinglish
      ? ['Hey! Maddy ke programs mein limited spots available hain. $20 trial se start karein!']
      : ['Hey! Limited spots available in Maddy\'s programs. Start with a $20 trial!'];
    const result = await sendWhatsApp(lead.phone, 'reengage_7day', params);
    if (result.ok) count++;
  }

  return count;
}
