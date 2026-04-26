const { supabase } = require('./_lib/supabase');
const { json } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_preference, schedule, medical_conditions, phone,
    } = req.body;

    if (!lead_id) return json(res, 400, { error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return json(res, 404, { error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      age,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('lead_intake')
      .upsert(intakeData, { onConflict: 'lead_id' });

    if (error) {
      console.error('lead-intake insert error:', error.message);
    }

    return json(res, 200, { success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
