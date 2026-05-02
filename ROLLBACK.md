# Rollback Instructions — Anahuac RV Park

## Quick Rollback via Railway Dashboard

1. Go to **Railway Dashboard** → your project → **Deployments** tab
2. Find the **last working deploy** (the one before the broken one)
3. Click the **three dots** (⋯) on that deployment
4. Click **Redeploy**
5. Wait for the new deployment to go live (~1-2 minutes)
6. Verify at: https://web-production-89794.up.railway.app/api/health

## Rollback via CLI

```bash
# List recent deploys
railway status

# Redeploy a specific commit
git log --oneline -10          # find the last good commit hash
git revert HEAD                # revert the bad commit
git push                       # push the revert
railway up --detach             # deploy
```

## Rollback via Git (Nuclear Option)

```bash
# Reset to a known good commit (DESTRUCTIVE — only if needed)
git reset --hard <good-commit-hash>
git push --force
railway up --detach
```

## Database Rollback

The database lives on a Railway volume at `/app/data/rvpark.db`. Code deploys do NOT affect the database file. If the database itself is corrupted:

1. Go to **Admin Dashboard** → **Backups**
2. Download the most recent backup
3. Or use the admin restore endpoint to upload a backup file

## Post-Rollback Checklist

- [ ] Check https://web-production-89794.up.railway.app/api/health returns `{"status":"ok"}`
- [ ] Log into portal as a tenant — verify balance shows correctly
- [ ] Check admin dashboard loads
- [ ] Check Railway logs for any `[CRITICAL]` errors: `railway logs | grep CRITICAL`

## Emergency Contact

If the portal is down and tenants can't see balances or pay:
- The office phone is 409-267-6603
- Tenants can always pay in person at the office
