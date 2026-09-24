# Bloom — frontend

Next.js (App Router) consumer app for Bloom. The screens are `/` (home), `/chat` (Ask Bloom), `/agent` (goals and agent policy), `/risk` (risk dashboard and demo controls), `/activity` and `/claim/[id]`.

All data comes from the Bloom backend (`docs/API.md`). The frontend contains no mock data.

```bash
npm install
NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev   # http://localhost:3000
npm run build && npm run lint && npx tsc --noEmit
```
