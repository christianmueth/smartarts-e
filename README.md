# SmartArts

SmartArts is an AI-assisted creative production studio built with Next.js, Clerk, and Prisma.

The current MVP is centered on a complete visual workflow:

- Clerk authentication
- project-scoped conversations, assets, and history
- AI image generation with prompt enhancement
- natural-language image edits like "make this blue" or "remove the background"
- searchable asset history
- one-click export presets for PNG, SVG, PDF, favicon, and social sizes

## Core Flow

Each project acts as a durable creative container.

- Conversations stay attached to the project.
- Generated and edited assets accumulate in a searchable library.
- Prompt history is preserved so iterations are easy to revisit.
- Exports are available directly from the selected asset.

The main studio surface lives at `/app/studio`.

## Stack

- Next.js App Router
- React 19
- Clerk for authentication
- Prisma with PostgreSQL
- OpenAI-compatible image generation APIs
- Stripe for premium billing gates
- Vercel Blob for uploads where needed

## Environment

Create `.env.local` with the values you need for your environment.

```env
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
OPENAI_API_KEY=sk_...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-1
STRIPE_SECRET_KEY=sk_live_xxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
STRIPE_PREMIUM_PRICE_ID=price_xxxxxxxxx
STRIPE_ORGANIZATION_PRICE_ID=price_xxxxxxxxx
NEXT_PUBLIC_APP_URL=https://YOUR-DOMAIN.com
```

Notes:

- `OPENAI_API_KEY` is required for studio image generation and edit flows.
- `OPENAI_BASE_URL` can point to any OpenAI-compatible endpoint.
- Stripe currently gates paid image generation features and the higher Organization tier.

## Local Development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Database

Generate the Prisma client:

```bash
npx prisma generate
```

Apply migrations in your target environment before deploying:

```bash
npx prisma migrate deploy
```

The studio MVP depends on the project tables added in `prisma/migrations/20260729120000_add_studio_projects`.

## Deployment

Production build:

```bash
npm run build
```

Stripe webhook endpoint:

```text
/api/stripe/webhook
```

## Current Scope

The repository still contains some earlier workspace and whiteboard surfaces, but the active product direction is SmartArts as an AI creative studio. New work should preserve that direction rather than reintroducing tutoring-oriented positioning.
