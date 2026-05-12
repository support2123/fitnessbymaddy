const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendMediaTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, intake, recentCheckins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    const parsed = parseResponse(content);

    if (parsed.flagged) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'Program generation flagged for review',
        context: parsed.flagReason || 'Auto-generated program may contain risky recommendations'
      });
      return res.json({ ok: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      parsed.workoutPlan, parsed.nutritionPlan, parsed.notes
    );

    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workoutPlan,
      nutrition_plan: parsed.nutritionPlan,
      notes: parsed.notes
    }).select('id').single();

    const market = detectMarket(client.phone);
    await sendMediaTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no)],
      pdfUrl
    );

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, prevProgram, weekNo) {
  let prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client. Output ONLY valid JSON with no other text.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
`;

  if (intake) {
    prompt += `
INTAKE DATA:
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries: ${intake.injuries || 'none reported'}
- Medical conditions: ${intake.medical_conditions || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no preference'}
- Schedule: ${intake.workout_schedule || 'flexible'}
- Experience: ${intake.experience_level || 'intermediate'}
- Current weight: ${intake.current_weight || 'unknown'}kg
- Target weight: ${intake.target_weight || 'unknown'}kg
`;
  }

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"\n`;
    }
  }

  if (prevProgram) {
    prompt += `\nPREVIOUS WEEK SUMMARY:\n${prevProgram.notes || 'No notes'}\n`;
  }

  prompt += `
RULES:
- Create a progressive program appropriate for week ${weekNo}
- Never recommend extreme calorie deficits (below BMR - 500)
- Never recommend banned/dangerous substances
- Never promise specific weight loss timelines
- If the client reported injuries or pain, adapt exercises accordingly
- Include warm-up and cool-down guidance
- Set realistic, evidence-based targets

OUTPUT FORMAT (JSON only):
{
  "workoutPlan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutritionPlan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 65,
    "hydration": "3-4 liters per day",
    "meals": [
      {
        "time": "8:00 AM",
        "name": "Breakfast",
        "description": "Oats with whey protein, banana, and almonds",
        "macros": { "protein": 40, "carbs": 50, "fat": 15 }
      }
    ],
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  },
  "notes": "Focus areas and coach notes for this week",
  "flagged": false,
  "flagReason": null
}`;

  return prompt;
}

function parseResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.nutritionPlan && parsed.nutritionPlan.calories < 800) {
      return { ...parsed, flagged: true, flagReason: 'Extremely low calorie recommendation' };
    }

    return parsed;
  } catch (err) {
    console.error('Failed to parse Claude response:', err.message);
    return {
      workoutPlan: { days: [] },
      nutritionPlan: { calories: 0, protein: 0, carbs: 0, fat: 0, meals: [] },
      notes: 'Program generation failed — manual review required',
      flagged: true,
      flagReason: 'Failed to parse AI response'
    };
  }
}
