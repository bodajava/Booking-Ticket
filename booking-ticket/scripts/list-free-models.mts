import { listFreeChatModels } from "../lib/openrouter.js";

const models = await listFreeChatModels();
console.log(`${models.length} free chat models on OpenRouter right now:\n`);
for (const m of models.slice(0, 40)) {
  console.log(`  ${m.id.padEnd(52)} ${String(m.contextLength).padStart(9)} ctx  ${m.name}`);
}
console.log(`\nSet one via OPENROUTER_CHAT_MODEL in .env.local`);
process.exit(0);
