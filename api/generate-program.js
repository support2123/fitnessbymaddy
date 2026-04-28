const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 cal', 'under 1000', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine', 'sarm',
  'steroid', 'testosterone inject', 'hgh inject',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fast', 'water fast for', 'dry fast'
];

function hasSafetyRisk(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client data
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data from lead
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('intake_data')
        .eq('id', client.lead_id)
        .single();
      if (lead) intakeData = lead.intake_data || {};
    }

    // Get previous program for continuity
    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build Claude prompt
    const prompt = buildProgramPrompt({
      client,
      intakeData,
      recentCheckins: recentCheckins || [],
      prevProgram,
      weekNo: week_no
    });

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are an expert fitness program architect for FitnessByMaddy. You design weekly workout and nutrition plans that are safe, progressive, and effective. Always output valid JSON with the exact schema requested. Never suggest banned substances, extreme calorie deficits below 1200 kcal, or unrealistic timelines. Be specific with exercises, sets, reps, and rest periods.`
    });

    const rawOutput = response.content[0].text;

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('Failed to parse Claude output as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Safety check
    if (hasSafetyRisk(programData)) {
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program for ${client.name} flagged for safety review. Auto-send halted.`
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: 'FLAGGED FOR SAFETY REVIEW — not auto-sent'
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    // Generate branded PDF
    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: programData.workout_plan,
      nutritionPlan: programData.nutrition_plan,
      notes: programData.notes || ''
    });

    // Upload PDF to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    const { data: pdfPublic } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = pdfPublic.publicUrl;

    // Save to programs table (audit trail)
    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || '',
      pdf_url: pdfUrl
    }).select().single();

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const contextNote = programData.notes
      ? programData.notes.slice(0, 150)
      : `Week ${week_no} program is ready`;

    const msg = hinglish
      ? `${client.name || 'Champ'}, Week ${week_no} ka program ready hai! 📋\n\n${contextNote}\n\nPDF: ${pdfUrl}`
      : `${client.name || 'Champ'}, your Week ${week_no} program is ready! 📋\n\n${contextNote}\n\nPDF: ${pdfUrl}`;

    const waResult = await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: msg,
      params: [client.name || 'there', String(week_no), pdfUrl]
    });

    // Update sent timestamp
    if (waResult.ok) {
      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      programId: program.id,
      pdfUrl,
      whatsappSent: !!waResult.ok
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildProgramPrompt({ client, intakeData, recentCheckins, prevProgram, weekNo }) {
  let prompt = `Generate a Week ${weekNo} fitness program for this client.\n\n`;

  prompt += `CLIENT PROFILE:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;

  if (intakeData.age) prompt += `- Age: ${intakeData.age}\n`;
  if (intakeData.gender) prompt += `- Gender: ${intakeData.gender}\n`;
  if (intakeData.goal) prompt += `- Goal: ${intakeData.goal}\n`;
  if (intakeData.experience_level) prompt += `- Experience: ${intakeData.experience_level}\n`;
  if (intakeData.injuries) prompt += `- Injuries/Limitations: ${intakeData.injuries}\n`;
  if (intakeData.diet_preference) prompt += `- Diet: ${intakeData.diet_preference}\n`;
  if (intakeData.schedule) prompt += `- Available days: ${intakeData.schedule}\n`;
  if (intakeData.current_weight) prompt += `- Starting weight: ${intakeData.current_weight}\n`;

  if (recentCheckins.length > 0) {
    prompt += `\nRECENT CHECK-INS:\n`;
    for (const ci of recentCheckins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}, Waist ${ci.waist || 'N/A'}, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      prompt += `\n`;
    }
  }

  if (prevProgram) {
    prompt += `\nPREVIOUS WEEK PLAN SUMMARY:\n`;
    prompt += JSON.stringify(prevProgram.workout_plan).slice(0, 500);
    prompt += `\n`;
  }

  prompt += `
OUTPUT SCHEMA (respond with ONLY this JSON, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {
            "name": "Bench Press",
            "sets": 4,
            "reps": "8-10",
            "rest": "90s",
            "notes": "Progressive overload from last week"
          }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg", "2 toast with peanut butter", "1 banana"],
        "notes": "Within 30 min of waking"
      }
    ]
  },
  "notes": "One-liner context for the client about this week's focus"
}`;

  return prompt;
}
