const { getSupabase } = require('./_lib/supabase');
const { sendTextMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, errorResponse, jsonResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  try {
    const {
      lead_id, name, age, gender, phone, email, goal,
      injuries, medical_conditions, diet_preference,
      workout_experience, available_equipment,
      weekly_schedule, wake_time, sleep_time,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return errorResponse(res, 'Missing lead_id');

    const { data: lead } = await db
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return errorResponse(res, 'Lead not found', 404);

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: client } = await db
      .from('clients').select('*').eq('lead_id', lead_id).single();

    if (client) {
      const intakeData = {
        age, gender, goal, injuries, medical_conditions,
        diet_preference, workout_experience, available_equipment,
        weekly_schedule, wake_time, sleep_time,
        current_weight, target_weight, height
      };

      const folderPath = client.folder_url || `clients/${client.id}`;
      const intakeJson = JSON.stringify(intakeData, null, 2);
      await db.storage.from('programs').upload(
        `${folderPath}/intake.json`,
        new TextEncoder().encode(intakeJson),
        { contentType: 'application/json', upsert: true }
      );

      if (email) {
        await db.from('clients').update({ name: name || client.name, email }).eq('id', client.id);
      }
    }

    const market = detectMarket(lead.phone);
    if (isHinglish(market)) {
      await sendTextMessage(lead.phone,
        `✅ Intake form mil gaya, ${name || 'champ'}!\n\n` +
        `Hum tumhare program pe kaam shuru kar rahe hain. Jaldi update milega!`
      );
    } else {
      await sendTextMessage(lead.phone,
        `✅ Got your intake form, ${name || 'champ'}!\n\n` +
        `We're working on your program. You'll hear from us soon!`
      );
    }

    return jsonResponse(res, { success: true });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};
