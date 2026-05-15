const supabase = require('./_lib/supabase');
const cors = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, medical_conditions,
      experience_level, equipment_access
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      experience_level,
      equipment_access,
      submitted_at: new Date().toISOString()
    };

    // Store intake data as a JSON object in Supabase storage
    const fileName = `intakes/${lead_id}.json`;
    await supabase.storage
      .from('client-data')
      .upload(fileName, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    return res.json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
