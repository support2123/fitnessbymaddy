const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, age, gender, height, weight, goal, injuries, diet_pref, schedule, experience, medical } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = { age, gender, height, weight, goal, injuries, diet_pref, schedule, experience, medical, submitted_at: new Date().toISOString() };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({ intake_data: intakeData, name: name || lead.name }).eq('id', existingClient.id);
    }

    const market = lead.market || 'IN';
    const msg = market === 'IN'
      ? `Thank you ${name || 'ji'}! 🙏 Aapka intake form mil gaya. Maddy ki team jald aapka program set karegi.`
      : `Thank you ${name || ''}! 🙏 Your intake form is received. Maddy's team will set up your program soon.`;

    await sendText(lead.phone, msg, true);

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
