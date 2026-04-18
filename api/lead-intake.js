const { supabase } = require('../lib/supabase');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    medical_conditions,
    diet_preference,
    training_experience,
    equipment_access,
    weekly_schedule,
    wake_time,
    sleep_time,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone is required' });
  }

  let lead;
  if (lead_id) {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();
    lead = data;
  } else {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();
    lead = data;
  }

  if (!lead) {
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone: phone || 'unknown',
        name,
        source: 'intake_form',
        status: 'qualified',
        program_interest: goal,
        market: 'GLOBAL',
      })
      .select()
      .single();
    lead = newLead;
  } else {
    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status,
      })
      .eq('id', lead.id);
  }

  const intakeData = {
    age, gender, height, weight, goal,
    injuries, medical_conditions, diet_preference,
    training_experience, equipment_access,
    weekly_schedule, wake_time, sleep_time, email,
  };

  const { error } = await supabase
    .from('leads')
    .update({
      intake_data: intakeData,
      name: name || lead.name,
    })
    .eq('id', lead.id);

  if (error) {
    console.error('Intake save error:', error);
    return res.status(500).json({ error: 'Failed to save intake data' });
  }

  return res.status(200).json({ success: true, lead_id: lead.id });
};
