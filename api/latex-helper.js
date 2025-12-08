// api/latex-helper.js
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message } = req.body || {};
        const userMessage = message || '';

        if (!userMessage || !userMessage.trim()) {
            return res.status(400).json({ error: 'Message required' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY not found in env');
            return res.status(500).json({ error: 'Server configuration error: Missing API key' });
        }

        // Extended list of models to try (matching grade-submission.js)
        const GEMINI_ENDPOINTS = [
            { version: 'v1beta', model: 'gemini-2.5-flash' },
            { version: 'v1beta', model: 'gemini-2.0-flash' },
            { version: 'v1beta', model: 'gemini-1.5-flash' },
            { version: 'v1beta', model: 'gemini-1.5-pro' },
            { version: 'v1beta', model: 'gemini-pro' },
            { version: 'v1', model: 'gemini-1.5-flash' },
            { version: 'v1', model: 'gemini-1.5-pro' },
            { version: 'v1', model: 'gemini-pro' }
        ];

        const systemPrompt = `You are a helpful LaTeX assistant for high school math students. 
Your ONLY job is to help them format their math proofs in LaTeX. 
Do NOT solve math problems. Do NOT give hints about the solution. 
Only explain LaTeX syntax. Be concise and helpful.`;

        const errors = [];

        for (const cfg of GEMINI_ENDPOINTS) {
            try {
                const url = `https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${apiKey}`;

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            { role: 'user', parts: [{ text: systemPrompt + "\n\nUser question: " + userMessage }] }
                        ],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 512
                        }
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error?.message || `${cfg.model} failed with status ${response.status}`);
                }

                const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();

                if (text) {
                    console.log(`LaTeX helper success with ${cfg.model}`);
                    return res.status(200).json({ reply: text });
                }

                throw new Error('Empty response');
            } catch (e) {
                errors.push(`${cfg.model}: ${e.message}`);
                continue;
            }
        }

        // All models failed
        console.error('All Gemini models failed for LaTeX helper:', errors.join('; '));
        return res.status(500).json({
            error: 'AI service temporarily unavailable. Please try again.',
            details: errors.slice(0, 3).join('; ')
        });

    } catch (error) {
        console.error('LaTeX helper API error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
}
