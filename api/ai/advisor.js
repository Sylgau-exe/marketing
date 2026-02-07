// api/ai/advisor.js - Backend proxy for AI advisor (Anthropic API)
import { requireAuth, cors } from '../../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { prompt, max_tokens = 800 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not set in environment');
      return res.status(500).json({ error: 'AI advisor not configured. Set ANTHROPIC_API_KEY in Vercel environment variables.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: Math.min(max_tokens, 1200),
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'AI advisor temporarily unavailable' });
    }

    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('\n') || '';
    
    res.json({ text });
  } catch (error) {
    console.error('AI advisor error:', error);
    res.status(500).json({ error: 'AI advisor failed' });
  }
}
