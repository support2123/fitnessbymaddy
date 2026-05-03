const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

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
      workout_days,
      equipment_access,
      wake_time,
      sleep_time,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with name if provided
    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    // Store intake data as a client profile note in metadata
    // The client record is created upon purchase (exly-webhook)
    // For now, store intake info on the lead
    const intakeData = {
      age, gender, height, weight, goal,
      injuries, medical_conditions, diet_preference,
      workout_days, equipment_access, wake_time, sleep_time,
      email,
      submitted_at: new Date().toISOString(),
    };

    await db.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData),
    }).eq('id', lead_id);

    // Check for escalation-worthy medical info
    const { needsEscalation } = require('../lib/escalation');
    const { notifyMaddy } = require('../lib/whatsapp');
    const { maskPhone } = require('../lib/market');

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await notifyMaddy(
        'Medical flag on intake form',
        `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nIssues: ${medicalText.slice(0, 200)}`
      );
    }

    return res.status(200).json({ success: true, lead_id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
