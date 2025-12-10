import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runRAG } from '../src/rag';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request. Provide a "query" field in the request body.' 
      });
    }

    // Run RAG
    const result = await runRAG(query.trim());

    // Return answer (sources are optional, can be included for debugging)
    return res.status(200).json({
      answer: result.answer,
      // Uncomment to include sources in response:
      // sources: result.sources,
    });
  } catch (error) {
    console.error('API error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

