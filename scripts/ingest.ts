import * as XLSX from 'xlsx';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT || 'us-east-1';

if (!OPENAI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX) {
  throw new Error('Missing required environment variables: OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});

// Token estimation (rough: 1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Chunk text into 500-900 token chunks
function chunkText(text: string, maxTokens: number = 800): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    const currentTokens = estimateTokens(currentChunk);

    if (currentTokens + sentenceTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

// Clean and normalize text
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim();
}

// Convert Excel sheet to clean text chunks
function processSheet(workbook: XLSX.WorkBook, sheetName: string): Array<{ text: string; metadata: any }> {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];

  // Convert to JSON with header row
  const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  
  const chunks: Array<{ text: string; metadata: any }> = [];
  
  // Process each row
  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i];
    
    // Filter out empty rows
    const hasData = Object.values(row).some((val: any) => 
      val !== null && val !== undefined && String(val).trim() !== ''
    );
    
    if (!hasData) continue;

    // Convert row to structured text
    const rowText = Object.entries(row)
      .map(([key, value]) => {
        const val = String(value || '').trim();
        return val ? `${key}: ${val}` : '';
      })
      .filter(Boolean)
      .join(' | ');

    if (rowText) {
      const cleanedText = cleanText(rowText);
      chunks.push({
        text: cleanedText,
        metadata: {
          sheet: sheetName,
          row: i + 2, // +2 because Excel is 1-indexed and we have headers
          rowIndex: i,
        }
      });
    }
  }

  // Also create larger chunks for better context
  const allText = chunks.map(c => c.text).join(' | ');
  const largeChunks = chunkText(allText, 800);
  
  // Return both row-level and chunk-level data
  const result: Array<{ text: string; metadata: any }> = [];
  
  // Add row-level chunks
  for (const chunk of chunks) {
    if (estimateTokens(chunk.text) >= 50) { // Only include substantial rows
      result.push(chunk);
    }
  }
  
  // Add larger context chunks
  for (let i = 0; i < largeChunks.length; i++) {
    result.push({
      text: largeChunks[i],
      metadata: {
        sheet: sheetName,
        chunkIndex: i,
        type: 'context_chunk',
      }
    });
  }

  return result;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
    dimensions: 1024, // Match your Pinecone index dimensions
  });

  return response.data[0].embedding;
}

async function ingest() {
  console.log('🚀 Starting ingestion process...');

  // Read XLSX file - try multiple possible locations
  const possiblePaths = [
    path.join(process.cwd(), 'Products Data.xlsx'),
    path.join(process.cwd(), 'data', 'knowledge.xlsx'),
    path.join(process.cwd(), 'knowledge.xlsx'),
  ];
  
  let xlsxPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      xlsxPath = p;
      break;
    }
  }
  
  if (!xlsxPath) {
    throw new Error(`XLSX file not found. Tried: ${possiblePaths.join(', ')}`);
  }

  console.log(`📖 Reading XLSX file: ${xlsxPath}`);
  const workbook = XLSX.readFile(xlsxPath);
  const sheetNames = workbook.SheetNames;

  console.log(`📊 Found ${sheetNames.length} sheet(s): ${sheetNames.join(', ')}`);

  // Process all sheets
  const allChunks: Array<{ text: string; metadata: any }> = [];
  
  for (const sheetName of sheetNames) {
    console.log(`\n📄 Processing sheet: ${sheetName}`);
    const chunks = processSheet(workbook, sheetName);
    allChunks.push(...chunks);
    console.log(`   Generated ${chunks.length} chunks`);
  }

  console.log(`\n📦 Total chunks to process: ${allChunks.length}`);

  // Get Pinecone index
  const index = pinecone.index(PINECONE_INDEX);

  // Process chunks in batches
  const batchSize = 100;
  let processed = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`);

    const vectors = await Promise.all(
      batch.map(async (chunk, idx) => {
        const embedding = await generateEmbedding(chunk.text);
        return {
          id: `${chunk.metadata.sheet}_${chunk.metadata.type || 'row'}_${chunk.metadata.rowIndex || chunk.metadata.chunkIndex || idx}_${i + idx}`,
          values: embedding,
          metadata: {
            text: chunk.text,
            ...chunk.metadata,
          },
        };
      })
    );

    await index.upsert(vectors);
    processed += batch.length;
    console.log(`   ✅ Upserted ${batch.length} vectors (${processed}/${allChunks.length} total)`);
    
    // Rate limiting - small delay between batches
    if (i + batchSize < allChunks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✨ Ingestion complete! Processed ${processed} chunks.`);
  console.log(`📊 Index: ${PINECONE_INDEX}`);
}

// Run ingestion
ingest().catch((error) => {
  console.error('❌ Ingestion failed:', error);
  process.exit(1);
});

