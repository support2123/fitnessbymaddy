const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { generateProgramPDF, formatProgram } = require('./lib/pdf');
const { sendMedia } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 cal', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme cut', 'water fast', 'zero carb'
];

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for FitnessByMaddy, an elite online fitness coaching brand. You generate weekly personalized workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Base recommendations on NASM guidelines and evidence-based practice
- Consider injuries, age, and medical conditions
- Progressive overload week to week
- Always include rest days

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 67,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "3 whole eggs, 2 toast, 1 banana" }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase bench press by 2.5kg from last week."
}`;

    const userPrompt = buildUserPrompt(client, week_no, recentCheckins, prevPrograms);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    for (const flag of SAFETY_FLAGS) {
      if (rawOutput.toLowerCase().includes(flag)) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: `Safety flag in generated program: "${flag}"`,
          message_body: `Week ${week_no} program for ${client.name || client.phone} contained risky content`
        });
        return res.status(200).json({ action: 'flagged_for_review', flag });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const { workout_plan, nutrition_plan, notes } = parsed;

    const pdfBuffer = await generateProgramPDF(client, week_no, workout_plan, nutrition_plan, notes);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
      pdfUrl = urlData.publicUrl;
    }

    await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes
    }, { onConflict: 'client_id,week_no' });

    if (pdfUrl) {
      const contextNote = notes
        ? notes.split('.')[0] + '.'
        : `Here's your Week ${week_no} program!`;

      await sendMedia(client.phone, pdfUrl, contextNote);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({
      action: 'program_generated',
      week_no,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildUserPrompt(client, weekNo, checkins, prevPrograms) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${formatProgram(client.program)}\n`;
  if (client.age) prompt += `Age: ${client.age}\n`;
  if (client.goal) prompt += `Goal: ${client.goal}\n`;
  if (client.injuries) prompt += `Injuries/Conditions: ${client.injuries}\n`;
  if (client.diet_preference) prompt += `Diet Preference: ${client.diet_preference}\n`;
  if (client.schedule) prompt += `Available Schedule: ${client.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const ci of checkins) {
      prompt += `  Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}kg, Waist ${ci.waist || 'N/A'}cm, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      prompt += `\n`;
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    const prev = prevPrograms[0];
    prompt += `\nPrevious week notes: ${prev.notes || 'None'}\n`;
  }

  prompt += `\nRespond with ONLY the JSON object. No explanation or markdown.`;
  return prompt;
}
