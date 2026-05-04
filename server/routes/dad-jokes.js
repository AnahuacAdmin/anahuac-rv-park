/*
 * Anahuac RV Park — Dad Joke Alligator 🐊
 * Daily rotating joke, never repeats until full cycle
 */
const router = require('express').Router();
const { db, saveDb } = require('../database');
const { authenticate } = require('../middleware');

// ── Public: get today's joke ──
router.get('/today', (req, res) => {
  try {
    // Auto-seed if table is empty (handles first-run after deploy)
    var count = db.prepare('SELECT COUNT(*) as c FROM dad_jokes').get().c;
    if (count === 0) seedJokes();
  } catch {}

  var today = new Date().toISOString().slice(0, 10);
  // Check if we already picked a joke for today
  var history = db.prepare('SELECT joke_id FROM dad_jokes_history WHERE shown_date=?').get(today);
  if (history) {
    var joke = db.prepare('SELECT id, joke, category FROM dad_jokes WHERE id=?').get(history.joke_id);
    if (joke) {
      joke.reactions = getJokeReactions(joke.id, today);
      return res.json(joke);
    }
  }
  // Pick a random joke not shown in the last 30 days
  var joke = db.prepare(`SELECT id, joke, category FROM dad_jokes
    WHERE active=1 AND id NOT IN (
      SELECT joke_id FROM dad_jokes_history WHERE shown_date > date(?, '-30 days')
    )
    ORDER BY RANDOM() LIMIT 1`).get(today);
  if (!joke) {
    // All jokes used in last 30 days — pick any random active joke
    joke = db.prepare('SELECT id, joke, category FROM dad_jokes WHERE active=1 ORDER BY RANDOM() LIMIT 1').get();
  }
  if (joke) {
    try { db.prepare('INSERT INTO dad_jokes_history (joke_id, shown_date) VALUES (?,?)').run(joke.id, today); saveDb(); } catch {}
    joke.reactions = getJokeReactions(joke.id, today);
    return res.json(joke);
  }
  res.json(null);
});

function getJokeReactions(jokeId, date) {
  var loved = db.prepare("SELECT COUNT(*) as c FROM dad_joke_reactions WHERE joke_id=? AND shown_date=? AND reaction_type='loved'").get(jokeId, date);
  var groan = db.prepare("SELECT COUNT(*) as c FROM dad_joke_reactions WHERE joke_id=? AND shown_date=? AND reaction_type='groan'").get(jokeId, date);
  return { loved: loved?.c || 0, groan: groan?.c || 0 };
}

// ── Public: react to today's joke ──
router.post('/react', (req, res) => {
  var { joke_id, tenant_id, reaction_type } = req.body || {};
  if (!['loved', 'groan'].includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction' });
  if (!tenant_id || !joke_id) return res.status(400).json({ error: 'Missing fields' });
  var today = new Date().toISOString().slice(0, 10);
  // Remove any existing reaction for this tenant+joke+date, then insert
  db.prepare('DELETE FROM dad_joke_reactions WHERE joke_id=? AND tenant_id=? AND shown_date=?').run(joke_id, tenant_id, today);
  db.prepare('INSERT INTO dad_joke_reactions (joke_id, tenant_id, reaction_type, shown_date) VALUES (?,?,?,?)').run(joke_id, tenant_id, reaction_type, today);
  saveDb();
  res.json({ success: true, reactions: getJokeReactions(joke_id, today) });
});

// ── Public: get my reaction for today's joke ──
router.get('/my-reaction', (req, res) => {
  var tenantId = parseInt(req.query.tenant_id);
  var jokeId = parseInt(req.query.joke_id);
  if (!tenantId || !jokeId) return res.json({ reaction: null });
  var today = new Date().toISOString().slice(0, 10);
  var row = db.prepare('SELECT reaction_type FROM dad_joke_reactions WHERE joke_id=? AND tenant_id=? AND shown_date=?').get(jokeId, tenantId, today);
  res.json({ reaction: row ? row.reaction_type : null });
});

// ── Seed jokes if empty ──
router.get('/seed', (req, res) => {
  var count = db.prepare('SELECT COUNT(*) as c FROM dad_jokes').get().c;
  if (count > 0) return res.json({ message: 'Already seeded', count });
  seedJokes();
  var newCount = db.prepare('SELECT COUNT(*) as c FROM dad_jokes').get().c;
  res.json({ message: 'Seeded', count: newCount });
});

// ══════ Admin routes ══════
router.use(authenticate);

// Force rotate today's joke (admin only)
router.post('/force-rotate', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var today = new Date().toISOString().slice(0, 10);
  // Delete today's assignment
  db.prepare('DELETE FROM dad_jokes_history WHERE shown_date=?').run(today);
  // Pick a new random joke
  var joke = db.prepare(`SELECT id, joke, category FROM dad_jokes
    WHERE active=1 AND id NOT IN (
      SELECT joke_id FROM dad_jokes_history WHERE shown_date > date(?, '-30 days')
    )
    ORDER BY RANDOM() LIMIT 1`).get(today);
  if (!joke) joke = db.prepare('SELECT id, joke, category FROM dad_jokes WHERE active=1 ORDER BY RANDOM() LIMIT 1').get();
  if (joke) {
    db.prepare('INSERT INTO dad_jokes_history (joke_id, shown_date) VALUES (?,?)').run(joke.id, today);
    saveDb();
    return res.json({ success: true, joke });
  }
  res.json({ error: 'No jokes available' });
});

router.post('/add', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var { joke, category } = req.body || {};
  if (!joke) return res.status(400).json({ error: 'Joke text required' });
  db.prepare('INSERT INTO dad_jokes (joke, category) VALUES (?,?)').run(joke, category || 'classic');
  saveDb();
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('UPDATE dad_jokes SET active=0 WHERE id=?').run(parseInt(req.params.id));
  saveDb();
  res.json({ success: true });
});

// ── Seed function ──
function seedJokes() {
  var jokes = [
    ["Why don't scientists trust atoms? Because they make up everything!", "pun"],
    ["I told my wife she was drawing her eyebrows too high. She looked surprised.", "classic"],
    ["What do you call a fake noodle? An impasta.", "pun"],
    ["I'm reading a book about anti-gravity. It's impossible to put down.", "pun"],
    ["Why did the scarecrow win an award? Because he was outstanding in his field.", "classic"],
    ["I would tell you a chemistry joke, but I know I wouldn't get a reaction.", "pun"],
    ["Why don't skeletons fight each other? They don't have the guts.", "classic"],
    ["What do you call cheese that isn't yours? Nacho cheese.", "pun"],
    ["How does a penguin build its house? Igloos it together.", "pun"],
    ["I used to play piano by ear, but now I use my hands.", "classic"],
    ["What's brown and sticky? A stick.", "classic"],
    ["Why did the bicycle fall over? Because it was two-tired.", "pun"],
    ["I'm on a seafood diet. I see food and I eat it.", "classic"],
    ["What did one wall say to the other wall? I'll meet you at the corner.", "classic"],
    ["Why did the math book look sad? Because it had too many problems.", "pun"],
    ["I only know 25 letters of the alphabet. I don't know Y.", "pun"],
    ["What do you call a bear with no teeth? A gummy bear.", "pun"],
    ["Why can't a nose be 12 inches long? Because then it would be a foot.", "pun"],
    ["I used to hate facial hair, but then it grew on me.", "pun"],
    ["What do you call a dog that does magic tricks? A Labracadabrador.", "pun"],
    ["I got carded at a liquor store and my Blockbuster card accidentally fell out. The cashier said, 'Never mind.'", "classic"],
    ["What do you call an elephant that doesn't matter? An irrelephant.", "pun"],
    ["Did you hear about the claustrophobic astronaut? He just needed a little space.", "pun"],
    ["Why don't eggs tell jokes? They'd crack each other up.", "pun"],
    ["I'm afraid for the calendar. Its days are numbered.", "pun"],
    ["My wife told me to stop acting like a flamingo. So I had to put my foot down.", "classic"],
    ["Why did the golfer bring two pairs of pants? In case he got a hole in one.", "classic"],
    ["What do you call a factory that makes okay products? A satisfactory.", "pun"],
    ["What did the ocean say to the beach? Nothing, it just waved.", "classic"],
    ["Why do fathers take an extra pair of socks when they go golfing? In case they get a hole in one.", "classic"],
    ["What's the best thing about Switzerland? I don't know, but the flag is a big plus.", "pun"],
    ["I used to be addicted to soap, but I'm clean now.", "pun"],
    ["What do you call a can opener that doesn't work? A can't opener.", "pun"],
    ["I don't play soccer because I enjoy the sport. I'm just doing it for kicks.", "pun"],
    ["Did I tell you the time I fell in love during a backflip? I was heels over head.", "classic"],
    ["People don't like having to bend over to get their drinks. We really need to raise the bar.", "pun"],
    ["A steak pun is a rare medium well done.", "pun"],
    ["What did the janitor say when he jumped out of the closet? Supplies!", "classic"],
    ["I wouldn't buy anything with velcro. It's a total rip-off.", "pun"],
    ["What do you call a fish without eyes? A fsh.", "pun"],
    ["Want to hear a joke about construction? I'm still working on it.", "classic"],
    ["What do you call a man with a rubber toe? Roberto.", "pun"],
    ["Why couldn't the bicycle stand up by itself? It was two tired.", "pun"],
    ["What's orange and sounds like a parrot? A carrot.", "classic"],
    ["Why do seagulls fly over the sea? Because if they flew over the bay they'd be bagels.", "pun"],
    ["What do you call a sleeping dinosaur? A dino-snore.", "pun"],
    ["I'm so good at sleeping I can do it with my eyes closed.", "classic"],
    ["What do you get when you cross a snowman with a vampire? Frostbite.", "pun"],
    ["What time did the man go to the dentist? Tooth-hurty.", "pun"],
    ["How do you organize a space party? You planet.", "pun"],
    ["What did the grape say when it was stepped on? Nothing, it just let out a little wine.", "pun"],
    ["Why did the coffee file a police report? It got mugged.", "pun"],
    ["What do you call a man who can't stand? Neil.", "pun"],
    ["Why did the picture go to jail? Because it was framed.", "pun"],
    ["What do you call a belt made of watches? A waist of time.", "pun"],
    ["How does Moses make his coffee? Hebrews it.", "pun"],
    ["What's the difference between a guitar and a fish? You can tune a guitar, but you can't tuna fish.", "pun"],
    ["Why did the tomato turn red? Because it saw the salad dressing.", "classic"],
    ["What do you call a lazy kangaroo? A pouch potato.", "pun"],
    ["Why don't oysters donate to charity? Because they're shellfish.", "pun"],
    ["What do dentists call their x-rays? Tooth pics.", "pun"],
    ["Did you hear about the guy who invented the knock-knock joke? He won the 'no-bell' prize.", "pun"],
    ["What does a baby computer call his father? Data.", "pun"],
    ["How do you make a tissue dance? Put a little boogie in it.", "classic"],
    ["What did the buffalo say when his son left for college? Bison.", "pun"],
    ["Why did the stadium get hot after the game? All the fans left.", "pun"],
    ["What do you call a snowman with a six-pack? An abdominal snowman.", "pun"],
    ["Why don't scientists trust stairs? Because they're always up to something.", "pun"],
    ["What did one hat say to the other? Stay here, I'm going on ahead.", "pun"],
    ["Why was the broom late? It over-swept.", "pun"],
    ["What do you call two birds in love? Tweethearts.", "pun"],
    ["Why do cows wear bells? Because their horns don't work.", "classic"],
    ["What do you call a pig that does karate? A pork chop.", "pun"],
    ["What concert costs just 45 cents? 50 Cent featuring Nickelback.", "classic"],
    ["What do sprinters eat before a race? Nothing — they fast.", "pun"],
    ["Why couldn't the pony sing a song? She was a little hoarse.", "pun"],
    ["Two guys walked into a bar. The third one ducked.", "classic"],
    ["Why are elevator jokes so classic? They work on many levels.", "pun"],
    ["What do you call a dinosaur that crashes their car? Tyrannosaurus Wrecks.", "pun"],
    ["Why can't you hear a pterodactyl going to the bathroom? Because the P is silent.", "pun"],
    ["What did the pirate say on his 80th birthday? Aye matey!", "pun"],
    ["Where do boats go when they're sick? To the dock.", "pun"],
    ["Why do bees have sticky hair? Because they use honeycombs.", "pun"],
    ["What do you call a deer with no eyes? No idea.", "pun"],
    ["I was going to tell a time-traveling joke, but you didn't like it.", "classic"],
    ["What did one plate say to the other plate? Dinner is on me.", "classic"],
    ["Why did the man fall down the well? Because he couldn't see that well.", "classic"],
    ["When does a joke become a dad joke? When it becomes apparent.", "pun"],
    ["What do you call a toothless bear? A gummy bear.", "pun"],
    ["I asked my dog what's two minus two. He said nothing.", "classic"],
    ["I have a joke about trickle-down economics, but 99% of you won't get it.", "wordplay"],
    ["What do you call a boomerang that won't come back? A stick.", "classic"],
    ["What's a foot long and slippery? A slipper.", "classic"],
    ["Why did the coach go to the bank? To get his quarterback.", "pun"],
    ["Where do math teachers go on vacation? Times Square.", "pun"],
    ["Why is Peter Pan always flying? Because he Neverlands.", "pun"],
    ["I told my cat a joke. It wasn't very a-mew-sing.", "pun"],
    ["What do you call a sleeping bull? A bulldozer.", "pun"],
    ["Why do chicken coops only have two doors? Because if they had four, they would be chicken sedans.", "classic"],
    ["What do you call it when Batman skips church? Christian Bale.", "pun"],
    ["What's a pirate's favorite letter? You'd think it's R, but it's the C.", "classic"],
    ["I just watched a documentary about beavers. It was the best dam show I ever saw.", "pun"],
    ["My wife asked me to go get six cans of Sprite. I came back with 7Up.", "classic"],
    ["What did the left eye say to the right eye? Between you and me, something smells.", "classic"],
    ["Why did the Clydesdale give the pony a glass of water? Because he was a little horse.", "pun"],
    ["I told my wife she should embrace her mistakes. She hugged me.", "classic"],
    ["Why did the chicken cross the playground? To get to the other slide.", "classic"],
    ["What kind of shoes do ninjas wear? Sneakers.", "classic"],
    ["What does a lemon say when it answers the phone? Yellow!", "pun"],
    ["How do trees access the internet? They log in.", "pun"],
    ["What do you call a fish wearing a bowtie? Sofishticated.", "pun"],
    ["Why do trees seem suspicious on sunny days? Because they look shady.", "pun"],
    ["What do you give to a sick lemon? Lemon aid.", "pun"],
    ["What kind of car does an egg drive? A Yolkswagen.", "pun"],
    ["Why did the invisible man turn down the job offer? He couldn't see himself doing it.", "classic"],
    ["What do you call an alligator in a vest? An investigator.", "pun"],
    ["How do you catch a squirrel? Climb a tree and act like a nut.", "classic"],
    ["What's a balloon's least favorite type of music? Pop.", "pun"],
    ["I have a joke about paper. It's tearable.", "pun"],
    ["Why are spiders so smart? They can find everything on the web.", "pun"],
    ["What did the shark say when he ate the clownfish? This tastes a little funny.", "pun"],
    ["Why shouldn't you write with a broken pencil? Because it's pointless.", "pun"],
    ["Did you hear about the Italian chef who died? He pasta way.", "pun"],
    ["What does a nosy pepper do? Gets jalapeño business.", "pun"],
    ["If April showers bring May flowers, what do May flowers bring? Pilgrims.", "classic"],
    ["What's the best way to watch a fly fishing tournament? Live stream.", "pun"],
    ["How do you make holy water? You boil the hell out of it.", "classic"],
    ["Why do melons have weddings? Because they cantaloupe.", "pun"],
    ["What's ET short for? Because he's only got little legs.", "classic"],
    ["I used to be a banker but I lost interest.", "pun"],
    ["What do you call a pony with a sore throat? A little hoarse.", "pun"],
    ["What kind of music do mummies listen to? Wrap music.", "pun"],
    ["I was wondering why the ball was getting bigger. Then it hit me.", "classic"],
    ["What do lawyers wear to court? Lawsuits.", "pun"],
    ["Why did the scarecrow become a motivational speaker? He was outstanding in his field.", "classic"],
    ["How does Darth Vader like his toast? On the dark side.", "pun"],
    ["What do you call a line of men waiting to get haircuts? A barber-queue.", "pun"],
    ["Why are ghosts such bad liars? Because you can see right through them.", "classic"],
    ["What do you call a hippie's wife? Mississippi.", "pun"],
    ["Why can't a leopard hide? Because he's always spotted.", "classic"],
    ["What did the zero say to the eight? Nice belt.", "classic"],
    ["What did the traffic light say to the car? Don't look, I'm about to change.", "classic"],
    ["What did the grape do when it got stepped on? It let out a little wine.", "pun"],
    ["Why did the banker switch careers? He lost interest.", "pun"],
    ["What do you call a magic dog? A Labracadabrador.", "pun"],
    ["How do astronomers organize a party? They planet.", "pun"],
    ["Why don't some fish play tennis? Because they're afraid of the net.", "pun"],
    ["What do you call a group of unorganized cats? A cat-astrophe.", "pun"],
    ["I made a pencil with two erasers. It was pointless.", "pun"],
    ["What do you call a bear caught in the rain? A drizzly bear.", "pun"],
    ["Why did the banana go to the doctor? It wasn't peeling well.", "pun"],
    ["What has ears but can't hear? A cornfield.", "classic"],
    ["Why do ducks have tail feathers? To cover their butt quacks.", "classic"],
    ["What did the big flower say to the little flower? Hey there, bud.", "pun"],
    ["What sits at the bottom of the sea and twitches? A nervous wreck.", "classic"],
    ["Why don't ants get sick? Because they have little anty-bodies.", "pun"],
    ["What did one toilet say to the other? You look a bit flushed.", "classic"],
    ["How did the hipster burn his mouth? He ate the pizza before it was cool.", "classic"],
    ["What do you call an angry carrot? A steamed veggie.", "pun"],
    ["What do you call a deer with no eyes and no legs? Still no idea.", "pun"],
    ["I have a fear of speed bumps, but I'm slowly getting over it.", "classic"],
    ["Why do nurses like red crayons? Sometimes they have to draw blood.", "classic"],
    ["What's a skeleton's least favorite room? The living room.", "classic"],
    ["Why did the gym close down? It just didn't work out.", "pun"],
    ["What did the duck say when she bought lipstick? Put it on my bill.", "pun"],
    ["I bought some shoes from a drug dealer. I don't know what he laced them with, but I've been tripping all day.", "classic"],
    ["My kid wants to be an astronaut. I told him the sky's the limit.", "classic"],
    ["What do sea monsters eat? Fish and ships.", "pun"],
    ["Why don't mountains get cold? They wear snowcaps.", "classic"],
    ["I'm reading a horror book in Braille. Something bad is about to happen — I can feel it.", "classic"],
    ["What does a house wear? Address.", "pun"],
    ["Why was the math teacher suspicious of prime numbers? They could only be divided by themselves.", "classic"],
    ["What do you call a fake stone in Ireland? A sham-rock.", "pun"],
    ["I tried to catch fog yesterday. Mist.", "pun"],
    ["What do you call a cowboy with bad gas? Darn tootin'.", "classic"],
    ["I told a chemistry joke. There was no reaction.", "pun"],
    ["Why did the old man fall in the well? Because he couldn't see that well.", "classic"],
    ["What do you call birds that stick together? Vel-crows.", "pun"],
    ["Why are fish so easy to weigh? Because they have their own scales.", "pun"],
    ["What do you call a cow with two legs? Lean beef.", "pun"],
    ["Why did the barber win the race? He knew a short cut.", "pun"],
    ["What kind of shoes do frogs wear? Open toad sandals.", "pun"],
    ["Where did the cat go when it lost its tail? The re-tail store.", "pun"],
    ["Why can't you tell a joke while ice fishing? Because it'll crack you up.", "pun"],
    ["What do you call a snake wearing a hard hat? A boa constructor.", "pun"],
    ["Why do they call it a building? It's already built.", "classic"],
    ["What do you call a woman who sets fire to all her bills? Bernadette.", "pun"],
    ["How does a rabbi make his coffee? Hebrews it.", "pun"],
    ["Why do golfers always bring an extra pair of socks? In case they get a hole in one.", "classic"],
    ["I used to be a personal trainer, but I gave my too-weak notice.", "pun"],
    ["I got hit in the head with a can of soda. Luckily it was a soft drink.", "classic"],
    ["What's a witch's favorite subject in school? Spelling.", "classic"],
    ["What do you call a peanut in a spacesuit? An astronut.", "pun"],
    ["Why can't you trust an atom? Because they make up literally everything.", "pun"],
    ["What do you call a nervous javelin thrower? Shakespeare.", "pun"]
  ];
  var ins = db.prepare('INSERT INTO dad_jokes (joke, category) VALUES (?,?)');
  jokes.forEach(function(j) { ins.run(j[0], j[1]); });
  saveDb();
}

// Auto-seed on first load
try {
  var count = db.prepare('SELECT COUNT(*) as c FROM dad_jokes').get().c;
  if (count === 0) seedJokes();
} catch {}

module.exports = router;
