const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      additional_notes,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead_id);

    const intakeData = {
      email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      additional_notes,
    };

    const { error: storageErr } = await supabase.storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) {
      console.error('[lead-intake] Storage error:', storageErr);
    }

    const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
    const flagFields = [injuries, medical_conditions, additional_notes].join(' ');
    if (needsEscalation(flagFields)) {
      await escalateToMaddy('Medical flag in intake form', lead.phone, flagFields);
    }

    return res.status(200).json({ ok: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('[lead-intake]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
