const { supabase } = require('../lib/supabase');
const { corsHeaders, parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, phone, age, goal, injuries, diet_pref, schedule, experience } = body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = { age, goal, injuries, diet_pref, schedule, experience, email };
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[intake_form] ${JSON.stringify(intakeData)}`
    });

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
