// OpenHand Fortune Cookie Plugin
//
// A deliberately silly companion plugin: it returns a one-line aphorism in
// the caller's chosen mood. 200 lines are baked in (split across three
// moods). NO LLM call, NO network, NO file I/O. Useful as:
//
//   * a smoke-test plugin in CI (cheap, deterministic with a seed)
//   * an opening line for chat sessions
//   * a "did the plugin loader actually pick this up?" sanity check
//
// API:
//   tools[0] = fortune_get
//     params:
//       mood: 'uplifting' | 'skeptical' | 'philosophical' (default 'uplifting')
//       seed: optional integer; when set, picks deterministically.
//     returns: { mood, fortune, index, total }
//
// The library is hand-curated public-domain proverbs and original lines.
// Do NOT load this from disk at runtime — keeping it inline guarantees the
// plugin works under sandbox restrictions (`fs:read` not granted).

'use strict';

const UPLIFTING = Object.freeze([
  'Small steps still move mountains.',
  'The expert in anything was once a beginner.',
  'A ship in port is safe, but that is not what ships are for.',
  'Today is a chance to start over with the lessons of yesterday.',
  'Courage is grace under pressure.',
  'The best time to plant a tree was twenty years ago. The second best time is now.',
  'Done is better than perfect.',
  'You cannot pour from an empty cup — rest is part of the work.',
  'Progress, not perfection.',
  'The only way out is through.',
  'Be the friend you wish you had at your last 3 a.m.',
  'Every master was once a disaster.',
  'Showing up is half the battle; the other half is staying.',
  'You don’t have to be great to start, but you have to start to be great.',
  'Bravery is not the absence of fear; it’s moving forward with it.',
  'Each mistake is a teacher in disguise.',
  'The view from the summit belongs to those who keep climbing.',
  'A clear conscience makes a soft pillow.',
  'Fall seven times, stand up eight.',
  'Hope is the thing with feathers — feed it.',
  'You are allowed to grow at your own pace.',
  'When in doubt, choose kindness.',
  'A small light in a dark room changes everything.',
  'You are the author of your next chapter.',
  'Trust the slow work of becoming.',
  'You can rest and still be a fighter.',
  'The river cuts the rock not by force but by persistence.',
  'Whatever you are, be a good one.',
  'You don’t need a permission slip to begin.',
  'Old roads will not lead to new places.',
  'A bend in the road is not the end of the road — unless you fail to make the turn.',
  'Action is the antidote to anxiety.',
  'Bloom where you are planted; replanting is also allowed.',
  'Quiet effort compounds.',
  'Better to light a candle than curse the darkness.',
  'The best apology is changed behaviour.',
  'A goal without a date is just a wish — pencil it in.',
  'Courage is contagious; pass it on.',
  'You can’t edit a blank page, so write badly first.',
  'Storms make trees take deeper roots.',
  'Today’s small win is tomorrow’s foundation.',
  'A kind word leaves a long echo.',
  'You are stronger than the story you’re telling yourself.',
  'Tend to the present and the future tends to itself.',
  'Be patient with what is unfolding inside you.',
  'Even on slow days, the compass still points north.',
  'A broken crayon still colours.',
  'The hardest part is starting; you’re past that now.',
  'Keep going — you didn’t come this far to only come this far.',
  'Soft hearts in hard times move the world.',
  'Discipline is choosing what you want most over what you want now.',
  'You can begin again, and again, and again.',
  'Look how far you’ve come — even on the days it didn’t feel like much.',
  'A little progress each day adds up to big results.',
  'It’s okay to be a work in progress and a masterpiece at the same time.',
  'You belong here.',
  'The sun does not rush, yet everything is accomplished.',
  'Rest is not a reward — it’s a requirement.',
  'Be gentle; you are meeting parts of yourself for the first time.',
  'A boat doesn’t sink because it’s in water; it sinks when water gets in. Watch what you let in.',
  'You owe it to your past self to keep going.',
  'Hard work in silence makes loud results.',
  'Even the longest night ends with a sunrise.',
  'Plant the seed before you need the shade.',
  'There is no traffic jam on the extra mile.',
  'You don’t find your purpose; you build it brick by brick.',
  'Begin where you are, with what you have, and keep going.',
]);

const SKEPTICAL = Object.freeze([
  'Anything that can go wrong, eventually will — and usually at 4 p.m. on a Friday.',
  'A successful demo is just a bug that hasn’t been discovered yet.',
  'Trust, but verify. Then verify again.',
  'Never attribute to malice what is adequately explained by a missing config flag.',
  'The road to production is paved with “it works on my machine.”',
  'Optimism is the absence of data.',
  'If you didn’t write it down, it didn’t happen.',
  'The plan survives until contact with the user.',
  'Every line of code is a future line of debt.',
  'There are no silver bullets — only well-aimed lead ones.',
  'Premature scaling is the root of most evil.',
  'A backup you have never restored is not a backup.',
  'The slowest part of the system is the meeting that designed it.',
  'When everyone is responsible, nobody is.',
  'Cache invalidation, naming things, and off-by-one errors.',
  'If a thing is too good to be true, the changelog will explain why next quarter.',
  '“Quick fix” is just a longer fix in disguise.',
  'A monorepo is a microservice that gave up.',
  'Estimates are wishes pretending to be numbers.',
  'Documentation lies; code reveals.',
  'Hope is not a deployment strategy.',
  'Behind every metric there is a Goodhart waiting to happen.',
  'The bug is never where you’re looking.',
  'Standards are great — that’s why we have so many.',
  'Convenience today, on-call tomorrow.',
  'Anyone who tells you they understand distributed systems is selling something.',
  'The only secure system is one that is unplugged.',
  'A system that cannot fail will fail in unexpected ways.',
  'There is no such thing as a small migration.',
  'If the test passes the first time, suspect the test.',
  'Production is the only environment that actually exists.',
  'Bold claims, weak evidence — proceed with sandals on.',
  '“Should” is the most expensive word in engineering.',
  'Every YAML file grows until it requires its own parser.',
  'Most outages start with “we’ll fix it in the next release.”',
  'A graceful degradation today beats a heroic recovery tomorrow.',
  'Beware the demo gods — they require sacrifices.',
  'If a benchmark isn’t reproducible, it isn’t a benchmark.',
  'Never deploy on Friday, and never trust a Monday rollback either.',
  'Ad-hoc scripts have a way of becoming load-bearing.',
  '“Temporary” is the longest-lived adjective in software.',
  'Performance is what the profiler says, not what you remember.',
  'Comments lie; tests lie too — only behaviour tells the truth.',
  'A flaky test is a feature you don’t understand yet.',
  'Every elegant abstraction has at least one ugly corner.',
  'If two engineers agree, suspect the third hasn’t read the doc.',
  'Optimisation without measurement is decoration.',
  'A roadmap is a hallucination with a calendar.',
  'The simpler the diagram, the more lies it tells.',
  'When a heuristic works ten times, watch out for the eleventh.',
  'No data was harmed in the making of this dashboard — and that’s the problem.',
  'Microservices, microbugs, microdebugging.',
  'Leaky abstractions leak; that’s why they’re called that.',
  'Every retry is a future thundering herd.',
  'A schema you can change is a schema you will change.',
  'Free tier, paid problems.',
  'Convenience is rented; ownership is bought.',
  '“It’s just a small refactor” has ended more careers than caffeine.',
  'A green CI is a snapshot, not a promise.',
  'If you can’t reproduce it, you haven’t fixed it.',
  'New stack, same rake. Same forehead.',
  'A 99.9% SLA is just a confession in basis points.',
  'Configuration is just code that nobody reviewed.',
  'The system that boots quickly is the system that fails quickly.',
  'Magic in your stack is debt with a smile.',
  'Engineering is the art of cutting metal you can’t see with a saw you can’t feel.',
  'Read the changelog. Then read it again.',
]);

const PHILOSOPHICAL = Object.freeze([
  'You cannot step in the same river twice.',
  'The unexamined life is not worth living.',
  'We do not see things as they are; we see them as we are.',
  'Pain is inevitable; suffering is optional.',
  'Be the change you wish to see in the world.',
  'The map is not the territory.',
  'Time is what we want most, but use worst.',
  'I think, therefore I am.',
  'Knowing yourself is the beginning of all wisdom.',
  'Happiness depends upon ourselves.',
  'A wise person speaks because they have something to say; a fool because they have to say something.',
  'Memory is the diary we all carry about with us.',
  'It is the mark of an educated mind to entertain a thought without accepting it.',
  'We suffer more often in imagination than in reality.',
  'No man ever steps into the same regret twice.',
  'Silence is the language of God; all else is poor translation.',
  'When you change the way you look at things, the things you look at change.',
  'The only true wisdom is in knowing you know nothing.',
  'Eternity is in love with the productions of time.',
  'A journey of a thousand miles begins with a single step.',
  'The cave you fear to enter holds the treasure you seek.',
  'You are not a drop in the ocean; you are the entire ocean in a drop.',
  'What we fear we wear, what we love we become.',
  'Do not seek to follow in the footsteps of the wise; seek what they sought.',
  'The fool thinks himself wise, but the wise man knows himself to be a fool.',
  'Between stimulus and response there is a space; in that space is our power.',
  'There are no facts, only interpretations.',
  'To love at all is to be vulnerable.',
  'Whereof one cannot speak, thereof one must be silent.',
  'Form is emptiness; emptiness is form.',
  'Man is condemned to be free.',
  'Hell is other people — and so is heaven.',
  'The river is everywhere at once.',
  'You become responsible, forever, for what you have tamed.',
  'The wound is the place where the light enters you.',
  'What is essential is invisible to the eye.',
  'Stay close to anything that makes you glad you are alive.',
  'Every exit is an entry somewhere else.',
  'In the middle of every difficulty lies opportunity.',
  'Walk with the dreamers, the believers, the courageous, the cheerful.',
  'A person who never made a mistake never tried anything new.',
  'The mind is everything. What you think, you become.',
  'Stillness is not the absence of motion but the presence of attention.',
  'Truth is what stands the test of experience.',
  'Look up at the stars and not down at your feet.',
  'Death is not extinguishing the light; it is putting out the lamp because the dawn has come.',
  'It is in our darkest moments that we must focus to see the light.',
  'You are the universe experiencing itself.',
  'When the student is ready, the teacher will appear.',
  'Be soft. Do not let the world make you hard.',
  'The obstacle is the way.',
  'Not all those who wander are lost.',
  'Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.',
  'Beauty is truth, truth beauty.',
  'A journey is a person in itself; no two are alike.',
  'There is no path to peace; peace is the path.',
  'We are what we repeatedly do; excellence, then, is not an act, but a habit.',
  'Faith is taking the first step even when you don’t see the whole staircase.',
  'The eye sees only what the mind is prepared to comprehend.',
  'Begin doing what you want to do now.',
  'A man is what he thinks about all day long.',
  'The privilege of a lifetime is to become who you truly are.',
  'Out of clutter, find simplicity.',
  'The future depends on what you do today.',
  'You only lose what you cling to.',
  'In the long run, the sharpest weapon of all is a kind and gentle spirit.',
  'Knowing others is intelligence; knowing yourself is true wisdom.',
  'Learn as if you will live forever, live like you will die tomorrow.',
  'The best way out is always through.',
]);

const LIBRARY = Object.freeze({
  uplifting: UPLIFTING,
  skeptical: SKEPTICAL,
  philosophical: PHILOSOPHICAL,
});

const VALID_MOODS = Object.freeze(Object.keys(LIBRARY));

// Total across all moods. Asserted at module load so we never silently
// drift below the advertised "200 baked-in" library size.
const TOTAL = UPLIFTING.length + SKEPTICAL.length + PHILOSOPHICAL.length;
if (TOTAL < 200) {
  throw new Error(`fortune-cookie library shrank below 200 entries (got ${TOTAL})`);
}

// Tiny LCG so callers can pass a numeric seed and get a deterministic pick
// without us having to depend on `crypto` or seedrandom. Good enough for
// "give me a stable fortune in tests".
function lcgPick(seed, length) {
  // Numerical Recipes constants. We just need a uniform-ish output.
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  const next = ((seed >>> 0) * a + c) % m;
  return next % length;
}

function pick(mood, seed) {
  const list = LIBRARY[mood];
  if (!list) {
    throw new Error(
      `invalid mood "${mood}". Expected one of: ${VALID_MOODS.join(', ')}`,
    );
  }
  let index;
  if (seed === undefined || seed === null) {
    index = Math.floor(Math.random() * list.length);
  } else {
    if (!Number.isInteger(seed)) {
      throw new TypeError('seed must be an integer when provided');
    }
    index = lcgPick(seed, list.length);
  }
  return { mood, fortune: list[index], index, total: list.length };
}

module.exports = {
  name: 'fortune-cookie',
  version: '1.0.0',
  description: 'Return a one-liner aphorism in your chosen mood — no LLM, no network.',

  // Exposed for tests and for callers who don't want to go through `tools`.
  pick,
  moods: VALID_MOODS,
  size: TOTAL,

  tools: [
    {
      name: 'fortune_get',
      description:
        'Return one aphorism from a baked-in 200-entry library. Choose a mood: uplifting, skeptical, or philosophical.',
      parameters: [
        {
          name: 'mood',
          type: 'string',
          description: 'One of "uplifting", "skeptical", "philosophical".',
          required: false,
          default: 'uplifting',
        },
        {
          name: 'seed',
          type: 'number',
          description: 'Optional integer seed for deterministic picks.',
          required: false,
        },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        const mood = (params && params.mood) || 'uplifting';
        const seed = params && params.seed;
        return pick(mood, seed);
      },
    },
  ],

  async onEnable() {
    // Nothing to warm up. The library is already in memory.
  },
};
