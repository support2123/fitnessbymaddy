const { supabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, experience, medical_conditions,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status
      })
      .eq('id', lead_id);

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_preference, schedule, experience, medical_conditions,
      current_weight, target_weight, height
    };

    // Store intake data as a JSON file in Supabase Storage
    const filePath = `intakes/${lead_id}.json`;
    await supabase.storage
      .from('client-data')
      .upload(filePath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    return res.status(200).json({ success: true, message: 'Intake saved' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
