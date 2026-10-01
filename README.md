# Anonymous Campus Feedback System

## Hosted PostgreSQL setup (Render + Neon)

The application uses PostgreSQL for feedback, admin accounts, dashboard
preferences, and temporary login verification codes. The database is hosted
separately from Render, so a Render disk is not needed.

Feedback is checked for personal information before it is stored. Submissions
containing detected personal details are rejected; the moderation log records
only the category and detected information types, never the submitted message
or the personal data itself. Possible unverified claims can be flagged using
configurable review phrases. Phrase matches are only prompts for staff review:
the application does not determine whether a statement is true or false.
Authenticated admins can view filter logs; only the super admin can edit review
phrases and toggle claim flagging. Personal-information blocking is always on.

1. Create a PostgreSQL project in Neon and copy its pooled connection string
   from the **Connect** dialog. Keep the connection string private.
2. If you have a surviving SQLite database or backup, import it into the new,
   empty Neon database before deploying the app (see below). This prevents the
   app from seeding a new super-admin account before the old accounts are
   imported.
3. In Render, open the web service's **Environment** settings and set
   `DATABASE_URL` to the Neon connection string. Add `SUPER_ADMIN_PASSWORD`
   and a long, random `JWT_SECRET`; set `SUPER_ADMIN_EMAIL` if the default
   address is not the intended super-admin account.
4. Save the environment changes and deploy the updated application. On startup,
   it creates the required tables and reports `Connected to PostgreSQL database`.
   It exits with a clear error if `DATABASE_URL` is missing or the database
   connection/schema initialization fails.

Never put real database credentials in source control, browser code, screenshots,
or chat. A safe placeholder configuration is in `.env.example`; the actual
`.env` file is ignored by Git.

## Importing existing SQLite data

The one-time importer reads a local SQLite backup without modifying it and
copies admins, feedback, preferences, and login codes to the configured
PostgreSQL database. It creates the PostgreSQL tables, so you can run it before
the first app deployment. Install/use Node.js 22.13 or newer (the Render
service currently uses Node 24), set `DATABASE_URL` locally to the Neon
connection string, and run from the project directory:

```powershell
$env:DATABASE_URL = "your-Neon-connection-string"
node .\migrate-sqlite-to-postgres.js
```

To import a backup at a different location, set `SQLITE_PATH` to that file
before running the script. The importer skips rows that conflict with records
already in PostgreSQL; it does not overwrite them. It runs the import in a
transaction and leaves the source SQLite database untouched. Use a new, empty
Neon database for the cleanest migration. Back up both databases first. Do not
deploy an SQLite backup containing records to a public web directory.

This can restore records only if a surviving SQLite database or backup exists.
Rows already lost from an ephemeral Render filesystem cannot be recreated.
