const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with intake info
    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    // Store intake data as a message for audit
    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions,
      current_weight, height
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[INTAKE FORM] ${JSON.stringify(intakeData)}`,
      template_name: 'intake_form'
    });

    return res.json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
