const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error } = await query;
    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, experience, medical_conditions, email,
    };

    const folderPath = `intakes/${lead.id}`;
    const fileName = `intake_${Date.now()}.json`;
    await db.storage
      .from('client-files')
      .upload(`${folderPath}/${fileName}`, JSON.stringify(intakeData), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
