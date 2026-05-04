/*
 * Anahuac RV Park — Park Gardens
 * Plant photo sharing, reactions, comments, daily gardening tips
 */
const router = require('express').Router();
const { db } = require('../database');
const { authenticate } = require('../middleware');

const REACTION_TYPES = ['seedling', 'sunflower', 'heart', 'fire'];
const STAGES = ['seedling', 'growing', 'flowering', 'harvest'];
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 14_000_000;

function attachReactions(posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id, reaction_type, COUNT(*) as c FROM garden_reactions WHERE post_id IN (${ph}) GROUP BY post_id, reaction_type`).all(...ids);
  const map = {};
  rows.forEach(r => { if (!map[r.post_id]) map[r.post_id] = {}; map[r.post_id][r.reaction_type] = r.c; });
  posts.forEach(p => { p.reactions = map[p.id] || {}; });
  return posts;
}

// ── Public: list posts ──
router.get('/public', (req, res) => {
  var posts = db.prepare(`SELECT p.id, p.plant_name, p.stage, p.caption, p.is_management, p.created_at,
    CASE WHEN p.photo_data IS NOT NULL AND p.photo_data != '' THEN 1 ELSE 0 END as has_photo,
    (SELECT COUNT(*) FROM garden_photos WHERE post_id=p.id) as extra_photo_count,
    CASE WHEN p.is_management = 1 THEN 'Park Management'
         WHEN p.tenant_id IS NULL THEN 'Visitor'
         ELSE t.first_name END as author_first,
    CASE WHEN p.is_management = 1 THEN 'Park Management'
         WHEN p.tenant_id IS NULL THEN 'Visitor'
         ELSE t.first_name || ' ' || t.last_name END as author,
    CASE WHEN p.is_management = 1 THEN ''
         WHEN p.tenant_id IS NULL THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot,
    p.tenant_id,
    (SELECT COUNT(*) FROM garden_comments WHERE post_id=p.id) as comment_count
    FROM garden_posts p LEFT JOIN tenants t ON p.tenant_id = t.id
    ORDER BY p.created_at DESC LIMIT 50`).all();
  attachReactions(posts);
  res.json(posts);
});

// ── Public: main photo ──
router.get('/:id/photo', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM garden_posts WHERE id=?').get(parseInt(req.params.id));
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// ── Public: extra photo ──
router.get('/photo/:photoId', (req, res) => {
  var row = db.prepare('SELECT photo_data FROM garden_photos WHERE id=?').get(parseInt(req.params.photoId));
  if (!row || !row.photo_data) return res.status(404).send('No photo');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(row.photo_data, 'base64'));
});

// ── Public: submit post (multi-photo) ──
router.post('/submit', (req, res) => {
  var b = req.body || {};
  if (!b.photo_data && (!b.photos || !b.photos.length)) {
    if (!b.caption || !b.caption.trim()) return res.status(400).json({ error: 'A photo or caption is required' });
  }
  var mainPhoto = b.photo_data || (b.photos && b.photos[0]) || null;
  if (mainPhoto && mainPhoto.length > MAX_PHOTO_SIZE) return res.status(400).json({ error: 'Photo too large' });
  var result = db.prepare('INSERT INTO garden_posts (tenant_id, plant_name, stage, caption, photo_data) VALUES (?,?,?,?,?)').run(
    b.tenant_id || null, b.plant_name || null,
    STAGES.includes(b.stage) ? b.stage : null,
    b.caption ? b.caption.trim() : null, mainPhoto
  );
  var postId = result.lastInsertRowid;
  if (b.photos && b.photos.length > 1) {
    var ins = db.prepare('INSERT INTO garden_photos (post_id, photo_data, display_order) VALUES (?,?,?)');
    for (var i = 1; i < Math.min(b.photos.length, MAX_PHOTOS); i++) {
      if (b.photos[i] && b.photos[i].length <= MAX_PHOTO_SIZE) ins.run(postId, b.photos[i], i);
    }
  }
  res.json({ id: postId });
});

// ── Public: toggle reaction ──
router.post('/:id/react', (req, res) => {
  var postId = parseInt(req.params.id);
  var { reaction_type, tenant_id } = req.body || {};
  if (!REACTION_TYPES.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction type' });
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });
  var existing = db.prepare('SELECT id FROM garden_reactions WHERE post_id=? AND tenant_id=? AND reaction_type=?').get(postId, tenant_id, reaction_type);
  if (existing) {
    db.prepare('DELETE FROM garden_reactions WHERE id=?').run(existing.id);
    res.json({ toggled: 'removed' });
  } else {
    db.prepare('INSERT INTO garden_reactions (post_id, tenant_id, reaction_type) VALUES (?,?,?)').run(postId, tenant_id, reaction_type);
    res.json({ toggled: 'added' });
  }
});

// ── Public: my reactions ──
router.get('/my-reactions', (req, res) => {
  var tenantId = parseInt(req.query.tenant_id);
  if (!tenantId) return res.json({});
  var rows = db.prepare('SELECT post_id, reaction_type FROM garden_reactions WHERE tenant_id=?').all(tenantId);
  var map = {};
  rows.forEach(r => { if (!map[r.post_id]) map[r.post_id] = []; map[r.post_id].push(r.reaction_type); });
  res.json(map);
});

// ── Public: get comments ──
router.get('/:id/comments', (req, res) => {
  var comments = db.prepare(`SELECT c.id, c.comment, c.created_at,
    COALESCE(c.is_management, 0) as is_management,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN 'Park Management'
         ELSE COALESCE(c.author_name, t.first_name || ' ' || t.last_name, 'Visitor') END as author,
    CASE WHEN COALESCE(c.is_management, 0) = 1 THEN ''
         ELSE COALESCE('Lot ' || t.lot_id, '') END as author_lot
    FROM garden_comments c LEFT JOIN tenants t ON c.tenant_id = t.id
    WHERE c.post_id=? ORDER BY c.created_at ASC`).all(parseInt(req.params.id));
  res.json(comments);
});

// ── Public: add comment ──
router.post('/:id/comments', (req, res) => {
  var postId = parseInt(req.params.id);
  var { comment, tenant_id, author_name } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment required' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment too long' });
  db.prepare('INSERT INTO garden_comments (post_id, tenant_id, author_name, comment) VALUES (?,?,?,?)').run(
    postId, tenant_id || null, author_name || null, comment.trim()
  );
  res.json({ success: true });
});

// ── Public: today's gardening tip ──
router.get('/tip-of-the-day', (req, res) => {
  try {
    var tipCount = db.prepare('SELECT COUNT(*) as c FROM gardening_tips').get().c;
    if (tipCount === 0) seedGardeningTips();
  } catch {}
  var today = new Date().toISOString().slice(0, 10);
  // Check if we already picked a tip for today
  var history = db.prepare('SELECT tip_id FROM gardening_tips_history WHERE shown_date=?').get(today);
  if (history) {
    var tip = db.prepare('SELECT id, title, body, category, is_local FROM gardening_tips WHERE id=?').get(history.tip_id);
    if (tip) return res.json(tip);
  }
  // Check for a tip scheduled for today
  var scheduled = db.prepare('SELECT id, title, body, category, is_local FROM gardening_tips WHERE show_date=? AND active=1').get(today);
  if (scheduled) {
    try { db.prepare('INSERT INTO gardening_tips_history (tip_id, shown_date) VALUES (?,?)').run(scheduled.id, today); } catch {}
    return res.json(scheduled);
  }
  // Pick the next tip that hasn't been shown yet
  var tip = db.prepare(`SELECT id, title, body, category, is_local FROM gardening_tips
    WHERE active=1 AND id NOT IN (SELECT tip_id FROM gardening_tips_history)
    ORDER BY display_order ASC, id ASC LIMIT 1`).get();
  if (!tip) {
    // All tips shown — restart cycle
    db.prepare('DELETE FROM gardening_tips_history').run();
    tip = db.prepare('SELECT id, title, body, category, is_local FROM gardening_tips WHERE active=1 ORDER BY display_order ASC, id ASC LIMIT 1').get();
  }
  if (tip) {
    try { db.prepare('INSERT INTO gardening_tips_history (tip_id, shown_date) VALUES (?,?)').run(tip.id, today); } catch {}
    return res.json(tip);
  }
  res.json(null);
});

// ══════ Admin routes ══════
router.use(authenticate);

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var postId = parseInt(req.params.id);
  db.prepare('DELETE FROM garden_comments WHERE post_id=?').run(postId);
  db.prepare('DELETE FROM garden_reactions WHERE post_id=?').run(postId);
  db.prepare('DELETE FROM garden_photos WHERE post_id=?').run(postId);
  db.prepare('DELETE FROM garden_posts WHERE id=?').run(postId);
  res.json({ success: true });
});

// Admin: add custom gardening tip
router.post('/tips', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var { title, body, category, is_local, show_date } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  var maxOrder = db.prepare('SELECT MAX(display_order) as m FROM gardening_tips').get();
  var order = (maxOrder?.m || 0) + 1;
  db.prepare('INSERT INTO gardening_tips (title, body, category, is_local, show_date, display_order) VALUES (?,?,?,?,?,?)').run(
    title, body, category || 'general', is_local ? 1 : 0, show_date || null, order
  );
  res.json({ success: true });
});

// ── Auto-seed gardening tips if empty ──
function seedGardeningTips() {
  var tips = [
    ["Water at the Base", "Water your plants at the base, not from overhead. Wet leaves invite fungal diseases and sunburn. Morning watering is best — it gives plants time to absorb before the heat of the day.", "watering", 0],
    ["Deep Watering Beats Frequent Sprinkles", "Water deeply and less often rather than a little every day. Deep watering encourages roots to grow downward, making plants more drought-resistant. Aim for 1 inch of water per week.", "watering", 0],
    ["The Finger Test for Watering", "Stick your finger 2 inches into the soil. If it's dry, water. If it's moist, wait. This simple test prevents both overwatering and underwatering — the two most common plant killers.", "watering", 0],
    ["Mulch Is Your Best Friend", "Apply 2-3 inches of mulch around plants to retain moisture, suppress weeds, and regulate soil temperature. Keep mulch a few inches away from stems to prevent rot.", "soil", 0],
    ["Compost: Black Gold for Your Garden", "Add compost to your soil every season. It improves drainage in clay soil, adds moisture retention to sandy soil, and feeds beneficial microorganisms. Kitchen scraps make great compost.", "soil", 0],
    ["Test Your Soil pH", "Most vegetables prefer slightly acidic soil (pH 6.0-6.8). A simple test kit from any garden center tells you if you need lime (to raise pH) or sulfur (to lower it).", "soil", 0],
    ["Companion Planting Magic", "Plant basil near tomatoes to repel aphids and improve flavor. Marigolds deter many pests. Beans fix nitrogen for heavy feeders like corn. Nature has a plan — work with it.", "vegetables", 0],
    ["Tomato Pruning Tip", "Remove 'suckers' — the shoots that grow between the main stem and branches of tomato plants. This directs energy to fruit production rather than foliage. Your tomatoes will be bigger and tastier.", "vegetables", 0],
    ["Grow Herbs in Containers", "Herbs like basil, cilantro, mint, and rosemary thrive in containers. Perfect for RV life — move them into shade on hot days, bring inside in winter. A windowsill herb garden provides fresh flavoring year-round.", "container", 0],
    ["Container Gardening 101", "Almost anything grows in containers if the pot is big enough. Use 5-gallon buckets for tomatoes, peppers, and squash. Make sure containers have drainage holes. Use quality potting mix, not garden soil.", "container", 0],
    ["Self-Watering Container Trick", "Place a sponge at the bottom of your container before adding soil. It acts as a water reservoir, keeping roots hydrated longer between waterings. Especially useful in Texas heat.", "container", 1],
    ["The Right Pot Size Matters", "Tomatoes need at least 5-gallon pots. Herbs do fine in 1-2 gallon. Peppers prefer 3-gallon. Too-small pots restrict roots and reduce yield. When in doubt, go bigger.", "container", 0],
    ["Deadheading for More Blooms", "Remove spent flowers (deadheading) to encourage plants to produce more blooms instead of going to seed. This works especially well with roses, petunias, marigolds, and zinnias.", "flowers", 0],
    ["Plant Native Wildflowers", "Texas native wildflowers like bluebonnets, Indian paintbrush, and black-eyed Susans are adapted to our climate and need minimal care. They also support local pollinators.", "flowers", 1],
    ["Succession Planting", "Don't plant all your seeds at once. Plant a new row every 2-3 weeks for a continuous harvest throughout the season instead of everything ripening at once.", "vegetables", 0],
    ["The Three Sisters Method", "Native Americans planted corn, beans, and squash together. Corn provides a pole for beans. Beans fix nitrogen for corn. Squash leaves shade the soil. An ancient method that still works.", "vegetables", 0],
    ["Epsom Salt for Peppers and Tomatoes", "Dissolve 1 tablespoon of Epsom salt in a gallon of water and spray on pepper and tomato plants every two weeks. The magnesium promotes fruit development and prevents blossom end rot.", "vegetables", 0],
    ["Save Your Eggshells", "Crushed eggshells add calcium to soil, which helps prevent blossom end rot in tomatoes. They also deter slugs and snails — the sharp edges are uncomfortable for soft-bodied pests.", "soil", 0],
    ["Coffee Grounds in the Garden", "Used coffee grounds add nitrogen to soil and improve drainage. Sprinkle them around acid-loving plants like blueberries, roses, and azaleas. They also help repel ants and slugs.", "soil", 0],
    ["Banana Peel Fertilizer", "Bury banana peels near roses and tomatoes. They're rich in potassium, which promotes strong root growth and flower/fruit production. Or soak peels in water for a day to make banana tea fertilizer.", "soil", 0],
    ["Know Your Frost Dates", "In the Anahuac/Chambers County area, the average last frost is around mid-February and first frost is late November. Plan your planting schedule around these dates.", "seasonal", 1],
    ["Summer Heat Strategy for Texas", "In southeast Texas, plant heat-tolerant varieties like okra, southern peas, sweet potatoes, and peppers for summer. Many cool-season crops bolt in our heat — save lettuce and broccoli for fall.", "seasonal", 1],
    ["Fall Garden Planning", "September and October are prime planting months on the Gulf Coast. Broccoli, cauliflower, lettuce, spinach, kale, and carrots all thrive in our mild fall and winter.", "seasonal", 1],
    ["Protect Plants from Gulf Coast Humidity", "High humidity promotes fungal diseases. Space plants for good air circulation, avoid overhead watering, and remove any diseased leaves immediately. Copper fungicide spray can help prevent problems.", "seasonal", 1],
    ["Hurricane Season Garden Prep", "Before a storm: harvest what you can, secure containers, and move potted plants to sheltered spots. After: rinse salt spray off leaves, prune damaged branches, and watch for standing water.", "seasonal", 1],
    ["Natural Pest Control: Neem Oil", "Neem oil is an organic solution that controls aphids, whiteflies, spider mites, and more. Mix 2 tablespoons per gallon of water with a drop of dish soap. Spray in the evening to avoid burning leaves.", "pest", 0],
    ["Attract Beneficial Insects", "Plant dill, fennel, yarrow, and cosmos to attract ladybugs, lacewings, and parasitic wasps — they eat aphids, caterpillars, and other pests naturally. Let some herbs flower for these good guys.", "pest", 0],
    ["The Beer Trap for Slugs", "Bury a shallow dish level with the soil and fill with cheap beer. Slugs are attracted to the yeast, fall in, and drown. Replace every few days. A classic organic method that really works.", "pest", 0],
    ["Diatomaceous Earth for Pest Control", "Food-grade diatomaceous earth sprinkled around plants kills soft-bodied insects by damaging their exoskeletons. It's safe for humans and pets but deadly for slugs, ants, and many garden pests.", "pest", 0],
    ["Fire Ant Control in Garden Beds", "Fire ants are everywhere in Texas. Sprinkle dry cornmeal around mounds — they can't digest it. Or pour boiling water on mounds (carefully). Avoid chemical pesticides near food plants.", "pest", 1],
    ["Harvest in the Morning", "Pick vegetables and herbs in the early morning when their moisture content is highest. They'll stay fresh longer. Tomatoes, peppers, and herbs are especially better when harvested before the heat.", "vegetables", 0],
    ["Let Herbs Flower for Pollinators", "When your basil, oregano, or thyme starts to flower, leave a few stems. The flowers attract bees and butterflies. You can still harvest from the non-flowering stems.", "flowers", 0],
    ["Grow Vertical to Save Space", "Use trellises, cages, and hanging baskets to grow up instead of out. Cucumbers, beans, peas, small melons, and even strawberries can be grown vertically in tight spaces.", "container", 0],
    ["Raised Beds for Better Drainage", "If your site has heavy clay or poor drainage, raised beds solve the problem. Even 6-8 inches of quality soil mix on top of existing ground dramatically improves plant health.", "soil", 0],
    ["The Importance of Crop Rotation", "Don't plant the same family of vegetables in the same spot year after year. Rotate to prevent soil-borne diseases and nutrient depletion. Tomatoes, peppers, and eggplant are all the same family.", "vegetables", 0],
    ["Pruning 101: When and How", "Prune spring-flowering shrubs right after they bloom. Prune summer-flowering plants in late winter. Never remove more than one-third of a plant at once. Clean cuts heal faster than ragged tears.", "flowers", 0],
    ["Save Seeds for Next Season", "Let a few of your best tomatoes, peppers, or flowers go to seed. Dry the seeds thoroughly and store in paper envelopes in a cool, dry place. Free plants next year from your best performers.", "vegetables", 0],
    ["Vinegar Weed Killer", "Household white vinegar (5%) kills young weeds on contact. For tougher weeds, use horticultural vinegar (20%) with caution — it's much stronger. Add dish soap to help it stick to leaves.", "pest", 0],
    ["Start Seeds Indoors", "Start tomato, pepper, and herb seeds indoors 6-8 weeks before your last frost date. A sunny window or cheap grow light works great. Harden off seedlings by gradually exposing them to outdoor conditions.", "seasonal", 0],
    ["Grow a Salsa Garden", "All you need is one pot each of tomatoes, peppers, cilantro, and onions. That's a complete salsa garden in four containers. Add a lime tree if you're feeling fancy.", "container", 0],
    ["Fertilize Wisely", "More isn't better with fertilizer — it can burn roots and produce lush leaves but no fruit. Follow package directions. Organic options like fish emulsion and bone meal are gentler and longer-lasting.", "soil", 0],
    ["The Benefits of Worm Composting", "Vermicomposting (worm composting) turns kitchen scraps into premium fertilizer in a small bin. Red wigglers thrive in bins under your RV or in a shaded spot. The castings are garden gold.", "soil", 0],
    ["Grow Microgreens Indoors", "No garden space? Grow microgreens on your kitchen counter. They're ready to harvest in 7-14 days, packed with nutrition, and need just a tray, some soil, and a sunny window.", "container", 0],
    ["Shade Cloth for Texas Summers", "A 30-50% shade cloth over your garden bed can drop temperatures 10-15 degrees. This extends the life of spring crops and protects tender seedlings from our brutal afternoon sun.", "seasonal", 1],
    ["Yellow Leaves Diagnosis", "Yellow bottom leaves usually mean overwatering or nitrogen deficiency. Yellow top leaves suggest iron deficiency (common in alkaline soil). Yellow between veins points to magnesium deficiency.", "troubleshooting", 0],
    ["Why Your Tomatoes Won't Set Fruit", "Tomatoes stop setting fruit when night temperatures stay above 75°F or day temps exceed 95°F. In Texas, that means early varieties and fall plantings give best results.", "troubleshooting", 1],
    ["Blossom End Rot Fix", "That black, sunken spot on the bottom of tomatoes is blossom end rot — usually caused by inconsistent watering, not calcium deficiency. Keep watering regular and mulch heavily.", "troubleshooting", 0],
    ["When to Pick Jalapeños", "Jalapeños are ready when they're firm and dark green, about 3-4 inches long. Want them hotter? Wait for stress lines (small cracks) or let them turn red. Red jalapeños are spicier and slightly sweeter.", "vegetables", 0],
    ["Grow Sweet Potatoes in Containers", "Sweet potatoes are easy, productive, and heat-loving — perfect for Texas. A large container (15+ gallons) or grow bag works great. Plant slips in May, harvest in October.", "vegetables", 1],
    ["Butterfly Garden Basics", "Plant milkweed for monarchs, lantana for painted ladies, and passion vine for Gulf fritillaries. A butterfly garden brings beauty AND helps declining pollinator populations. Kids love watching the life cycle.", "flowers", 0],
    ["Aloe Vera: The RV Park Must-Have", "Keep an aloe vera plant in a sunny spot. It's nearly indestructible, handles Texas heat, and the gel treats minor burns and bug bites. Break off a leaf when you need it.", "container", 1],
    ["Watering Succulents Properly", "Succulents need a good soak, then complete drying between waterings — usually every 1-2 weeks. More succulents die from overwatering than underwatering. If in doubt, don't water.", "watering", 0],
    ["Herb Drying at Home", "Hang bundles of herbs upside down in a dry, airy spot for 1-2 weeks. Or use your car dashboard on a hot Texas day — herbs dry in hours! Store in airtight jars away from light.", "vegetables", 0],
    ["Attract Hummingbirds", "Plant red and orange tubular flowers like salvia, trumpet vine, and coral honeysuckle. Avoid pesticides near these plants. Hummingbirds also love feeders — use 1 part sugar to 4 parts water, no red dye.", "flowers", 1],
    ["Garden Journaling", "Keep a simple log of what you planted, when, and how it did. Over time, this becomes your best gardening reference — customized to your exact spot and conditions. Even a phone note works.", "general", 0],
    ["The Right Time to Transplant", "Transplant seedlings on a cloudy day or in the evening to reduce shock. Water them well before and after transplanting. A dilute fish emulsion watering helps roots establish quickly.", "seasonal", 0],
    ["Growing Citrus in Containers", "Meyer lemons and key limes grow beautifully in large containers on the Gulf Coast. Bring them indoors or cover during rare freezes. Fresh citrus from your own tree is unbeatable.", "container", 1],
    ["Making Compost Tea", "Steep a shovel of compost in a 5-gallon bucket of water for 24-48 hours, stirring occasionally. Strain and use the liquid to water plants — it's like a vitamin boost for your garden.", "soil", 0],
    ["Gardening for Mental Health", "Studies show 30 minutes of gardening reduces stress hormones more effectively than 30 minutes of reading. The combination of sunlight, soil microbes, and physical activity is genuinely therapeutic.", "general", 0],
    ["Okra: The Texas Garden MVP", "Okra thrives in heat that kills other plants. Plant after soil warms to 65°F. Pick pods at 3-4 inches for best tenderness. It keeps producing all summer if you harvest regularly.", "vegetables", 1],
    ["Rosemary: Nearly Indestructible", "Rosemary handles Texas heat, poor soil, and drought like a champ. Plant it in a sunny spot with good drainage. It rarely needs fertilizer and deters many pests. Plus, it smells amazing.", "container", 1]
  ];
  var ins = db.prepare('INSERT INTO gardening_tips (title, body, category, is_local, display_order) VALUES (?,?,?,?,?)');
  tips.forEach(function(t, i) { ins.run(t[0], t[1], t[2], t[3], i + 1); });
}

try {
  var tipCount = db.prepare('SELECT COUNT(*) as c FROM gardening_tips').get().c;
  if (tipCount === 0) seedGardeningTips();
} catch {}

module.exports = router;
