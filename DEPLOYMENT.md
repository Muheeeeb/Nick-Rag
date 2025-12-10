# Vercel Deployment Guide

This guide will help you deploy the RAG chatbot system to Vercel.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Vercel CLI installed (optional, but recommended)
3. Your environment variables ready:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX` (e.g., `ragchatbot`)
   - `PINECONE_ENVIRONMENT` (e.g., `us-east-1`)

## Deployment Methods

### Method 1: Deploy via Vercel Dashboard (Recommended for First Time)

1. **Push your code to GitHub/GitLab/Bitbucket**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Import Project in Vercel**
   - Go to https://vercel.com/new
   - Click "Import Git Repository"
   - Select your repository
   - Vercel will auto-detect Next.js

3. **Configure Environment Variables**
   - In the project settings, go to "Environment Variables"
   - Add the following:
     - `OPENAI_API_KEY` = `your_openai_key`
     - `PINECONE_API_KEY` = `your_pinecone_key`
     - `PINECONE_INDEX` = `ragchatbot`
     - `PINECONE_ENVIRONMENT` = `us-east-1`
   - Make sure to add them for **Production**, **Preview**, and **Development** environments

4. **Deploy**
   - Click "Deploy"
   - Wait for the build to complete
   - Your app will be live at `https://your-project.vercel.app`

### Method 2: Deploy via Vercel CLI

1. **Install Vercel CLI** (if not already installed)
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel
   ```
   - Follow the prompts
   - When asked about environment variables, you can add them now or later in the dashboard

4. **Set Environment Variables** (if not done during deployment)
   ```bash
   vercel env add OPENAI_API_KEY
   vercel env add PINECONE_API_KEY
   vercel env add PINECONE_INDEX
   vercel env add PINECONE_ENVIRONMENT
   ```

5. **Deploy to Production**
   ```bash
   vercel --prod
   ```

## Post-Deployment Checklist

- [ ] Verify environment variables are set correctly
- [ ] Test the chatbot at your Vercel URL
- [ ] Check that API routes are working (`/api/ask`)
- [ ] Verify Pinecone connection is working
- [ ] Test a few queries to ensure RAG is functioning

## Important Notes

1. **API Route Timeout**: The API route is configured with a 60-second timeout. If you need longer, update `vercel.json`.

2. **Environment Variables**: Never commit `.env` files. They are already in `.gitignore`.

3. **Build Time**: The first build may take a few minutes. Subsequent builds are faster.

4. **Domain**: You can add a custom domain in Vercel project settings.

5. **Monitoring**: Check Vercel dashboard for deployment logs and function logs if issues occur.

## Troubleshooting

### Build Fails
- Check that all dependencies are in `package.json`
- Verify Node.js version (should be 18+)
- Check build logs in Vercel dashboard

### API Returns 500 Error
- Verify all environment variables are set
- Check function logs in Vercel dashboard
- Ensure Pinecone index exists and is accessible

### Chatbot Not Responding
- Check browser console for errors
- Verify API endpoint is accessible
- Test API directly: `curl -X POST https://your-app.vercel.app/api/ask -H "Content-Type: application/json" -d '{"query":"test"}'`

## Updating the Deployment

After making changes:
1. Commit and push to your repository
2. Vercel will automatically redeploy (if auto-deploy is enabled)
3. Or manually trigger: `vercel --prod`

## Support

For issues:
- Check Vercel logs: Dashboard → Your Project → Functions → View Logs
- Check Next.js build output
- Verify environment variables are correct

