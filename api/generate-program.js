const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { generateProgramPDF } = require('./_lib/pdf');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const supabase = getSupabase();

  // Get client data
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get intake form
  const { data: intake } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('phone', client.phone)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  // Get last 2 check-ins
  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Get previous program (for continuity)
  const { data: prevProgram } = await supabase
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .single();

  // Build prompt for Claude
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    client,
    intake,
    recentCheckins: recentCheckins || [],
    prevProgram,
    weekNo: week_no
  });

  // Call Claude API
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  // Safety check
  if (isFlagged(programData)) {
    const { createEscalation } = require('./_lib/escalation');
    await createEscalation({
      phone: client.phone,
      clientId: client_id,
      reason: 'AI-generated program flagged for safety review',
      triggerMessage: JSON.stringify(programData).slice(0, 500)
    });
    return res.status(200).json({ flagged: true, message: 'Program flagged for review' });
  }

  // Generate PDF
  const pdfBuffer = await generateProgramPDF({
    clientName: client.name || 'Client',
    weekNo: week_no,
    workoutPlan: programData.workout_plan,
    nutritionPlan: programData.nutrition_plan,
    notes: programData.notes
  });

  // Upload to Supabase Storage
  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  await supabase.storage.from('programs').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  const { data: urlData } = supabase.storage
    .from('programs')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || pdfPath;

  // Save to programs table
  await supabase.from('programs').upsert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes
  }, { onConflict: 'client_id,week_no' });

  // Send via WhatsApp
  const contextNote = programData.notes
    ? programData.notes.slice(0, 150)
    : `Week ${week_no} program ready!`;

  await sendWhatsApp({
    phone: client.phone,
    body: `Your Week ${week_no} program is ready! 📋\n\n${contextNote}\n\nPDF: ${pdfUrl}`
  });

  // Update whatsapp_sent_at
  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: pdfUrl });
};

function buildSystemPrompt() {
  return `You are a NASM-certified fitness program architect for "Fitness by Maddy".
You create weekly workout and nutrition plans that are:
- Evidence-based and progressive
- Tailored to the client's current fitness level, injuries, and goals
- Safe (never recommend extreme calorie deficits below 1200kcal, banned substances, or unrealistic timelines)
- Structured as JSON with workout_plan and nutrition_plan objects

Output ONLY valid JSON in this format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "notes": "2 min rest" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 67 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 1 whole egg, oats 50g, banana" }
    ]
  },
  "notes": "Brief coach note about this week's focus and adjustments"
}`;
}

function buildUserPrompt({ client, intake, recentCheckins, prevProgram, weekNo }) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `Height: ${intake.height_cm || 'unknown'}cm\n`;
    prompt += `Current weight: ${intake.weight_kg || 'unknown'}kg\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'no restriction'}\n`;
    prompt += `Workout days/week: ${intake.workout_days_per_week || 5}\n`;
    prompt += `Gym access: ${intake.gym_access ? 'yes' : 'no'}\n`;
    prompt += `Equipment: ${intake.equipment || 'full gym'}\n`;
  }

  if (recentCheckins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const ci of recentCheckins) {
      prompt += `- Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, issues: "${ci.issues}"`;
      prompt += '\n';
    }
  }

  if (prevProgram) {
    prompt += `\nPrevious week's focus: ${prevProgram.notes || 'standard progression'}\n`;
  }

  prompt += `\nDesign an appropriate Week ${weekNo} plan. Progress from last week if applicable. Keep it safe and effective.`;
  return prompt;
}

function isFlagged(programData) {
  if (!programData || !programData.nutrition_plan) return false;
  const cal = programData.nutrition_plan.calories;
  if (cal && cal < 1200) return true;

  const text = JSON.stringify(programData).toLowerCase();
  const banned = ['steroid', 'clenbuterol', 'dnp', 'ephedra', 'sarm'];
  return banned.some(term => text.includes(term));
}
