const { supabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      phone, name, email, age, gender, goal, program,
      injuries, medical_conditions, diet_preference,
      schedule, current_activity, experience_level,
      height, weight, waist
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'Phone and name are required' });
    }

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, schedule, current_activity,
      experience_level, height, weight, waist,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existingClient) {
      await supabase.from('clients').update({
        name,
        email,
        intake_data: intakeData
      }).eq('id', existingClient.id);
    } else {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (lead) {
        await supabase.from('leads').update({
          name,
          program_interest: program || null
        }).eq('id', lead.id);
      } else {
        await supabase.from('leads').insert({
          phone,
          name,
          source: 'intake_form',
          status: 'qualified',
          program_interest: program || null
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
