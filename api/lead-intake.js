const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      photos,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    // Check lead exists
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with name
    await supabase.from('leads').update({ name }).eq('id', lead_id);

    // Store intake data on the clients table (or create a placeholder)
    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
    };

    // Check if client already exists
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      await supabase.from('clients').update({
        name,
        email,
        intake_data: intakeData,
      }).eq('id', existing.id);
    }

    // Handle photo uploads
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;
        const buffer = Buffer.from(photoData.split(',')[1] || photoData, 'base64');
        await supabase.storage
          .from('clients')
          .upload(`intake/${lead_id}/photo_${i}.jpg`, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
