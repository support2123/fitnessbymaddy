const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      name, email, phone, age, gender, goal, injuries,
      diet_preference, schedule, experience_level,
      current_weight, target_weight, medical_conditions,
      lead_id, submitted_at: new Date().toISOString()
    };

    const folderPath = `intakes/${lead_id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/intake.json`, JSON.stringify(intakeData), {
        contentType: 'application/json',
        upsert: true
      });

    if (medical_conditions && medical_conditions.trim()) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation(phone, 'medical_condition_on_intake', medical_conditions);
    }

    await sendWhatsApp({
      phone,
      body: `Thanks ${name}! Your intake form is received. Once your payment is confirmed, Maddy's team will get your program started within 24 hours.`
    });

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
