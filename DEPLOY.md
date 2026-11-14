# Launching FireScope online

This guide gets your app from your laptop onto a public website, with your processed Europe data, an admin password, and HTTPS. It also covers how to make changes later.

```
Your PC (develop & test)  ──git push──▶  GitHub (code)  ──git pull──▶  Server (public site)
        │                                                                   ▲
        └──────── database file (firescope.duckdb, copied once) ────────────┘
```

---

## Step 1 — Export your processed database (on your PC)

The database holds all your uploaded and harmonised data. Copying it means the server doesn't need to re-process the NASA files.

In PowerShell, in the project folder:
```powershell
docker compose stop
mkdir exports -Force
docker compose cp backend:/data/firescope.duckdb .\exports\firescope.duckdb
docker compose start
```
Check that `exports\firescope.duckdb` exists. It's probably 1–3 GB. Keep it as your backup too; `exports/` is excluded from GitHub.

---

## Step 2 — Put the code on GitHub (on your PC)

**Easiest: GitHub Desktop** (https://desktop.github.com)
1. **File → Add local repository** and choose the `firescope` project folder. If it says "not a git repository", click **create a repository** there.
2. Check the list of changed files. You should **not** see `backend/.env`, `node_modules`, `*.duckdb`, `exports/` or your NASA data; `.gitignore` excludes them. If `backend/.env` appears, stop: it contains your NASA key.
3. Write a summary such as "FireScope launch", then **Commit to main**.
4. **Publish repository**. Choose public or private (private also works for the server; you'll log in when cloning).

**Or, with git in PowerShell:**
```powershell
git init
git add .
git status            # make sure backend/.env is NOT listed
git commit -m "FireScope launch"
git branch -M main
git remote add origin https://github.com/<your-username>/firescope.git
git push -u origin main
```

---

## Step 3 — Rent a server

Any provider that offers an Ubuntu virtual server works (Hetzner, DigitalOcean, AWS Lightsail, Google Cloud, Azure, …). Choose:

| Setting | Value |
|---|---|
| Image / OS | **Ubuntu 24.04** |
| Memory | **8 GB RAM or more** (16 GB if you add the global layer) |
| Disk | **80 GB+** |
| Location | Close to your users (e.g. Europe) |
| Login | SSH key (recommended) or password |

Note the server's **IP address**. Many providers have student credits (e.g. the GitHub Student Developer Pack); compare current prices before choosing.

**Optional: a domain name.** Buy one (e.g. `firescope.app`) and create an **A record** pointing to the server's IP. With a domain you get automatic HTTPS (`https://firescope.app`); without one, the site works at `http://<server-ip>`.

---

## Step 4 — Set up the server

Connect from PowerShell on your PC:
```powershell
ssh root@<server-ip>
```

Then, on the server:
```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Firewall: allow SSH and web traffic only
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# 3. Get your code
git clone https://github.com/<your-username>/firescope.git
cd firescope

# 4. Backend settings (NASA key + admin password)
cp backend/.env.example backend/.env
nano backend/.env
```
In `backend/.env` set:
```
FIRMS_MAP_KEY=<your NASA key>
FIRESCOPE_DEMO=0
FIRESCOPE_ADMIN_TOKEN=<a long password only you know>
```
Save with **Ctrl+O, Enter, Ctrl+X**.

```bash
# 5. Site address
cp deploy/.env.example .env
nano .env        # SITE_ADDRESS=firescope.app   (or keep :80 to use the IP address)
```

---

## Step 5 — Upload your database to the server

From PowerShell on **your PC** (not in the SSH window):
```powershell
scp .\exports\firescope.duckdb root@<server-ip>:/root/firescope/exports.duckdb
```
This can take a while for a few GB.

Back on the **server**:
```bash
cd ~/firescope
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml cp exports.duckdb backend:/data/firescope.duckdb
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
rm exports.duckdb
```

---

## Step 6 — Check the launch

1. Open `https://<your-domain>` (or `http://<server-ip>`).
2. The dataset should be **Live FIRMS** and the coverage table (Data Sources) should show your uploads.
3. Data Sources should say **"Admin tools are locked"**. Unlock it with your admin password to confirm it works, then press **Lock admin tools**.
4. Open your Europe area once (Burning Calendar, Harmonization Lab) so the first heavy calculation is done before visitors arrive.

To see logs if something goes wrong:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail 100 backend
```

---

## Making changes later

1. **On your PC:** edit the code, then test locally with `docker compose up --build` at http://localhost:8080.
2. **Commit and push** with GitHub Desktop (Commit, then Push origin), or `git commit -am "…" && git push`.
3. **On the server:**
   ```bash
   cd ~/firescope
   git pull
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   Your data stays: it lives in a Docker volume, separate from the code.

**Adding data later:** open the live site → Data Sources → unlock with the admin password → upload NASA CSV files or start a sync.

---

## Backups

On the server, occasionally:
```bash
cd ~/firescope
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml cp backend:/data/firescope.duckdb ~/backup-$(date +%F).duckdb
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```
Copy it to your PC with `scp root@<server-ip>:~/backup-*.duckdb .` from PowerShell.

---

## Security checklist

- [ ] `FIRESCOPE_ADMIN_TOKEN` is set to a long, unique password.
- [ ] `backend/.env` was **not** pushed to GitHub (check the repository's file list).
- [ ] Firewall allows only 22, 80 and 443.
- [ ] Optional: `FIRESCOPE_CORS=https://<your-domain>` in `backend/.env`.
