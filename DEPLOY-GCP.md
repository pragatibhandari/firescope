# FireScope launch plan: Google Cloud (free $300 credit) + free domain

Uses the NASA Space Apps Global Offers:
- **Google Cloud:** $300 credit for 90 days, for the server.
- **GoDaddy Registry / Porkbun:** a free domain for one year, for the web address.

HTTPS is created automatically by the app's Caddy setup.

Total time: about 2–3 hours, plus data uploads.

```
Your PC ──git push──▶ GitHub ──git clone/pull──▶ Google Cloud VM (Docker)  ◀── yourdomain.com (Porkbun DNS)
   │                                                  ▲
   └──── NASA CSVs uploaded through the website ──────┘  (Data Sources, admin password)
```

---

## Phase 0: Prepare on your PC

1. Make sure the app works locally: `docker compose up --build`, then check http://localhost:8080.
2. **Push the code to GitHub** (GitHub Desktop: Add local repository → Commit → Publish).
   - A **public** repository is simplest: judges can see it, and the server can clone it without a password.
   - Before publishing, check that `backend/.env` is **not** in the file list. It contains your NASA key.

## Phase 1: Claim the offers

1. **Google Cloud:** Space Apps → Global Offers → Google Cloud → Claim Offer → "Get started for free". A card is needed for verification only; the offer states there is no automatic charge after the trial.
2. **Free domain:** Global Offers → GoDaddy Registry → Claim Offer. Search for a non-premium name (for example `firescope-fires.com`), fill in your details, enter the emailed code, and finish registration at Porkbun.

## Phase 2: Create the server (Google Cloud console)

1. Open https://console.cloud.google.com and create a project, for example `firescope`.
2. **Billing → Budgets & alerts → Create budget:** set alerts at $50, $100 and $200.
3. **Compute Engine → VM instances → Create instance** (enable the Compute Engine API if asked):

| Setting | Value |
|---|---|
| Name | `firescope` |
| Region / zone | `europe-north1` (Finland) |
| Machine type | **e2-highmem-2** (2 vCPU, 16 GB RAM). For Europe only, e2-standard-2 (8 GB) is enough. |
| Boot disk | **Ubuntu 24.04 LTS**, **100 GB**, balanced persistent disk |
| Firewall | ✅ Allow HTTP traffic ✅ Allow HTTPS traffic |

4. **VPC network → IP addresses:** find the VM's external IP → **Reserve** (promote to static). Note the IP.

## Phase 3: Point the domain to the server (Porkbun)

In Porkbun → your domain → **DNS**, add:

| Type | Host | Answer |
|---|---|---|
| A | *(leave blank, the root domain)* | `<static IP>` |
| A | `www` | `<static IP>` |

Delete any default "parking" A/ALIAS/CNAME records that point elsewhere. DNS usually updates within minutes, but can take a few hours.

## Phase 4: Install FireScope on the server

In the console, click **SSH** next to your VM. A terminal opens in your browser. Then:

```bash
sudo -i                                   # become administrator
curl -fsSL https://get.docker.com | sh    # install Docker
git clone https://github.com/<your-username>/firescope.git
cd firescope

cp backend/.env.example backend/.env
nano backend/.env
```
Set these lines in `backend/.env` (save: Ctrl+O, Enter, Ctrl+X):
```
FIRMS_MAP_KEY=<your NASA key>
FIRESCOPE_DEMO=0
FIRESCOPE_ADMIN_TOKEN=<a long password only you know>
FIRESCOPE_CORS=https://<yourdomain.com>
```
```bash
echo "SITE_ADDRESS=<yourdomain.com>" > .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
The first build takes 3–5 minutes. Check it's running:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail 50 caddy
```
Open `https://<yourdomain.com>`. Caddy fetches the HTTPS certificate automatically once the domain points to the server.

If DNS isn't ready yet and you want to test immediately, temporarily use the IP address:
```bash
echo "SITE_ADDRESS=:80" > .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
Open `http://<static IP>`. When the domain works, set `SITE_ADDRESS=<yourdomain.com>` again and rerun the same `up -d` command.

## Phase 5: Load the data (through the website)

1. On the live site, go to **Data Sources** and unlock with your admin password.
2. Drag your NASA CSV files from your PC's `Data` folder onto the upload box. They upload one by one via the queue. Keep the browser tab open until all are done.
   - Order: the Europe files first, then Argentina, then the world files.
   - Skip the two NOAA-20 *archive* files for Europe, as before.
3. Check the **Data coverage** table.
4. Press **Lock admin tools**.

*Alternative for very slow home internet:* copy your exported `firescope.duckdb` with the browser SSH window (gear menu → Upload file), then follow Step 5 of `DEPLOY.md`.

## Phase 6: Final checks before you share the link

- [ ] `https://` works and shows a padlock.
- [ ] Data Sources says "Admin tools are locked" in a private/incognito window.
- [ ] Open your Europe area once (Calendar + Harmonization Lab) to warm the cache before judges visit.
- [ ] Put the link on your Space Apps project page and in the GitHub README.

## Making changes later

1. **On your PC:** edit, test locally, then commit and push with GitHub Desktop.
2. **On the server** (SSH button):
```bash
sudo -i
cd /root/firescope && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
Your data is kept in a Docker volume and survives updates.

## Keeping costs safe

- Budget alerts are set in Phase 2.
- After judging, **stop** the VM (Compute Engine → ⋮ → Stop) to pause most charges, or **delete** it when you're finished. Reserved static IPs are billed while the VM is stopped, so release the IP too once you're done.
- Before deleting anything, back up the database: in the SSH window, run
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml cp backend:/data/firescope.duckdb /root/backup.duckdb`
  then download it (gear menu → Download file → `/root/backup.duckdb`).
