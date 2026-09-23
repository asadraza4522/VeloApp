# Velo

Save. Convert. Organize. — a media source manager, downloader, converter and organizer.

- Product: [memory/Velo PRD v1.1.md](memory/Velo%20PRD%20v1.1.md)
- Architecture + roadmap: [docs/VELO_TECHNICAL_PLAN.md](docs/VELO_TECHNICAL_PLAN.md)
- Working notes for Claude: [CLAUDE.md](CLAUDE.md)

## Run the app (Android)

```bash
cd frontend
cp .env.example .env.local
npm install
npx expo run:android      # builds + installs the dev client (needs Android SDK + JDK 17+)
npm start                 # Metro for the dev client
```

`EXPO_PUBLIC_DISTRIBUTION=full|lite` selects the variant (default `full`); see the plan §7.5.

## Checks

```bash
cd frontend && npm run typecheck && npm run lint && npm test
```

`frontend/_legacy/` and `backend/` are the pre-plan demo code, kept for reference until ported (plan §14).
