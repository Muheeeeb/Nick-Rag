import { NextRequest, NextResponse } from 'next/server';
import { runRAG } from '../../../src/rag';

// Configure runtime for Vercel
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Handle CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers }
      );
    }
    const { query, conversationHistory } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid request. Provide a "query" field in the request body.' },
        { status: 400, headers }
      );
    }

    // Check environment variables before running RAG
    const missingVars = [];
    const envCheck = {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      PINECONE_API_KEY: !!process.env.PINECONE_API_KEY,
      PINECONE_INDEX: !!process.env.PINECONE_INDEX,
    };
    
    if (!envCheck.OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');
    if (!envCheck.PINECONE_API_KEY) missingVars.push('PINECONE_API_KEY');
    if (!envCheck.PINECONE_INDEX) missingVars.push('PINECONE_INDEX');
    
    console.log('Environment variables check:', {
      ...envCheck,
      PINECONE_INDEX_VALUE: process.env.PINECONE_INDEX,
      PINECONE_ENV: process.env.PINECONE_ENVIRONMENT,
    });
    
    if (missingVars.length > 0) {
      console.error('Missing environment variables:', missingVars);
      return NextResponse.json(
        {
          error: 'Configuration error',
          message: `Missing required environment variables: ${missingVars.join(', ')}. Please check your Vercel environment variables and redeploy.`,
          debug: envCheck,
        },
        { status: 500, headers }
      );
    }

    console.log('Starting RAG processing for query:', query.substring(0, 50));
    console.log('Environment check:', {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasPinecone: !!process.env.PINECONE_API_KEY,
      hasIndex: !!process.env.PINECONE_INDEX,
    });

    // Run RAG with conversation history
    const result = await runRAG(query.trim(), conversationHistory || []);

    console.log('RAG processing completed successfully');

    // Return answer with headers
    return NextResponse.json(
      {
        answer: result.answer,
        // Uncomment to include sources in response:
        // sources: result.sources,
      },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error) {
    console.error('API error:', error);
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Return detailed error for debugging (in production, you might want to hide details)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        // Include error type for debugging
        type: error?.constructor?.name || 'Unknown',
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// Handle other methods
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  );
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

