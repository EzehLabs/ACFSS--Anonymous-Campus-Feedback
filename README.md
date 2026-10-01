# Anonymous Campus Feedback System

## Render deployment and database persistence

The application stores feedback and admin accounts in a SQLite database. Render's
filesystem is ephemeral unless a persistent disk is attached, so the database
must be stored on that disk to survive restarts and deploys.

For an existing Render web service:

1. Before changing the service or triggering a deploy, back up and download any
   database file on the currently running instance that contains records you
   need. Adding a disk or changing the database path does not copy the old file.
2. Open the service's **Disks** page and attach a persistent disk mounted at
   `/var/data`. SQLite on a Render disk requires a paid web service and a single
   service instance.
3. In **Environment**, set `DATABASE_PATH` to `/var/data/complaints.db`.
4. Keep `SUPER_ADMIN_PASSWORD` set to the intended super-admin password. Also
   configure the email provider required for super-admin email verification.
5. Deploy and check the startup logs. They should say that SQLite connected at
   `/var/data/complaints.db`. The application refuses to start on Render if the
   database path is not on the mounted disk or the mount is unavailable.

To migrate a backup, upload it to a separate filename on the mounted disk (for
example, `/var/data/restore.db`) using Render's Shell and secure file transfer
options. Then point `DATABASE_PATH` to that uploaded file and redeploy. Do not
overwrite a database file that the running application is using or that already
contains records. If data was already lost when an ephemeral instance restarted,
check for a local backup or an available disk snapshot; deploying this fix
cannot recreate missing records.

The database file is not committed to Git and is blocked from static downloads.
Keep `DATABASE_PATH` on persistent storage in any other deployment environment
as well.
