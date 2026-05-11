const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
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

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      medical_conditions,
      email,
      submitted_at: new Date().toISOString(),
    };

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        intake_data: intakeData,
      })
      .eq('id', lead.id);

    const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
    const healthConcerns = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(healthConcerns)) {
      await escalateToMaddy('intake_health_flag', lead.phone, healthConcerns);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
