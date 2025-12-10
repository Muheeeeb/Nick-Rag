import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// Lazy initialization to check env vars only when needed
function getOpenAIClient() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

function getPineconeClient() {
  const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
  if (!PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY environment variable is not set');
  }
  return new Pinecone({ apiKey: PINECONE_API_KEY });
}

function getPineconeIndex() {
  const PINECONE_INDEX = process.env.PINECONE_INDEX;
  if (!PINECONE_INDEX) {
    throw new Error('PINECONE_INDEX environment variable is not set');
  }
  return PINECONE_INDEX;
}

interface RAGResult {
  answer: string;
  sources?: Array<{ sheet: string; row?: number; text: string }>;
}

/**
 * Generate embedding for a query
 */
async function generateQueryEmbedding(query: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query,
    dimensions: 1024, // Match your Pinecone index dimensions
  });

  return response.data[0].embedding;
}

/**
 * Retrieve relevant chunks from Pinecone
 */
async function retrieveChunks(
  queryEmbedding: number[],
  topK: number = 10
): Promise<Array<{ text: string; metadata: any; score: number }>> {
  const pinecone = getPineconeClient();
  const indexName = getPineconeIndex();
  const index = pinecone.index(indexName);
  
  const queryResponse = await index.query({
    vector: queryEmbedding,
    topK: Math.min(topK, 20), // Cap at 20 for performance
    includeMetadata: true,
  });

  return (queryResponse.matches || []).map((match: any) => ({
    text: match.metadata?.text || '',
    metadata: match.metadata || {},
    score: match.score || 0,
  }));
}

/**
 * Re-rank chunks by relevance using LLM
 */
async function rerankChunks(
  query: string,
  chunks: Array<{ text: string; metadata: any; score: number }>
): Promise<Array<{ text: string; metadata: any; score: number }>> {
  if (chunks.length <= 3) return chunks; // No need to re-rank small sets

  const openai = getOpenAIClient();
  
  const chunksText = chunks
    .map((chunk, idx) => `[${idx}] ${chunk.text.substring(0, 300)}`)
    .join('\n\n');

  const rerankPrompt = `Given the user's question and a list of information chunks, rank the chunks by relevance (1 = most relevant, ${chunks.length} = least relevant).

User question: ${query}

Chunks:
${chunksText}

Return only a comma-separated list of chunk indices in order of relevance (e.g., "2,0,1,3"):`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a relevance ranking expert. Rank information chunks by how well they answer the user question.',
        },
        {
          role: 'user',
          content: rerankPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 100,
    });

    const ranked = response.choices[0]?.message?.content || '';
    const indices = ranked
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n < chunks.length);

    if (indices.length > 0) {
      return indices.map(idx => chunks[idx]);
    }
  } catch (error) {
    console.error('Re-ranking error:', error);
  }

  // Fallback: return chunks sorted by score
  return chunks.sort((a, b) => b.score - a.score);
}

/**
 * Build RAG prompt with context and conversation history
 */
function buildRAGPrompt(
  query: string, 
  chunks: Array<{ text: string; metadata: any }>,
  conversationHistory: Array<{ role: string; content: string }> = []
): string {
  const contextText = chunks
    .map((chunk, idx) => {
      const source = chunk.metadata.sheet 
        ? `[Source: ${chunk.metadata.sheet}${chunk.metadata.row ? `, Row ${chunk.metadata.row}` : ''}]`
        : '';
      return `${idx + 1}. ${source} ${chunk.text}`;
    })
    .join('\n\n');

  // Build conversation history context
  let conversationContext = '';
  if (conversationHistory.length > 0) {
    conversationContext = '\n\nPrevious conversation:\n' + 
      conversationHistory
        .slice(-6) // Last 6 messages for context
        .map((msg, idx) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          return `${role}: ${msg.content}`;
        })
        .join('\n') +
      '\n\nNote: When the user asks follow-up questions (like "tell me the category", "what about the price", etc.), they are referring to the topic discussed in the previous conversation. Use the conversation history to understand what they are asking about.';
  }

  return `You are Nick, an expert AI assistant specializing in product information. Your goal is to provide 100% accurate answers based on the provided context.

CRITICAL INSTRUCTIONS:
1. ANSWER ACCURACY: Only use information that is explicitly stated in the Knowledge Base Context below. Do not make assumptions or infer information not present.
2. CONVERSATION CONTEXT: If the user asks follow-up questions (like "what's the category?", "tell me the price", "what about features?", etc.), they are referring to the product/topic from the previous conversation. Use the conversation history to understand what they're asking about.
3. COMPLETE ANSWERS: Provide complete, detailed answers. If multiple pieces of information are relevant, include all of them.
4. PRODUCT-SPECIFIC: When answering about products, include all relevant details: name, category, price, features, specifications, etc. from the context.
5. UNCERTAINTY: If the exact information is not in the context, say "Based on the available information, [partial answer]. However, [specific detail] is not available in my knowledge base."
6. FORMAT: Be friendly, professional, and comprehensive. Structure your answer clearly.

Knowledge Base Context:
${contextText}${conversationContext}

Current User Question:
${query}

Provide a complete, accurate answer based ONLY on the Knowledge Base Context above:`;
}

/**
 * Generate answer using OpenAI LLM with conversation history
 */
async function generateAnswer(
  prompt: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<string> {
  const openai = getOpenAIClient();
  
  // Build messages array with conversation history
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: `You are Nick, an expert AI assistant with 100% accuracy requirements. Your responses must be:
1. FACTUALLY ACCURATE - Only use information from the provided context
2. COMPREHENSIVE - Include all relevant details from the context
3. CONTEXT-AWARE - Use conversation history to understand follow-up questions
4. PRODUCT-FOCUSED - When discussing products, include all available details (name, category, price, features, specifications, etc.)
5. CLEAR AND STRUCTURED - Organize information logically

When users ask follow-up questions, use the conversation history to understand what product or topic they're referring to. Always provide complete, accurate answers based on the context provided.`,
    },
  ];

  // Add conversation history (last 8 messages to stay within token limits)
  const recentHistory = conversationHistory.slice(-8);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  // Add the current prompt
  messages.push({
    role: 'user',
    content: prompt,
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o', // Can be changed to gpt-4.1 or gpt-5 when available
    messages: messages,
    temperature: 0.3,
    max_tokens: 500,
  });

  return response.choices[0]?.message?.content || 'Unable to generate answer.';
}

/**
 * Check if query is a greeting or conversational
 */
function isGreetingOrConversational(query: string): boolean {
  const lowerQuery = query.toLowerCase().trim();
  const greetings = [
    'hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon',
    'good evening', 'good night', 'howdy', 'what\'s up', 'sup', 'yo',
    'how are you', 'how do you do', 'nice to meet you'
  ];
  
  const conversational = [
    'thank you', 'thanks', 'bye', 'goodbye', 'see you', 'talk to you',
    'what can you do', 'help', 'who are you', 'what are you'
  ];

  return greetings.some(greeting => lowerQuery.includes(greeting)) ||
         conversational.some(phrase => lowerQuery.includes(phrase)) ||
         lowerQuery.length < 10 && /^[a-z\s]+$/.test(lowerQuery);
}

/**
 * Handle conversational queries
 */
async function handleConversationalQuery(query: string): Promise<string> {
  const lowerQuery = query.toLowerCase().trim();
  
  if (lowerQuery.includes('hello') || lowerQuery.includes('hi') || lowerQuery.includes('hey')) {
    return "Hello! I'm Nick, your AI assistant. I'm here to help you with questions about our products and services. What would you like to know?";
  }
  
  if (lowerQuery.includes('thank')) {
    return "You're welcome! Is there anything else I can help you with?";
  }
  
  if (lowerQuery.includes('bye') || lowerQuery.includes('goodbye')) {
    return "Goodbye! Feel free to come back if you have any questions. Have a great day!";
  }
  
  if (lowerQuery.includes('how are you')) {
    return "I'm doing great, thank you for asking! I'm here and ready to help you with any questions about our products. What can I assist you with today?";
  }
  
  if (lowerQuery.includes('what can you do') || lowerQuery.includes('help')) {
    return "I can help you find information about our products and services. Just ask me questions like 'What products do you have?', 'Tell me about product X', or any other questions about our offerings. What would you like to know?";
  }
  
  if (lowerQuery.includes('who are you') || lowerQuery.includes('what are you')) {
    return "I'm Nick, your AI assistant powered by advanced AI technology. I can help you find information about our products and answer questions using our knowledge base. How can I assist you today?";
  }
  
  // Default conversational response
  return "I'm here to help! Feel free to ask me any questions about our products or services. What would you like to know?";
}

/**
 * Expand and rewrite query using LLM for better retrieval
 */
async function expandQuery(query: string, conversationHistory: Array<{ role: string; content: string }>): Promise<string[]> {
  const openai = getOpenAIClient();
  
  // Build context from conversation history
  const contextSummary = conversationHistory.length > 0
    ? `Previous conversation context: ${conversationHistory
        .slice(-4)
        .map(msg => `${msg.role}: ${msg.content}`)
        .join(' | ')}`
    : '';

  const expansionPrompt = `Given the user's question and conversation context, generate 3-5 alternative phrasings and expanded queries that would help find relevant information in a product database. Include:
1. The original query
2. Synonyms and related terms
3. Product-specific variations
4. Context-aware expansions if there's conversation history

User question: ${query}
${contextSummary}

Return only the expanded queries, one per line, without numbering or bullets:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a query expansion expert. Generate alternative phrasings of user queries to improve information retrieval.',
        },
        {
          role: 'user',
          content: expansionPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const expanded = response.choices[0]?.message?.content || query;
    const queries = expanded
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0)
      .slice(0, 5); // Limit to 5 queries
    
    // Always include original query
    return [query, ...queries.filter(q => q !== query)].slice(0, 5);
  } catch (error) {
    console.error('Query expansion error:', error);
    return [query]; // Fallback to original query
  }
}

/**
 * Extract product/entity context from conversation history
 */
function extractContextFromHistory(conversationHistory: Array<{ role: string; content: string }>): string {
  if (conversationHistory.length === 0) return '';

  // Get all recent messages
  const recentMessages = conversationHistory.slice(-6);
  
  // Extract from user messages (product names, entities)
  const userMessages = recentMessages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');

  // Extract from assistant messages (might contain product info)
  const assistantMessages = recentMessages
    .filter(msg => msg.role === 'assistant')
    .map(msg => msg.content)
    .join(' ');

  // Combine all context
  const allContext = [userMessages, assistantMessages]
    .filter(s => s.length > 0)
    .join(' ');
  
  return allContext;
}

/**
 * Check if query is a follow-up question
 */
function isFollowUpQuestion(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const followUpPatterns = [
    'tell me', 'what about', 'what is', 'what are', 'how much', 'how many',
    'what\'s the', 'what are the', 'give me', 'show me', 'can you tell',
    'category', 'price', 'cost', 'description', 'details', 'specification',
    'features', 'benefits', 'about it', 'about that', 'more about',
    'the same', 'that product', 'this product', 'it', 'they', 'them'
  ];
  
  return followUpPatterns.some(pattern => lowerQuery.includes(pattern));
}

/**
 * Main RAG function with conversation history - Enhanced for maximum accuracy
 */
export async function runRAG(
  query: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<RAGResult> {
  try {
    // Handle greetings and conversational queries (only if no conversation history)
    if (conversationHistory.length === 0 && isGreetingOrConversational(query)) {
      const conversationalAnswer = await handleConversationalQuery(query);
      return {
        answer: conversationalAnswer,
      };
    }

    // Step 1: Expand query for better retrieval
    const expandedQueries = await expandQuery(query, conversationHistory);
    
    // Step 2: Extract context from conversation history
    const contextFromHistory = extractContextFromHistory(conversationHistory);
    const isFollowUp = isFollowUpQuestion(query);

    // Step 3: Try multiple retrieval strategies
    let allChunks: Array<{ text: string; metadata: any; score: number }> = [];
    const seenTexts = new Set<string>();

    // Strategy 1: Try each expanded query
    for (const expandedQuery of expandedQueries.slice(0, 3)) { // Limit to 3 to avoid too many API calls
      try {
        const embedding = await generateQueryEmbedding(expandedQuery);
        const chunks = await retrieveChunks(embedding, 10);
        
        // Add unique chunks
        for (const chunk of chunks) {
          const chunkKey = chunk.text.substring(0, 100);
          if (!seenTexts.has(chunkKey)) {
            seenTexts.add(chunkKey);
            allChunks.push(chunk);
          }
        }
      } catch (error) {
        console.error('Retrieval error for expanded query:', error);
      }
    }

    // Strategy 2: If follow-up, try with context-enhanced query
    if (isFollowUp && contextFromHistory && allChunks.length < 5) {
      try {
        const contextQuery = `${contextFromHistory} ${query}`;
        const embedding = await generateQueryEmbedding(contextQuery);
        const chunks = await retrieveChunks(embedding, 10);
        
        for (const chunk of chunks) {
          const chunkKey = chunk.text.substring(0, 100);
          if (!seenTexts.has(chunkKey)) {
            seenTexts.add(chunkKey);
            allChunks.push(chunk);
          }
        }
      } catch (error) {
        console.error('Context-enhanced retrieval error:', error);
      }
    }

    // Step 4: Filter and re-rank chunks
    const scoreThreshold = isFollowUp ? 0.25 : 0.4; // Lower threshold for better recall
    let relevantChunks = allChunks.filter(chunk => chunk.score > scoreThreshold);
    
    // If still not enough chunks, lower threshold further
    if (relevantChunks.length < 3 && allChunks.length > 0) {
      relevantChunks = allChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    }

    // Step 5: Re-rank chunks by relevance using LLM
    if (relevantChunks.length > 3) {
      relevantChunks = await rerankChunks(query, relevantChunks);
    } else {
      relevantChunks = relevantChunks.sort((a, b) => b.score - a.score);
    }

    // Step 6: Take top chunks (limit to 8 for prompt size)
    const finalChunks = relevantChunks.slice(0, 8);

    if (finalChunks.length === 0) {
      // Last resort: try original query with very low threshold
      try {
        const originalEmbedding = await generateQueryEmbedding(query);
        const originalChunks = await retrieveChunks(originalEmbedding, 15);
        const lowThresholdChunks = originalChunks
          .filter(chunk => chunk.score > 0.2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        
        if (lowThresholdChunks.length > 0) {
          const prompt = buildRAGPrompt(query, lowThresholdChunks, conversationHistory);
          const answer = await generateAnswer(prompt, conversationHistory);
          return {
            answer,
            sources: lowThresholdChunks.map((chunk) => ({
              sheet: chunk.metadata.sheet || 'Unknown',
              row: chunk.metadata.row,
              text: chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''),
            })),
          };
        }
      } catch (error) {
        console.error('Fallback retrieval error:', error);
      }

      return {
        answer: "I couldn't find specific information about that in my knowledge base. Could you please provide more details or rephrase your question? I'm here to help with questions about our products and services.",
      };
    }

    // Step 7: Build enhanced prompt with all context
    const prompt = buildRAGPrompt(query, finalChunks, conversationHistory);

    // Step 8: Generate answer with conversation history
    const answer = await generateAnswer(prompt, conversationHistory);

    // Step 9: Extract sources
    const sources = finalChunks.map((chunk) => ({
      sheet: chunk.metadata.sheet || 'Unknown',
      row: chunk.metadata.row,
      text: chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''),
    }));

    return {
      answer,
      sources,
    };
  } catch (error) {
    console.error('RAG error:', error);
    throw new Error(`RAG processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

