const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, medical_conditions,
      experience_level, equipment_access
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, schedule, medical_conditions,
      experience_level, equipment_access, email
    };

    const { data: existingClient } = await supabase
      .from('clients').select('id').eq('lead_id', lead.id).single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || lead.name,
        email
      }).eq('id', existingClient.id);
    }

    // Store intake data as a message for reference
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      status: 'received'
    });

    const hasEscalationCondition = [injuries, medical_conditions].some(
      field => field && field.trim().length > 0
    );

    if (hasEscalationCondition) {
      const { createEscalation, notifyMaddy } = require('./_lib/escalation');
      await createEscalation(
        lead.phone,
        'intake_medical_flag',
        `Injuries: ${injuries || 'None'}, Medical: ${medical_conditions || 'None'}`
      );
      await notifyMaddy('Intake form medical flag', lead.phone,
        `Injuries: ${injuries || 'None'}, Medical: ${medical_conditions || 'None'}`);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
