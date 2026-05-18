const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, checkEscalation, notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment, schedule_preference
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = checkEscalation(medicalText);
    if (escalation.length > 0) {
      await notifyMaddy(
        'Medical Flag on Intake',
        `Lead ${name} mentioned: ${escalation.join(', ')}. Review before program start.`
      );
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, email, phone: phone || lead.phone,
      age: parseInt(age) || null,
      gender, height, weight: parseFloat(weight) || null,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment, schedule_preference,
      submitted_at: new Date().toISOString()
    };

    await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    if (lead.phone) {
      await sendWhatsApp(lead.phone, 'intake_received', {
        name: name || lead.name || 'there',
        templateParams: [name || lead.name || 'there']
      });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
