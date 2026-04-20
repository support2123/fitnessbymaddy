const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      supplements, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || undefined,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id,
      phone: lead.phone,
      name,
      email,
      status: 'active',
    }, { onConflict: 'lead_id' }).select().single();

    if (error && !client) {
      await supabase.from('clients').insert({
        lead_id,
        phone: lead.phone,
        name,
        email,
        status: 'active',
      });
    }

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${goal || 'no goal specified'}`,
      template_name: 'intake_form',
    });

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
