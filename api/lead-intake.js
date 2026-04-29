const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience_level, medical_conditions, current_weight,
      target_weight, height,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: phone || '',
          name,
          source: 'intake_form',
          status: 'new',
          first_msg: `Intake form: ${goal}`,
        })
        .select()
        .single();
      lead = newLead;
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience_level, medical_conditions, current_weight,
      target_weight, height, email,
      submitted_at: new Date().toISOString(),
    };

    await supabase
      .from('messages')
      .insert({
        phone: lead.phone,
        direction: 'in',
        body: JSON.stringify(intakeData),
        template_name: 'intake_form_submission',
        status: 'received',
      });

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
