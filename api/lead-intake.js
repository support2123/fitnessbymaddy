const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_preference, schedule, medical_conditions, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    // Find lead
    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with form data
    await supabase.from('leads').update({
      name: name || lead.name
    }).eq('id', lead.id);

    // Store intake data as a note in a metadata approach
    // For now, store in client record when they convert
    // We'll store this in Supabase storage as JSON
    const intakeData = {
      lead_id: lead.id,
      name, email, age, goal, injuries,
      diet_preference, schedule, medical_conditions,
      submitted_at: new Date().toISOString()
    };

    const filePath = `intakes/${lead.id}.json`;
    await supabase.storage
      .from('client-data')
      .upload(filePath, JSON.stringify(intakeData), {
        contentType: 'application/json',
        upsert: true
      });

    return res.status(200).json({ success: true, message: 'Intake form saved' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
