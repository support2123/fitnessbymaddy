const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { generateProgramPDF, uploadPDF } = require('./_lib/pdf');
const { sendMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, getLanguage } = require('./_lib/market');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /under\s*1[0-2]00\s*cal/i,
  /clenbuterol/i, /dnp/i, /ephedrine/i, /sarms/i, /steroids/i,
  /lose\s*\d+\s*kg\s*in\s*(1|2|3)\s*day/i,
  /extreme\s*(fast|cut|diet)/i
];

function isSafeProgram(plan) {
  const text = JSON.stringify(plan);
  return !UNSAFE_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('clients')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (_) {}

    const market = detectMarket(client.phone);
    const lang = getLanguage(market);

    const systemPrompt = `You are a NASM-certified fitness coach assistant for "Fitness by Maddy."
Your job: generate a weekly training + nutrition program for a client.

RULES:
- Programs must be safe, evidence-based, and realistic
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adapt to client's equipment, injuries, and preferences
- ${lang === 'hinglish' ? 'Write coach notes in Hinglish (Hindi+English mix)' : 'Write in clear English'}

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "macros": { "protein": 140, "carbs": 180, "fat": 60 },
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg", "1 cup oats with berries"],
        "notes": ""
      }
    ]
  },
  "notes": "Coach note for the client about this week's focus"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age}
- Gender: ${intakeData.gender}
- Height: ${intakeData.height}
- Goal: ${intakeData.goal}
- Equipment: ${intakeData.equipment_access}
- Available days: ${intakeData.available_days}
- Diet preference: ${intakeData.diet_preference}
- Injuries: ${intakeData.injuries || 'None'}
- Experience: ${intakeData.workout_experience}` : '- No intake data available — generate a balanced general program'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins — this is Week 1.'}

Generate the complete Week ${week_no} program now.`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const content = response.content[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (!isSafeProgram(parsed)) {
      console.error(`UNSAFE program detected for ${maskPhone(client.phone)}, week ${week_no}`);
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        client.phone,
        'Unsafe program flagged — needs manual review',
        `Week ${week_no} for ${client.name}. Auto-generation halted.`
      );
      return res.status(422).json({ error: 'Program flagged for safety review' });
    }

    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes
      })
      .select()
      .single();

    const contextNote = parsed.notes
      ? parsed.notes.slice(0, 160)
      : `Week ${week_no} program is ready!`;

    await sendMessage(client.phone, `program_week_${lang === 'hinglish' ? 'hi' : 'en'}`, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no), contextNote]
    }, pdfUrl);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
