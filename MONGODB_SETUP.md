# MongoDB setup

1. Create a MongoDB Atlas cluster and database user. Keep the connection string private.
2. Copy `.env.example` to `.env`, then set `MONGODB_URI` to the Atlas connection string and optionally set `MONGODB_DB` (defaults to `mytimemap`). The server loads `.env` automatically; `.env` is ignored by Git.
3. Run `npm install`, then `npm run dev` for local development. Use `npm start` in production.

If you prefer not to use `.env`, PowerShell can set the variables for the current terminal session with:

```powershell
$env:MONGODB_URI = "mongodb+srv://<username>:<password>@<cluster-host>/"
$env:MONGODB_DB = "mytimemap"
npm run dev
```

If MongoDB is connected and its `users` collection is empty, the app imports the existing `data/mytimemap.json` records into MongoDB on startup. Keep a backup of that JSON file until you confirm the records are present in Atlas. When `MONGODB_URI` is unset in development, the app continues using the local JSON file. Production startup requires `MONGODB_URI`.

Configure the hosting service to bind `PORT` and `HOST=0.0.0.0`. Store the Atlas URI in the host's secret environment-variable settings, never in Git. This app keeps a small working copy in memory and is intended to run as one server instance.
