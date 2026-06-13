const { db } = require('./firebase');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Free, fast Llama model on Groq. Other options:
// 'llama-3.1-8b-instant' (smaller/faster), 'mixtral-8x7b-32768'
const MODEL = 'llama-3.3-70b-versatile';

/**
 * Builds a compact text summary of the current inventory state —
 * this is what gives the AI "knowledge" of your Firestore data.
 */
async function buildInventoryContext() {
  const snap = await db.collection('medicines').get();
  const medicines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const now = new Date();
  const lines = medicines.map((m) => {
    const expiry = m.expiryDate?.toDate
      ? m.expiryDate.toDate()
      : new Date(m.expiryDate);
    const daysToExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    const isExpired = daysToExpiry < 0;
    const isNearExpiry = !isExpired && daysToExpiry <= 30;
    const isLowStock = m.quantity <= (m.lowStockThreshold ?? 10);

    const flags = [];
    if (isExpired) flags.push('EXPIRED');
    if (isNearExpiry) flags.push(`NEAR EXPIRY (${daysToExpiry}d)`);
    if (isLowStock) flags.push('LOW STOCK');

    return `- ${m.name} | qty: ${m.quantity} | threshold: ${m.lowStockThreshold ?? 10} | expiry: ${expiry.toISOString().split('T')[0]} | price: GHS ${m.price} | supplier: ${m.supplierId}${flags.length ? ' | ' + flags.join(', ') : ''}`;
  });

  return {
    summary: `Total medicines: ${medicines.length}\n\n${lines.join('\n')}`,
    count: medicines.length,
  };
}

/**
 * Sends a user question + Firestore inventory context to Groq (Llama)
 * and returns the text response.
 */
async function askAssistant(question) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set in environment variables');
  }

  const { summary } = await buildInventoryContext();

  const systemPrompt = `You are the AI assistant inside StockAlert, a community pharmacy inventory app.
You help the pharmacist understand their stock levels, expiry risks, and reordering needs.

Here is the current inventory data (live from the database):
${summary}

Answer the pharmacist's question using this data. Be concise and practical.
If asked about something not covered by this data, say so honestly.`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '(no response)';
}

module.exports = { askAssistant, buildInventoryContext };