# Railway Infrastructure as Code

This project defines its Railway service in `.railway/railway.ts`.

```bash
# Requires Railway CLI 5.42.1+ installed and authenticated.
railway --version
npm install
npm run railway:plan
npm run railway:apply
```

`railway:plan` is read-only. Review its output before running `railway:apply`.
The apply command changes the linked Railway environment and asks for confirmation.