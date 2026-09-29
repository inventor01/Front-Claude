# AI Employee OS — Railway backend

Railway-native backend for the AI Employee OS.

## Services
- API: `node dist/api.js`
- Worker: `node dist/worker.js`
- PostgreSQL: source of truth

## What this migration fixes
- chat requests no longer need to stay open for work to continue
- jobs are persistent and claimed with PostgreSQL `FOR UPDATE SKIP LOCKED`
- work is step-based and resumable
- employee handoffs are persisted as structured messages
- approvals and company membership are enforced server-side
- state is normalized instead of one giant serialized company blob
- Front-Commerce is consumed through a structured service API

## Required variables
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONT_COMMERCE_URL` (when Front-Commerce is deployed)
- `FRONT_COMMERCE_API_KEY` (when Front-Commerce is deployed)

## Known partial areas
Product Research beyond the Front scan still needs supplier/economics adapters and the model runtime. Those steps intentionally report blocked status rather than fake completion.
