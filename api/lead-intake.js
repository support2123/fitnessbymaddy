import { getSupabase } from './_lib/supabase.js';
import { sendSessionMessage, maskPhone } from './_lib/whatsapp.js';
import { needsEscalation, handleEscalation } from './_lib/escalation.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    workout_experience, available_days, equipment_access,
    wake_time, sleep_time, notes
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'lead_id, name, and email are required' });
  }

  const db = getSupabase();

  try {
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, workout_experience,
      available_days, equipment_access, wake_time, sleep_time, notes, email
    };

    const allText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    const escalationReason = needsEscalation(allText);
    if (escalationReason) {
      await handleEscalation(
        lead.phone,
        `Intake form: ${allText.slice(0, 300)}`,
        `intake_${escalationReason}`
      );
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      console.log(`Intake form for existing client: ${maskPhone(lead.phone)}`);
    }

    if (lead.phone) {
      const market = lead.market || 'GLOBAL';
      const msg = market === 'IN'
        ? `Thanks ${name}! Tumhara intake form mil gaya. Maddy ki team jaldi tumhare liye plan banayegi.`
        : `Thanks ${name}! We've received your intake form. Maddy's team will prepare your plan shortly.`;
      await sendSessionMessage(lead.phone, msg);
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
