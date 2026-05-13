const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    // Find the lead
    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);
      lead = data && data[0];
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with intake data
    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    // Store intake data as a note on the lead (extend table or use metadata)
    // For now, we store key details in the first_msg field as structured data
    const intakeData = JSON.stringify({
      age, gender, goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, email, submitted_at: new Date().toISOString()
    });

    await supabase.from('leads').update({
      first_msg: intakeData
    }).eq('id', lead.id);

    // Check for medical escalation
    const { needsEscalation, notifyMaddy } = require('../lib/escalation');
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await notifyMaddy('Medical/injury flag on intake form', {
        phone: lead.phone,
        name: name || lead.name,
        message: allText
      });
    }

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
