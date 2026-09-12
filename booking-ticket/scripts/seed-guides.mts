import { createGuides, backfillGuideEmbeddings, type NewGuide } from "../lib/guides.js";
import { EMBEDDING_MODEL } from "../lib/openrouter.js";
import { db } from "../db/index.js";
import { destinationGuides } from "../db/schema.js";

const GUIDES: NewGuide[] = [
  { city: "Cairo", country: "Egypt", content:
    "Cairo pairs the Giza pyramids and the Grand Egyptian Museum with a dense, walkable old city. Visit October to April; summer regularly passes 38C. Budget travellers manage on 40 USD a day, and the metro is the fastest way across the Nile at rush hour. Khan el-Khalili is best in the early evening. Book pyramid tickets online to skip the queue." },
  { city: "Dubai", country: "United Arab Emirates", content:
    "Dubai is a stopover city built for short, high-intensity visits. November to March is comfortable; July and August are brutal outdoors. The metro connects the airport, Downtown and Marina cheaply. Desert safaris run half-day from the city. Expect 120 USD a day mid-range. Alcohol is served in licensed hotels only, and Friday mornings are quiet." },
  { city: "Istanbul", country: "Turkey", content:
    "Istanbul spans two continents, with Hagia Sophia, the Blue Mosque and the Grand Bazaar clustered in Sultanahmet. Spring and autumn are ideal; winter is grey and wet. Ferries across the Bosphorus are the cheapest sightseeing in the city. Around 60 USD a day is comfortable. Get an Istanbulkart for all public transport, and dress modestly for mosque visits." },
  { city: "Nairobi", country: "Kenya", content:
    "Nairobi is the only capital with a national park on its doorstep, where lions and rhinos graze against the skyline. Dry seasons run January to March and July to October, which is also when the Maasai Mara migration peaks. Budget 70 USD a day. Matatus are cheap but chaotic; ride-hailing is safer after dark. Yellow fever vaccination may be required on arrival." },
  { city: "Bangkok", country: "Thailand", content:
    "Bangkok mixes ornate temples like Wat Pho and the Grand Palace with some of the world's best street food. November to February is cool and dry; April is punishingly hot. The BTS Skytrain and river boats beat the traffic. 35 USD a day goes a long way. Dress covered at temples, and use metered taxis or ride-hailing rather than negotiating fares." },
  { city: "Lisbon", country: "Portugal", content:
    "Lisbon is a hilly Atlantic capital of tiled facades, tram 28 and pastel de nata. March to June and September to October avoid both crowds and August heat. Day trips to Sintra take 40 minutes by train. Around 80 USD a day mid-range. Buy a Viva Viagem card for trams and metro, and expect steep walks between neighbourhoods." },
];

const existing = await db.select({ id: destinationGuides.id }).from(destinationGuides);
if (existing.length > 0) {
  console.log(`${existing.length} guides already present — backfilling any missing embeddings instead.`);
  const n = await backfillGuideEmbeddings();
  console.log(`embedded ${n} guide(s) with ${EMBEDDING_MODEL}`);
} else {
  console.log(`embedding ${GUIDES.length} guides with ${EMBEDDING_MODEL}…`);
  const n = await createGuides(GUIDES);
  console.log(`inserted ${n} guides with embeddings`);
}
process.exit(0);
