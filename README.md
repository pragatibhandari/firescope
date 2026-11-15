# FireScope: one consistent burning-activity record from MODIS and VIIRS

**Live app:** https://myfirescope.earth
**Challenge:** NASA Space Apps Challenge 2026, *Harmonization of MODIS and VIIRS Hot Spots*

Satellites have watched for active fires for more than 25 years, but the record is split between two sensors. MODIS (Terra and Aqua, since 2000) sees 1 km pixels. VIIRS (S-NPP since 2012, then NOAA-20 and NOAA-21) sees 375 m pixels and detects many more, smaller fires. Put the two side by side and fire activity seems to jump in 2012, when nothing changed on the ground.

FireScope harmonises the two records into one burning-activity calendar from 2000 to today. Pick any area and dates, see when and where it burned, compare this month with the area's own history, and download the data.

---

## What you can do

| | |
|---|---|
| **Global Fire Map** | A 3D globe showing real MODIS and VIIRS detections. Hotspots are drawn while the data downloads. Choose an area with *Select area*, a country name, or coordinates (`-34.6, -58.4`). |
| **Burning Calendar** | The core output: a year × month calendar of harmonised activity on a colour-blind-friendly scale, plus daily, weekly, yearly and seasonal views and a "this year vs historical median" chart. |
| **Anomaly Detection** | Flags months and days that depart from the area's own baseline for the same time of year (robust z-score on median/MAD). |
| **Harmonization Lab** | Shows the method at work: the raw jump at the 2012 sensor transition versus the harmonised series, the calibration fit, leave-one-year-out validation and a sensitivity analysis. |
| **Reports & Export** | CSV of hotspots (with harmonisation status), harmonised daily and monthly series, GeoJSON, and a PDF report. Every export records the area, period and parameters used. |
| **Methodology** | Assumptions, uncertainty and limitations, in plain language. |

---

## How the harmonisation works

1. **One VIIRS satellite per day.** S-NPP, else NOAA-20, else NOAA-21, so new satellites don't inflate the activity count.
2. **Common grid.** Detections are assigned to 0.01° cells (about the MODIS pixel size) and days.
3. **Count cell-days, not pixels.** All of one sensor's detections in a cell on a day count once. This removes the effect of VIIRS's smaller pixels and of repeated overpasses.
4. **Match the two sensors.** MODIS and VIIRS cell-days within 2 km on the same day are the same activity. Combined activity = VIIRS cell-days + MODIS cell-days that VIIRS did not see. Nothing is counted twice.
5. **Calibrate over the overlap.** In each area's own 2012+ overlap, FireScope learns how MODIS-only counts relate to the combined record (a seasonal ratio with shrinkage, or a Theil–Sen fit) and applies it to 2000–2011. Uncertainty comes from leave-one-year-out cross-validation. If an area has too little overlap, the app says so and leaves the earlier years uncalibrated.
6. **Fire Activity Index.** Confidence-weighted (optionally FRP-weighted) harmonised cell-days.

A unit test (`backend/tests`) checks that a known 3× sensor ratio is recovered with no step at the transition.

**Validation status:** the statistics in the app are internal consistency checks. The method has not yet been validated against independent burned-area products (e.g. MODIS MCD64A1, EFFIS). That is the next step.

---

## Data

All fire data are real NASA FIRMS active-fire detections:
- **MODIS** Collection 6.1 (Terra, Aqua), 1 km
- **VIIRS** 375 m (S-NPP, NOAA-20, NOAA-21)
- Standard (SP) archive and Near Real-Time (NRT) products

The live deployment holds about 44 million detections:
- full 2000–2026 history for **Europe, North America and Argentina**
- **global** coverage for 2026

The server tops up the newest NRT detections from the FIRMS API every 3 hours.

---

## Run it yourself

```bash
cp backend/.env.example backend/.env   # add your free FIRMS_MAP_KEY
docker compose up --build              # http://localhost:8080
```

Load data in **Data Sources**:
- sync an area from the FIRMS API, or
- upload FIRMS archive downloads (`fire_archive_*.csv`, `fire_nrt_*.csv`) from https://firms.modaps.eosdis.nasa.gov/download/

Uploading, syncing and deleting need the admin password set in `backend/.env`. Deployment notes: `DEPLOY.md`, `DEPLOY-GCP.md`.

For development with live reload:
1. `docker compose up backend`
2. In `frontend/`, run `npm install`, then `npm run dev`, and open http://localhost:5173

---

## Built with

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, MapLibre GL (3D globe), Recharts
- **Backend:** Python, FastAPI, DuckDB, pandas, NumPy, SciPy, scikit-learn, Shapely, ReportLab
- **Hosting:** Docker, Caddy (HTTPS), Google Cloud

DuckDB keeps the deployment to a single container while scanning tens of millions of detections quickly. All database access is in `backend/app/store.py`.

## Limitations

- Satellites see fires only at overpass times and not through thick cloud or smoke.
- Calibration assumes the post-2012 MODIS/VIIRS relationship also held before 2012.
- Ratios are noisy in small areas; shrinkage and uncertainty bands are shown.
- FRP is only approximately comparable between sensors.
- Country boundaries are simplified.

## Credits

Fire data: NASA Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS), https://www.earthdata.nasa.gov/firms.

Basemap: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Country boundaries: Natural Earth (public domain).

Background facts shown while loading are cited in the app: GFED, Copernicus CAMS, WMO, EU JRC/EFFIS, UMD GLAD/WRI Global Forest Watch, Parks Canada.

AI use: developed with AI coding assistance (Anthropic Claude), as disclosed in the Space Apps submission.

License: MIT
