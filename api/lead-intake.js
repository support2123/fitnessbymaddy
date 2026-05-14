const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      height: parseFloat(height) || null,
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase.from('intake_forms').upsert(intakeData, {
      onConflict: 'lead_id'
    });

    if (error) {
      const { error: createError } = await supabase.rpc('create_intake_if_missing');
      if (!createError) {
        await supabase.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });
      }
    }

    return res.json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'submission failed' });
  }
};
