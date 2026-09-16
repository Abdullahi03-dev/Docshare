# Filesharer Backend (NestJS)

Super-fast file sharing API. First version: local disk + streaming.

## Run

```bash
cd backend
npm install
npm run start:dev
```

Backend: http://localhost:3001/api
- `GET /api/` -> hello
- `GET /api/health` -> health
- `POST /api/files/upload` (form-data `file`) -> upload any file
- `GET /api/files` -> list
- `GET /api/files/:name/download` -> stream download
- `DELETE /api/files/:name` -> delete

Frontend (Next.js) lives in `../docsharing`, runs on :3000. CORS is already enabled.

## How it works (learn as we build)
- `src/main.ts` = entry, enables CORS, sets `/api` prefix
- `src/app.module.ts` = root module
- `src/files/` = feature module (controller = routes, service = logic)
- `multer diskStorage` = streams upload straight to `./uploads`, no RAM bloat
- `createReadStream().pipe(res)` = streams download, fast for big files

Next steps we can add: DB + auth, share links, chunked/resumable uploads, WebSocket progress.
