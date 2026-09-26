export const meta = {
  name: 'research-gauntlet',
  description: 'Six parallel cited-research agents for a DECODE episode: anatomy, stakes/protection, importance, mistakes, skip/myths, history',
  whenToUse: 'Strike 1 of every episode. args = {topic, briefs?} — briefs optionally overrides the six angle briefs.',
  phases: [{ title: 'Research' }],
}
const TOPIC = args?.topic
if (!TOPIC) throw new Error('args.topic required')
const ANGLES = args?.briefs || [
  { key: 'anatomy', name: `WHAT ${TOPIC} REALLY IS (anatomy/physiology)`, brief: 'The real structure and mechanism, named muscles/organs/systems, the landmark lab studies with numbers.' },
  { key: 'stakes', name: `PROTECTION AND STAKES — what goes wrong without it`, brief: 'Injury, disease and disability data; the strongest prospective/RCT evidence; global burden numbers.' },
  { key: 'importance', name: `IMPORTANCE AND PERFORMANCE — why it matters as much as anything else`, brief: 'Force transfer, performance meta-analyses, longevity/function links, trainability evidence (MRI/EMG).' },
  { key: 'mistakes', name: `MISTAKES PEOPLE MAKE`, brief: 'The controlled experiments that killed popular methods; injury data on common exercises; institutional reversals.' },
  { key: 'skip', name: `WHY PEOPLE SKIP IT + VISIBILITY MYTHS`, brief: 'The "X is enough" debates settled by data; genetics vs training splits; visibility thresholds.' },
  { key: 'history', name: `HISTORY`, brief: 'Who trained this before the word existed; when science arrived; the institutional turning points with dates.' },
]
const FACTS = { type: 'object', properties: {
  angle: { type: 'string' },
  facts: { type: 'array', items: { type: 'object', properties: {
    fact: { type: 'string', description: 'one precise, numeric-where-possible fact' },
    source: { type: 'string', description: 'author/org + year (+ journal); REAL sources only' },
    hook_potential: { type: 'number', description: '1-10 scroll-stopping power on a 2.1M fitness page' },
  }, required: ['fact', 'source', 'hook_potential'] } },
  best_one_liner: { type: 'string' },
}, required: ['angle', 'facts', 'best_one_liner'] }

phase('Research')
const out = await parallel(ANGLES.map(a => () =>
  agent(`Deep, citation-verified research for a world-class fitness-education video on ${TOPIC}. Your angle: ${a.name}.\n${a.brief}\nRules: 8-12 facts, each with a real citation (author + year + journal/org). Numbers over adjectives. If a claim is famous but shaky, say so in the fact. No invented sources — an uncertain citation must be marked "verify".`,
    { label: `research:${a.key}`, phase: 'Research', schema: FACTS, effort: 'high' })))
const ok = out.filter(Boolean)
log(`angles done: ${ok.length}/6`)
return ok

