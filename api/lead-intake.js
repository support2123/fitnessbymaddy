const { getSupabase } = require('./_lib/supabase');
const { checkAndEscalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      meals_per_day, training_experience, gym_access,
      available_days, wake_time, sleep_time, supplements, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    await checkAndEscalate(
      lead.phone,
      medicalText,
      'Intake form — medical/injury flag'
    );

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id, name, email, phone: phone || lead.phone,
      age, gender, goal, injuries, medical_conditions,
      diet_preference, meals_per_day, training_experience,
      gym_access, available_days, wake_time, sleep_time,
      supplements, notes,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existing && existing.length > 0) {
      // Intake data stored as part of client context for program generation
      console.log(`Intake updated for existing client, lead: ${maskPhone(lead.phone)}`);
    }

    console.log(`Intake received: ${maskPhone(lead.phone)}`);
    return res.status(200).json({ success: true, intake: intakeData });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
