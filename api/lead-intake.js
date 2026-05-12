const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, medical_conditions,
    experience_level, equipment_access
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  // Verify lead exists
  const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Update lead with additional info
  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status
  }).eq('id', lead_id);

  // Store intake data as a note on the lead or in a separate structure
  // For now, we store the full intake as metadata
  const intakeData = {
    age, gender, height, weight, goal, injuries,
    diet_preference, schedule, medical_conditions,
    experience_level, equipment_access, email,
    submitted_at: new Date().toISOString()
  };

  // Check for escalation triggers in medical fields
  const { needsEscalation } = require('../lib/escalation');
  const medText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
  const esc = needsEscalation(medText);
  if (esc.escalate) {
    const { notifyMaddy } = require('../lib/whatsapp');
    const { maskPhone } = require('../lib/market');
    await notifyMaddy(
      'Intake Form — Medical Flag',
      `Lead: ${name || maskPhone(lead.phone)}\nTriggers: ${esc.reasons.join(', ')}\nDetails: ${medText}`
    );
  }

  return res.status(200).json({ success: true, lead_id });
};
