const { supabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_preference, schedule, medical_conditions, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    if (injuries || medical_conditions) {
      const combined = `${injuries || ''} ${medical_conditions || ''}`;
      if (needsEscalation(combined)) {
        const identifier = phone || lead_id;
        await escalate(identifier, `Intake form flagged: ${combined.slice(0, 100)}`);
      }
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const intakeData = { age, goal, injuries, diet_preference, schedule, medical_conditions, email };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || lead.name,
        email,
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
