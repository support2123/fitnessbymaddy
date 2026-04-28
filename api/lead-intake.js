const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      leadId,
      name,
      email,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      dietPreference,
      schedule,
      experience,
      medicalConditions,
      medications,
    } = req.body;

    if (!leadId) {
      return res.status(400).json({ error: 'leadId is required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', leadId);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', leadId)
      .single();

    const intakeData = {
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      dietPreference,
      schedule,
      experience,
      medicalConditions,
      medications,
      submittedAt: new Date().toISOString(),
    };

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name, email, intake_data: intakeData })
        .eq('id', existingClient.id);
    } else {
      await supabase.from('clients').insert({
        lead_id: leadId,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: lead.program_interest,
        status: 'active',
        intake_data: intakeData,
      });
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
