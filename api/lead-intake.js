const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    // Store intake data temporarily in lead record via program_interest JSON
    const intakeData = { name, email, age, goal, injuries, diet_pref, schedule, phone };

    await supabase
      .from('clients')
      .upsert({
        lead_id,
        phone: phone || lead.phone,
        name: name || lead.name,
        email,
        program: mapProgram(lead.program_interest),
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        status: 'active'
      }, { onConflict: 'lead_id', ignoreDuplicates: true });

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProgram(interest) {
  const valid = ['6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack'];
  return valid.includes(interest) ? interest : '6wk_gym';
}
