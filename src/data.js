/* ============================================================
   MONARCH — seed data
   Baseline routine transcribed from Prabhav's stated weekday.
   Everything here is editable in-app; this is only the start.
   ============================================================ */

export const MISSION = {
  hunter: "Prabhav",
  bodyStart: "2026-07-22",
  bodyDays: 150,
  startWeight: 84,
  goalWeight: 72,
  height: 175,
  targets: { kcal: 2150, protein: 160, proteinTick: 135, water: 3.5, sleepBy: "22:00" },
  cfStart: 1327,
  cfGoal: 2000,
};

export const DEFAULT_PROGRESSION = {
  cfBand: 1500,
  hullPages: 15,
  teasers: 2,
};

/* ---------- quest templates ----------
   slot drives ordering through the day.
   xp is face value; shadows multiply it at award time.        */

const WAKE = { key: "wake", title: "Wake at 05:00", detail: "The day starts here.", stat: "VIT", xp: 10, slot: 1 };
const SLEEP = { key: "sleep", title: "Lights out by 22:00", detail: "Seven hours is the floor, not the target", stat: "VIT", xp: 15, slot: 12 };
const PROTEIN = { key: "protein", title: "Hit protein floor", detail: "135 g minimum, 160 g target", stat: "VIT", xp: 25, slot: 3 };

const GYM = {
  key: "gym",
  title: "Clear the Strength dungeon",
  detail: "05:30 – 06:45, gym and calisthenics",
  stat: "STR",
  xp: 45,
  slot: 2,
};

const CF_WEEKDAY = {
  key: "cf",
  title: "Codeforces, one problem",
  detail: "08:00 – 09:00. Rating band {cfBand}–{cfBandTop}. Timebox 45 minutes, then editorial and reimplement from scratch.",
  stat: "AGI",
  xp: 30,
  slot: 4,
};

const TEASERS = {
  key: "teasers",
  title: "Brainteasers on the commute",
  detail: "On the commute. {teasers} from Brainstellar or Zhou.",
  stat: "PER",
  xp: 25,
  slot: 5,
};

/* The nine hours that are already spent. Framed as the work rather than the
   attendance on purpose: turning up is not a choice on a Tuesday, and a quest
   that cannot be failed is free XP that quietly lowers the bar for everything
   else on the board. */
const OFFICE = {
  key: "office",
  title: "Office block",
  detail: "Nine hours. The quest is what you shipped, not that you were there.",
  stat: "INT",
  xp: 45,
  slot: 6,
};

/* Career work, every day, deliberately small. A daily half hour that never
   slips beats a Saturday marathon that gets skipped when the week runs long.
   What it is spent on rotates; that it happens does not. */
const CAREER_DAILY = {
  key: "career_daily",
  title: "Career block",
  detail: "30 – 45 minutes. One of: a live project, a paper, LinkedIn, an application, the CV.",
  stat: "PER",
  xp: 30,
  slot: 7,
};

/* The weekend has the hours the week does not. Split in two because building
   the thing and telling people it exists are different work, and the second
   is the one that quietly never gets done. */
const CAREER_PROJECT = {
  key: "career_project",
  title: "Live project block",
  detail: "Two hours. Something that ends up on the CV — shipped, not started.",
  stat: "AGI",
  xp: 70,
  slot: 6,
};

const CAREER_ADMIN = {
  key: "career_admin",
  title: "Applications and profile",
  detail: "One hour. Applications, LinkedIn, the CV, research, or reaching out to a person.",
  stat: "PER",
  xp: 40,
  slot: 7,
};

const HULL_EVE = {
  key: "hull_eve",
  title: "Options block",
  detail: "19:00 – 20:00. Hull, {hullPages} pages. Worked problems count double towards depth.",
  stat: "INT",
  xp: 60,
  slot: 8,
};

const MATHS_NIGHT = {
  key: "maths_night",
  title: "Second study block",
  detail: "20:30 – 21:30. {hullPages} pages, or the derivation you owe from this morning.",
  stat: "INT",
  xp: 60,
  slot: 9,
};

const WEEKDAY = [WAKE, GYM, PROTEIN, CF_WEEKDAY, TEASERS, OFFICE, CAREER_DAILY, HULL_EVE, MATHS_NIGHT, SLEEP];

/* Monday takes the extra block. It is the day with the most left in the tank
   and the one that sets what the rest of the week believes is normal. */
const STUDY_THIRD = {
  key: "study_third",
  title: "Third study block",
  detail: "Monday only. The chapter you have been putting off, not the easy revision.",
  stat: "INT",
  xp: 55,
  slot: 10,
};

const MONDAY = [...WEEKDAY.slice(0, -1), STUDY_THIRD, SLEEP];

const SATURDAY = [
  WAKE,
  GYM,
  PROTEIN,
  {
    key: "cf_virtual",
    title: "Enter a virtual round",
    detail: "Two hours, Div 2, rounds 700–900. Contest clock is its own skill.",
    stat: "AGI",
    xp: 55,
    slot: 4,
  },
  { ...TEASERS, xp: 30 },
  CAREER_PROJECT,
  CAREER_ADMIN,
  { ...CAREER_DAILY, slot: 8 },
  {
    key: "deep_int",
    title: "Deep options block",
    detail: "Two hours uninterrupted. Derivation on blank paper, no book open.",
    stat: "INT",
    xp: 105,
    slot: 9,
  },
  SLEEP,
];

const SUNDAY = [
  WAKE,
  {
    key: "rest",
    title: "Take the rest day",
    detail: "No gym. Recovery is a move, not a gap.",
    stat: "VIT",
    xp: 40,
    slot: 2,
  },
  PROTEIN,
  {
    key: "cf_upsolve",
    title: "Upsolve yesterday's C and D",
    detail: "While the problem is still in your head. This is where the rating actually comes from.",
    stat: "AGI",
    xp: 35,
    slot: 4,
  },
  { ...TEASERS, xp: 30 },
  CAREER_PROJECT,
  CAREER_ADMIN,
  { ...CAREER_DAILY, slot: 8 },
  {
    key: "deep_int",
    title: "Deep maths block",
    detail: "Two hours. Shreve, or the Hull chapter you skimmed.",
    stat: "INT",
    xp: 95,
    slot: 9,
  },
  {
    key: "review",
    title: "Weekly review",
    detail: "Weight, waist, photo, and next week's plan",
    stat: "VIT",
    xp: 35,
    slot: 11,
  },
  SLEEP,
];

// 0 = Sunday
export const DEFAULT_TEMPLATES = {
  0: SUNDAY,
  1: MONDAY,
  2: WEEKDAY,
  3: WEEKDAY,
  4: WEEKDAY,
  5: WEEKDAY,
  6: SATURDAY,
};

/* ---------- training split ----------
   Two shapes are supported per weekday.

     items      legacy checklist. One string per line, tick it and move on.
     exercises  logged mode. Every set records load and reps, and the
                progression engine reads that history to set the next target.

   A day moves from the first shape to the second once its real lifts are
   known. Anything still on `items` behaves exactly as it did before.        */

export const TRAINING = {
  1: {
    name: "Chest, triceps and core",
    exercises: [
      {
        key: "treadmill-incline",
        name: "Treadmill, incline walk",
        group: "Cardio",
        kind: "cardio",
        note: "No stopping. One dial moves per session, never two.",
        start: { min: 10, incline: 11, speed: 4.7 },
        caps: { min: 20, incline: 15, speed: 6 },
        steps: { min: 1, incline: 0.5, speed: 0.1 },
      },
      {
        key: "bench-press",
        name: "Bench press",
        group: "Chest",
        kind: "load",
        sets: 3,
        repRange: [8, 12],
        step: 2.5,
        start: { kg: 55 },
      },
      {
        key: "incline-db-press",
        name: "Incline dumbbell press",
        group: "Chest",
        kind: "load",
        unit: "per hand",
        sets: 3,
        repRange: [10, 15],
        step: 2.5,
        start: { kg: 17.5, reps: 15 },
      },
      {
        key: "lower-chest",
        name: "Decline press",
        group: "Chest",
        kind: "load",
        sets: 2,
        repRange: [10, 12],
        ceiling: 15,
        step: 2.5,
        start: {},
      },
      {
        key: "triceps-1",
        name: "Triceps pushdown",
        group: "Triceps",
        kind: "load",
        sets: 2,
        repRange: [10, 15],
        step: 2.5,
        start: {},
      },
      {
        key: "triceps-2",
        name: "Overhead triceps extension",
        group: "Triceps",
        kind: "load",
        sets: 2,
        repRange: [10, 15],
        step: 2.5,
        start: {},
      },
      {
        key: "russian-twist",
        name: "Russian twists",
        group: "Core",
        kind: "reps",
        sets: 2,
        repRange: [20, 30],
        step: 2,
        start: { reps: 20 },
      },
      {
        key: "leg-raise",
        name: "Leg raises",
        group: "Core",
        kind: "reps",
        sets: 2,
        repRange: [15, 25],
        step: 2,
        start: { reps: 15 },
      },
      {
        key: "plank",
        name: "Plank",
        group: "Core",
        kind: "hold",
        sets: 2,
        secRange: [45, 90],
        step: 5,
        start: { sec: 45 },
      },
    ],
  },
  2: {
    name: "Legs and core",
    items: ["Squats 4×25", "Bulgarian split squat 3×12/leg", "Jump squats 3×15", "Calf raises 4×25", "Russian twists 3×30", "Leg raises 3×15"],
  },
  3: {
    name: "Pull and core",
    items: ["Pull-ups 5×max", "Chin-ups 3×max", "Australian rows 3×12", "Dead hang 3×max", "Hollow hold 3×40s", "Bicycle crunch 3×30"],
  },
  4: {
    name: "Metabolic HIIT",
    items: ["Burpees 5×15", "Mountain climbers 5×40", "High knees 5×45s", "Jump rope 5×60s", "Rest 45s between rounds"],
  },
  5: {
    name: "Full-body circuit",
    items: ["Circuit ×4: push-ups 15", "Squats 20", "Pull-ups 5", "Lunges 20", "Plank 45s", "Burpees 10"],
  },
  6: {
    name: "Cardio and core",
    items: ["Run 4–5 km", "Plank complex 3 rounds", "Side plank 3×45s/side", "Flutter kicks 3×40", "Stretch 10 min"],
  },
  0: {
    name: "Active recovery",
    items: ["Walk 30–40 min", "Full mobility flow 15 min", "Deep stretch 15 min"],
  },
};

/* ---------- sessions logged before the app tracked loads ----------
   Applied once, by date, when SEEDS_VERSION rises. A `null` rep count is a
   real gap in the record rather than a zero — the progression engine will
   ask for it instead of guessing a target from it.                          */

export const SEEDS_VERSION = 1;

export const SEED_SESSIONS = {
  "2026-08-31": {
    "treadmill-incline": { cardio: { min: 10, incline: 11, speed: 4.7, nonstop: true } },
    "bench-press": [{ kg: 55, reps: null }, { kg: 55, reps: null }, { kg: 55, reps: null }],
    "incline-db-press": [{ kg: 17.5, reps: 15 }, { kg: 17.5, reps: 15 }, { kg: 17.5, reps: 15 }],
    "lower-chest": [{ kg: null, reps: 12 }, { kg: null, reps: 12 }],
    "triceps-1": [{ kg: null, reps: null }, { kg: null, reps: null }],
    "triceps-2": [{ kg: null, reps: null }, { kg: null, reps: null }],
    "russian-twist": [{ reps: 20 }, { reps: 20 }],
    "leg-raise": [{ reps: 15 }, { reps: 15 }],
    plank: [{ sec: 45 }, { sec: 45 }],
  },
};

/* ---------- food database (Indian vegetarian) ----------
   base = one serving in the stated unit                        */

export const FOODS = [
  { name: "Roti / chapati", base: 1, unit: "piece", kcal: 104, protein: 3.1, carbs: 20, fat: 1.4 },
  { name: "Rice, cooked", base: 100, unit: "g", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { name: "Dal, cooked", base: 150, unit: "g", kcal: 165, protein: 9, carbs: 24, fat: 3 },
  { name: "Rajma, cooked", base: 150, unit: "g", kcal: 190, protein: 11, carbs: 30, fat: 1.5 },
  { name: "Chana, boiled", base: 100, unit: "g", kcal: 164, protein: 9, carbs: 27, fat: 2.6 },
  { name: "Paneer", base: 100, unit: "g", kcal: 265, protein: 18, carbs: 3.4, fat: 21 },
  { name: "Curd / dahi", base: 100, unit: "g", kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { name: "Greek yoghurt", base: 100, unit: "g", kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  { name: "Milk, toned", base: 250, unit: "ml", kcal: 145, protein: 8, carbs: 12, fat: 6.5 },
  { name: "Whey scoop", base: 1, unit: "scoop", kcal: 120, protein: 24, carbs: 3, fat: 1.5 },
  { name: "Egg, whole boiled", base: 1, unit: "egg", kcal: 78, protein: 6.3, carbs: 0.6, fat: 5.3 },
  { name: "Egg white", base: 1, unit: "white", kcal: 17, protein: 3.6, carbs: 0.2, fat: 0.1 },
  { name: "Soya chunks, dry", base: 50, unit: "g", kcal: 172, protein: 26, carbs: 16, fat: 0.5 },
  { name: "Tofu", base: 100, unit: "g", kcal: 144, protein: 15, carbs: 3, fat: 9 },
  { name: "Peanuts", base: 30, unit: "g", kcal: 170, protein: 7.7, carbs: 4.8, fat: 14 },
  { name: "Peanut butter", base: 30, unit: "g", kcal: 180, protein: 7.5, carbs: 6, fat: 15 },
  { name: "Almonds", base: 20, unit: "g", kcal: 116, protein: 4.2, carbs: 4.4, fat: 10 },
  { name: "Oats, dry", base: 50, unit: "g", kcal: 190, protein: 6.5, carbs: 33, fat: 3.5 },
  { name: "Poha, cooked", base: 200, unit: "g", kcal: 250, protein: 5, carbs: 48, fat: 4 },
  { name: "Upma", base: 200, unit: "g", kcal: 260, protein: 6, carbs: 42, fat: 7 },
  { name: "Idli", base: 2, unit: "piece", kcal: 116, protein: 4, carbs: 24, fat: 0.4 },
  { name: "Dosa, plain", base: 1, unit: "piece", kcal: 168, protein: 4, carbs: 29, fat: 4 },
  { name: "Sambar", base: 150, unit: "g", kcal: 105, protein: 5, carbs: 15, fat: 3 },
  { name: "Mixed sabji", base: 150, unit: "g", kcal: 120, protein: 3.5, carbs: 12, fat: 6.5 },
  { name: "Palak paneer", base: 150, unit: "g", kcal: 230, protein: 12, carbs: 9, fat: 17 },
  { name: "Chole", base: 150, unit: "g", kcal: 210, protein: 9, carbs: 28, fat: 7 },
  { name: "Khichdi", base: 250, unit: "g", kcal: 290, protein: 10, carbs: 48, fat: 6 },
  { name: "Sprouts salad", base: 100, unit: "g", kcal: 95, protein: 8, carbs: 15, fat: 0.6 },
  { name: "Banana", base: 1, unit: "medium", kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  { name: "Apple", base: 1, unit: "medium", kcal: 95, protein: 0.5, carbs: 25, fat: 0.3 },
  { name: "Orange", base: 1, unit: "medium", kcal: 62, protein: 1.2, carbs: 15, fat: 0.2 },
  { name: "Papaya", base: 150, unit: "g", kcal: 65, protein: 0.7, carbs: 16, fat: 0.4 },
  { name: "Cucumber", base: 100, unit: "g", kcal: 16, protein: 0.7, carbs: 3.6, fat: 0.1 },
  { name: "Salad, mixed raw", base: 150, unit: "g", kcal: 45, protein: 2, carbs: 8, fat: 0.5 },
  { name: "Ghee", base: 1, unit: "tsp", kcal: 45, protein: 0, carbs: 0, fat: 5 },
  { name: "Cooking oil", base: 1, unit: "tsp", kcal: 40, protein: 0, carbs: 0, fat: 4.5 },
  { name: "Brown bread", base: 2, unit: "slice", kcal: 160, protein: 6, carbs: 28, fat: 2.4 },
  { name: "Paratha, plain", base: 1, unit: "piece", kcal: 210, protein: 5, carbs: 30, fat: 8 },
  { name: "Besan chilla", base: 2, unit: "piece", kcal: 210, protein: 11, carbs: 24, fat: 8 },
  { name: "Moong dal chilla", base: 2, unit: "piece", kcal: 190, protein: 12, carbs: 22, fat: 6 },
  { name: "Buttermilk", base: 250, unit: "ml", kcal: 60, protein: 3, carbs: 6, fat: 2.5 },
  { name: "Lassi, sweet", base: 250, unit: "ml", kcal: 220, protein: 7, carbs: 32, fat: 6.5 },
  { name: "Tea with milk", base: 1, unit: "cup", kcal: 65, protein: 2, carbs: 8, fat: 2.5 },
  { name: "Coffee with milk", base: 1, unit: "cup", kcal: 70, protein: 2.5, carbs: 8, fat: 3 },
  { name: "Dry fruits mix", base: 30, unit: "g", kcal: 150, protein: 4, carbs: 15, fat: 9 },
  { name: "Makhana, roasted", base: 30, unit: "g", kcal: 105, protein: 3, carbs: 23, fat: 0.3 },
  { name: "Dark chocolate", base: 20, unit: "g", kcal: 120, protein: 1.5, carbs: 10, fat: 8 },
];

/* ---------- gates seeded from known dates ---------- */

export const SEED_GATES = [
  {
    id: "g_body",
    name: "Operation −12kg closes",
    rank: "B",
    date: "2026-12-19",
    note: "Day 150. 84 → 72 kg.",
    cleared: false,
  },
  {
    id: "g_hull",
    name: "Hull chapters 10–21",
    rank: "C",
    date: "2026-09-28",
    note: "Options block complete, derivations reproducible on blank paper.",
    cleared: false,
  },
  {
    id: "g_cf1500",
    name: "Codeforces 1500",
    rank: "D",
    date: "2026-11-30",
    note: "First checkpoint on the road to 2000.",
    cleared: false,
  },
  {
    id: "g_baruch",
    name: "Baruch MFE, Round 1",
    rank: "S",
    date: "2027-11-01",
    note: "The gate at the end of the map.",
    cleared: false,
  },
];

export const SEED_SHADOWS = [];

export const SHADOW_PRESETS = [
  { name: "C++ limit order book engine", stat: "AGI", bonus: 6 },
  { name: "Delta-hedging simulator", stat: "INT", bonus: 6 },
  { name: "Implied vol solver", stat: "INT", bonus: 5 },
  { name: "Binomial pricer", stat: "INT", bonus: 4 },
  { name: "Alpha research pipeline", stat: "AGI", bonus: 5 },
  { name: "Portfolio optimiser", stat: "INT", bonus: 4 },
];

/* ---------- the System's voice ----------
   Written for this app rather than quoted from the manhwa. Lines from a
   copyrighted work cannot ship in something that gets deployed, and the
   register is the part that actually carries — flat, declarative, addressed to
   one person who already knows what they owe. Quoting someone else's dialogue
   would fit worse than this does.

   Grouped by when they earn their place. A line that appears at the wrong
   moment reads as decoration; the same line after a broken day reads as the
   System noticing.                                                            */

export const QUOTES = {
  daily: [
    "The gap between who you are and who you intend to be is measured in days like this one.",
    "Nobody is coming to raise the floor. Raise it.",
    "Strength is not granted. It is accumulated, quietly, by someone with nothing to prove that morning.",
    "The work does not care whether you feel ready.",
    "You are not behind. You are exactly as far along as the days you have actually done.",
    "Every level you have was bought at the price of a day you did not want to start.",
    "Discipline is what remains after motivation has finished making promises.",
    "The System does not reward intent.",
    "Repetition is the only magic that has ever worked.",
    "You do not rise to the occasion. You fall to the standard you kept when no one was watching.",
    "A hunter who trains only when it is convenient stays exactly the rank they started at.",
    "The hardest gate is the one that opens at five in the morning.",
  ],
  cleared: [
    "Day cleared. The floor is now higher than it was.",
    "Logged. This is what accumulation looks like from the inside — unremarkable.",
    "Nothing dramatic happened. That is the point.",
    "One more day the System could not fault.",
  ],
  broken: [
    "The day closed short. It has been charged. Nothing is owed beyond starting again.",
    "A lapse is data, not a verdict. What does tomorrow look like.",
    "You did not fail the system. You skipped an entry. Make the next one.",
    "The streak is gone. The levels are not.",
  ],
  levelUp: [
    "Level up. The bar moves with you — this is not a place to rest.",
    "Stronger than the version of you that started this week.",
    "Growth registered. It will not feel like anything. It never does.",
  ],
  rankUp: [
    "Rank promoted. Everything below this is now your baseline, not your ceiling.",
    "You have outgrown the person who set these targets. Set harder ones.",
  ],
  shadow: [
    "Arise.",
    "Shipped work never leaves you. It compounds.",
    "Extracted. It pays for itself from here on.",
  ],
  focus: [
    "The hours did not vanish. They were spent, and something received them.",
    "Attention is the only currency you cannot earn back.",
    "The feed is a gate you enter voluntarily and leave weaker.",
  ],
};

/** Deterministic pick, so the line of the day does not change on every render. */
export function quoteFor(bucket, seed = "") {
  const list = QUOTES[bucket] || QUOTES.daily;
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ---------- seasons ----------
   Ninety days, because it is long enough that a bad week does not decide it and
   short enough to stay in view. The goals are deliberately few. A season with
   nine targets is a wish list; one with four is a commitment.                  */

export const SEASON_LENGTH = 90;

export const SEASON_GOAL_TYPES = [
  { type: "cleanDays", label: "Clean days", unit: "days", hint: "Days graded clean — everything chargeable, done." },
  { type: "clearedDays", label: "Days cleared", unit: "days", hint: "Days that met the clear bar for your difficulty." },
  { type: "training", label: "Training sessions", unit: "sessions", hint: "Days with anything logged in the dungeon." },
  { type: "shadows", label: "Shadows extracted", unit: "shipped", hint: "Projects finished and extracted during the season." },
  { type: "gates", label: "Gates cleared", unit: "gates", hint: "Deadlines met inside the window." },
  { type: "level", label: "Reach level", unit: "level", hint: "Absolute level by the end of the season." },
  { type: "statXp", label: "Stat experience", unit: "xp", hint: "Total experience in one stat." },
  { type: "streak", label: "Best streak", unit: "days", hint: "Longest unbroken run reached during the season." },
];

export function defaultSeason(startKey, endKey) {
  return {
    id: `s-${startKey}`,
    name: "Season I — Foundation",
    startKey,
    endKey,
    goals: [
      { key: "g1", type: "clearedDays", label: "Clear 70 of 90 days", target: 70 },
      { key: "g2", type: "training", label: "Train 75 sessions", target: 75 },
      { key: "g3", type: "shadows", label: "Ship 3 projects", target: 3 },
      { key: "g4", type: "streak", label: "Hold a 21 day streak", target: 21 },
    ],
  };
}

/* ---------- reminders ----------
   Exported to the phone's calendar as repeating events with alarms, because
   that is the only thing that rings when the app is closed. Times are the
   defaults; they are editable in the app.                                     */

export const DEFAULT_REMINDERS = [
  { id: "wake", title: "Rise", body: "The day is generated. Open the board.", time: "05:00", mins: 15, on: true },
  { id: "train", title: "Dungeon", body: "Training block. Log every set.", time: "06:00", mins: 75, on: true },
  { id: "study", title: "Deep work", body: "The block that actually moves the rating.", time: "09:30", mins: 120, on: true },
  { id: "checkin", title: "Midday check", body: "Where does the board stand.", time: "13:00", mins: 10, on: false },
  { id: "close", title: "Close the day", body: "Anything still open closes in three hours.", time: "19:00", mins: 15, on: true },
  { id: "sleep", title: "Lights out", body: "Seven hours is part of the work.", time: "22:00", mins: 10, on: true },
];

/* ---------- focus ----------
   The app cannot block anything. It can hold you to a number you set yourself
   and show you the cost, which is a different mechanism and an honest one.     */

export const FOCUS_TARGETS = [
  { id: "instagram", label: "Instagram", cap: 20 },
  { id: "chess", label: "Chess", cap: 30 },
  { id: "youtube", label: "YouTube", cap: 30 },
  { id: "other", label: "Other scrolling", cap: 15 },
];
