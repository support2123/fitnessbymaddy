const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      equipment_access,
      schedule_days,
      schedule_time,
      current_supplements,
      photos
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else if (phone) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal,
      injuries, medical_conditions, diet_preference,
      training_experience, equipment_access,
      schedule_days, schedule_time, current_supplements, photos
    };

    const needsReview = injuries || medical_conditions;
    if (needsReview) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy({
        reason: 'Medical/injury flag on intake form',
        phone: lead.phone,
        clientName: name || lead.name,
        details: `Injuries: ${injuries || 'None'}, Medical: ${medical_conditions || 'None'}`
      });
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
