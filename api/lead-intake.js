const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, phone,
      goal, injuries, diet_pref, schedule, medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const updateData = {};
    if (name) updateData.name = name;

    if (lead_id) {
      await supabase
        .from('leads')
        .update(updateData)
        .eq('id', lead_id);
    }

    const { data: lead } = lead_id
      ? await supabase.from('leads').select('*').eq('id', lead_id).single()
      : await supabase.from('leads').select('*').eq('phone', phone).single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const clientData = {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || '6wk_gym',
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule
    };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existing) {
      await supabase
        .from('clients')
        .update(clientData)
        .eq('id', existing.id);
    } else {
      await supabase.from('clients').insert(clientData);
    }

    if (medical_conditions && medical_conditions.trim()) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation({
        phone: lead.phone,
        reason: `Medical conditions reported on intake: ${medical_conditions}`,
        messageBody: `Intake form — Medical: ${medical_conditions}, Injuries: ${injuries || 'none'}`
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Intake error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
