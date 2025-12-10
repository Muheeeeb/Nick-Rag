import { NextRequest, NextResponse } from 'next/server';
import { runRAG } from '../../../src/rag';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, conversationHistory } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid request. Provide a "query" field in the request body.' },
        { status: 400 }
      );
    }

    // Check environment variables before running RAG
    const missingVars = [];
    if (!process.env.OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');
    if (!process.env.PINECONE_API_KEY) missingVars.push('PINECONE_API_KEY');
    if (!process.env.PINECONE_INDEX) missingVars.push('PINECONE_INDEX');
    
    if (missingVars.length > 0) {
      console.error('Missing environment variables:', missingVars);
      return NextResponse.json(
        {
          error: 'Configuration error',
          message: `Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file or environment configuration.`,
        },
        { status: 500 }
      );
    }

    // Run RAG with conversation history
    const result = await runRAG(query.trim(), conversationHistory || []);

    // Return answer
    return NextResponse.json({
      answer: result.answer,
      // Uncomment to include sources in response:
      // sources: result.sources,
    });
  } catch (error) {
    console.error('API error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Handle other methods
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  );
}

