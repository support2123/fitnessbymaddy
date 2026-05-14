import supabase from './lib/supabase.js';
import { maskPhone } from './lib/market.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      phone, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level,
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'phone and name are required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads').update({
        name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'intake_form',
        status: 'qualified',
      }).select('id').single();
    }

    const intakeData = {
      phone, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level,
      submitted_at: new Date().toISOString(),
    };

    const filePath = `intakes/${phone.replace(/[^0-9]/g, '')}_${Date.now()}.json`;
    await supabase.storage
      .from('client-files')
      .upload(filePath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', maskPhone(req.body?.phone || ''), err.message);
    return res.status(500).json({ error: 'Failed to process intake form' });
  }
}
