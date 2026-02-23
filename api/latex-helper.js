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

    // Simple in-memory store for rate limiting and repeat detection
    // NOTE: For production, use Redis or a database
    const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
    const RATE_LIMIT_MAX = 3;
    const REPEAT_LIMIT = 4;
    const MAX_PROMPT_LENGTH = 1000;
    const MIN_PROMPT_LENGTH = 5;
    const nonsensePatterns = [
        /^\s*$/, // empty
        /^([a-zA-Z0-9]{1,2}\s*){1,5}$/, // very short
        /^(.)\1{10,}$/, // repeated single char
        /^(.*)(\1){3,}$/ // repeated phrase
    ];
    // Use IP for rate limiting (for demo)
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    global.latexHelperStore = global.latexHelperStore || {};
    const store = global.latexHelperStore;
    store[ip] = store[ip] || { prompts: [], lastWindow: Date.now() };
    // Clean up old window
    if (Date.now() - store[ip].lastWindow > RATE_LIMIT_WINDOW_MS) {
        store[ip].prompts = [];
        store[ip].lastWindow = Date.now();
    }
    // Rate limit check
    if (store[ip].prompts.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please wait before sending more prompts.' });
    }
    try {
        const { message } = req.body || {};
        const userMessage = message || '';
        const trimmed = userMessage.trim();
        if (!trimmed) {
            return res.status(400).json({ error: 'Message required' });
        }
        // Min length check
        if (trimmed.length < MIN_PROMPT_LENGTH) {
            return res.status(400).json({ error: 'please enter longer prompt' });
        }
        // Max length check
        if (trimmed.length > MAX_PROMPT_LENGTH) {
            return res.status(400).json({ error: 'please shorten prompt' });
        }
        // Repeat check
        const repeatCount = store[ip].prompts.filter(p => p === trimmed).length;
        if (repeatCount >= REPEAT_LIMIT) {
            return res.status(429).json({ error: 'You have repeated this prompt too many times. Please try something different.' });
        }
        // Nonsense detection
        for (const pat of nonsensePatterns) {
            if (pat.test(trimmed)) {
                return res.status(400).json({ error: 'Your prompt appears to be nonsense. Please enter a valid prompt.' });
            }
        }
        // Store prompt for rate/repeat
        store[ip].prompts.push(trimmed);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            // ...existing code...
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
Only explain LaTeX syntax. Be concise and helpful. If you suspect user prompt to be nonsense, respond with "Your prompt appears to be nonsense. Please enter a valid prompt." only.`;

        const errors = [];

        for (const cfg of GEMINI_ENDPOINTS) {
            try {
                const url = `https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            { role: 'user', parts: [{ text: systemPrompt + "\n\nUser question: " + trimmed }] }
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
                    // ...existing code...
                    return res.status(200).json({ reply: text });
                }
                throw new Error('Empty response');
            } catch (e) {
                errors.push(`${cfg.model}: ${e.message}`);
                continue;
            }
        }

        // All models failed
        // ...existing code...
        return res.status(500).json({
            error: 'AI service temporarily unavailable. Please try again.',
            details: errors.slice(0, 3).join('; ')
        });

    } catch (error) {
        // ...existing code...
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
}
