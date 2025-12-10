# RAG System for Vercel

A production-ready Retrieval-Augmented Generation (RAG) system optimized for Vercel deployment. This system uses OpenAI embeddings and GPT models with Pinecone as the vector database.

## Architecture

- **Ingestion Layer** (`/scripts/ingest.ts`): Runs locally to process XLSX files, generate embeddings, and upload to Pinecone
- **RAG Logic** (`/src/rag.ts`): Core RAG functionality for querying and generating answers
- **API Endpoint** (`/api/ask.ts`): Vercel serverless function that handles queries
- **Frontend** (`/app` & `/components`): Next.js React application with "Nick" chatbot interface

## Prerequisites

- Node.js 18+ installed
- OpenAI API key
- Pinecone account and API key
- Vercel account (for deployment)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp env.example .env
```

Edit `.env` and add your credentials:

```env
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=your-index-name
PINECONE_ENVIRONMENT=us-east-1
```

### 3. Create Pinecone Index

1. Go to [Pinecone Console](https://app.pinecone.io/)
2. Create a new index with:
   - **Dimensions**: 1024 (configured for `text-embedding-3-large` with dimension reduction)
   - **Metric**: cosine
   - **Name**: Your index name (use this in `PINECONE_INDEX`)
   
   **Note**: If you already have an index named `ragchatbot` with 1024 dimensions, you can use that directly.

### 4. Prepare Your Knowledge Base

Place your XLSX file in the project root as `Products Data.xlsx` (or update the path in `scripts/ingest.ts`).

## Local Ingestion

Run the ingestion script to process your XLSX file and upload embeddings to Pinecone:

```bash
npm run ingest
```

**Note**: The ingestion script:
- Reads all sheets from the XLSX file
- Cleans and chunks the data (500-900 tokens per chunk)
- Generates embeddings using `text-embedding-3-large` with 1024 dimensions
- Uploads vectors to Pinecone with metadata (sheet name, row references)

This process may take several minutes depending on your data size.

## Local Development

### Running the Frontend

To run the Next.js frontend with the Nick chatbot interface:

```bash
npm run dev
```

This starts the Next.js development server at `http://localhost:3000`. Open your browser to see the beautiful chatbot interface.

### Testing the API Directly

You can also test the API endpoint directly:

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "What products do you have?"}'
```

## Deployment to Vercel

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Deploy

```bash
vercel
```

Follow the prompts to link your project.

### 3. Set Environment Variables

In the Vercel dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add the following:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX`
   - `PINECONE_ENVIRONMENT`

Alternatively, use Vercel CLI:

```bash
vercel env add OPENAI_API_KEY
vercel env add PINECONE_API_KEY
vercel env add PINECONE_INDEX
vercel env add PINECONE_ENVIRONMENT
```

### 4. Deploy to Production

```bash
vercel --prod
```

## API Usage

### Endpoint

```
POST /api/ask
```

### Request

```json
{
  "query": "Your question here"
}
```

### Response

```json
{
  "answer": "The answer based on your knowledge base"
}
```

### Example

```bash
curl -X POST https://your-app.vercel.app/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the features of product X?"}'
```

## Testing

### Test Ingestion

```bash
npm run ingest
```

Check the console output for:
- Number of sheets processed
- Number of chunks generated
- Successful upserts to Pinecone

### Test API

```bash
# Local
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Test question"}'

# Production
curl -X POST https://your-app.vercel.app/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Test question"}'
```

## Configuration

### Chunking

Chunk size is configured in `scripts/ingest.ts`:
- Default: 500-900 tokens
- Adjust `maxTokens` parameter in `chunkText()` function

### Model Selection

Change the OpenAI model in `src/rag.ts`:
- Current: `gpt-4o`
- Options: `gpt-4.1`, `gpt-4o`, `gpt-5` (when available)

### Retrieval Top-K

Adjust the number of retrieved chunks in `src/rag.ts`:
- Default: 5 chunks
- Change `topK` parameter in `retrieveChunks()`

## Troubleshooting

### Ingestion Issues

- **File not found**: Ensure `Products Data.xlsx` is in the project root
- **Pinecone errors**: Verify your API key and index name
- **Rate limits**: The script includes delays between batches

### API Issues

- **Timeout errors**: Increase `maxDuration` in `vercel.json`
- **Missing context**: Re-run ingestion to ensure data is in Pinecone
- **Empty responses**: Check that your query matches the data format

## File Structure

```
.
├── api/
│   └── ask.ts              # Vercel serverless API endpoint
├── app/
│   ├── layout.tsx          # Next.js root layout
│   ├── page.tsx            # Home page with chatbot
│   └── globals.css         # Global styles
├── components/
│   ├── NickChatbot.tsx     # Main chatbot component
│   └── NickChatbot.css     # Chatbot styles
├── scripts/
│   └── ingest.ts           # Local ingestion script
├── src/
│   └── rag.ts              # Core RAG logic
├── Products Data.xlsx      # Your knowledge base (not in repo)
├── package.json
├── tsconfig.json
├── next.config.js          # Next.js configuration
├── vercel.json
├── env.example
└── README.md
```

## License

MIT

