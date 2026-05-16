const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_pref,
      schedule, medical_conditions, experience_level,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        intake_data: intakeData
      }).eq('id', existingClient.id);
    }

    if (medical_conditions && medical_conditions.trim()) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation(
        lead.phone,
        'Medical condition reported in intake',
        `Conditions: ${medical_conditions}`,
        existingClient?.id
      );
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
