const { getSupabase } = require('../lib/supabase');
const { generateProgram } = require('../lib/program-generator');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientData = {
      name: client.name,
      program: client.program,
      week_no,
      goal: intake?.goal || null,
      experience: intake?.experience_level || null,
      injuries: intake?.injuries || intake?.medical_conditions || null,
      diet_preference: intake?.diet_preference || null,
    };

    let program;
    try {
      program = await generateProgram(clientData, recentCheckins || []);
    } catch (err) {
      if (err.message.startsWith('SAFETY_HALT')) {
        await escalateToMaddy(
          'Program generation safety halt',
          `Client: ${maskPhone(client.phone)} Week ${week_no} — ${err.message}`
        );
        return res.status(422).json({ error: err.message });
      }
      throw err;
    }

    const pdfContent = renderProgramText(client, week_no, program);
    const pdfPath = `clients/${client_id}/week_${week_no}.txt`;

    await db.storage.from('programs').upload(pdfPath, Buffer.from(pdfContent), {
      contentType: 'text/plain',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes || program.weekly_focus,
    });

    if (insertError) throw insertError;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      program.weekly_focus || 'Keep pushing!',
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function renderProgramText(client, weekNo, program) {
  const wp = program.workout_plan;
  const np = program.nutrition_plan;

  let text = `
═══════════════════════════════════════════
  FITNESS BY MADDY — WEEK ${weekNo} PROGRAM
  Client: ${client.name || 'Client'}
  Program: ${client.program}
═══════════════════════════════════════════

WEEKLY FOCUS: ${program.weekly_focus || ''}

─── WORKOUT PLAN ───────────────────────\n`;

  if (wp?.days) {
    for (const day of wp.days) {
      text += `\n${day.day.toUpperCase()} — ${day.focus}\n`;
      if (day.exercises) {
        for (const ex of day.exercises) {
          text += `  ${ex.name}: ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})`;
          if (ex.notes) text += ` [${ex.notes}]`;
          text += '\n';
        }
      }
    }
  }

  if (wp?.cardio) {
    text += `\nCARDIO: ${wp.cardio.type} — ${wp.cardio.frequency}, ${wp.cardio.duration}\n`;
  }

  text += `\n─── NUTRITION PLAN ─────────────────────\n`;
  if (np) {
    text += `Calories: ${np.calories} kcal\n`;
    text += `Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g\n`;
    text += `Hydration: ${np.hydration || '3-4L water'}\n`;

    if (np.meals) {
      text += '\nMEALS:\n';
      for (const meal of np.meals) {
        text += `  ${meal.meal}: ${(meal.options || []).join(' / ')}\n`;
      }
    }
    if (np.supplements) {
      text += `\nSUPPLEMENTS: ${np.supplements.join(', ')}\n`;
    }
  }

  if (program.notes) {
    text += `\n─── NOTES ──────────────────────────────\n${program.notes}\n`;
  }

  text += `\n═══════════════════════════════════════════
  fitnessbymaddy.com | @fitnessbymaddy_
═══════════════════════════════════════════\n`;

  return text;
}
