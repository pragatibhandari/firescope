# FireScope — Global Burning Activity Intelligence & MODIS–VIIRS Harmonization

FireScope turns NASA FIRMS active-fire hotspots from **MODIS (Terra/Aqua, 2000→)** and **VIIRS 375 m (S-NPP 2012→, NOAA-20, NOAA-21)** into **one consistent, harmonised burning-activity calendar** from the early 2000s to the present. Users pick any area and period, then explore, compare and download the area's fire history.

*NASA Space Apps Challenge — "Harmonization of MODIS and VIIRS Hot Spots".*

---

## Quick start

### Option A — Docker (recommended)
```bash
cp backend/.env.example backend/.env      # add your FIRMS_MAP_KEY (optional)
docker compose up --build
# open http://localhost:8080
```

### Option B — local development
```bash
# backend (Python 3.11+)
cd backend
pip install -r requirements.txt
cp .env.example .env                      # add FIRMS_MAP_KEY (optional)
uvicorn app.main:app --reload --port 8000

# frontend (Node 18+), in a second terminal
cd frontend
npm install
npm run dev                               # http://localhost:5173 (proxies /api -> :8000)
```

On first start the backend builds the **clearly labelled synthetic demo dataset** (~1 M simulated detections, ~45 s) so the platform is explorable with no key. Every demo screen shows a **DEMO MODE** banner, and every demo export is labelled synthetic.

### Getting real data
1. Get a free MAP_KEY at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> and put it in `backend/.env`.
2. In **Data Sources**, choose an AOI and press **Start area sync**. This uses the FIRMS area API: standard (SP) archives where available and NRT afterwards, in 5-day chunks, with retries and rate limiting. Or press **Fetch yearly country CSVs** to get long histories quickly.
3. You can also **upload** FIRMS archive downloads (`fire_archive_*.csv`, `fire_nrt_*.csv`, from <https://firms.modaps.eosdis.nasa.gov/download/>) or point GeoJSON.
4. Switch the dataset toggle to **Live FIRMS**.

> To show the MODIS→VIIRS harmonisation on real data, an area needs MODIS **and** VIIRS records covering several years after 2012 (overlap) plus the pre-2012 MODIS years you want back-cast. The country CSV fetch is the fastest way to get this.

---

## What's inside

| Module | Highlights |
|---|---|
| **Overview** | 10 KPIs (raw vs harmonised, estimated events, FAI, FRP, high-confidence, Δ vs previous period); daily/weekly, monthly, annual and seasonal charts; MODIS vs VIIRS; FRP histogram; by country; confidence by sensor |
| **Global Fire Map** (MapLibre) | 6 views: raw MODIS, raw VIIRS, combined, harmonised grid, FRP intensity, historical recurrence. MODIS and VIIRS use different shapes and colours. Heatmap, clustering, boundaries, box/polygon AOI drawing, Shift-click country selection, playback by day/week/month/year, full popups (incl. harmonisation status) |
| **Burning Calendar** | Year×month multi-year calendar (the core deliverable); daily, weekly, yearly, seasonal views; year vs historical median/IQR. Click a month to focus the whole platform on it. Click a day for a detail panel: sensors, FRP, DoD/WoW/MoM/YoY, ±7-day historical baseline and a mini-map |
| **Harmonization Lab** | Every parameter exposed. Sensor-transition diagnostic (raw vs stitched vs harmonised vs MODIS-only), pipeline funnel, calibration fit, monthly ratios, leave-one-year-out validation, raw/normalised/harmonised comparison, 15-run sensitivity analysis |
| **Historical Analysis** | Mann-Kendall trend test with Sen's slope, monthly box plots, STL-style decomposition, fire-season timing, burn-event structure (agricultural vs wildfire heuristic), recurrence map, country ranking, multi-period comparison |
| **Anomaly Detection** | Robust-z / z-score / IQR against same-month baselines; out-of-season burning; FRP intensity flag; daily 7-day early-warning indicator; change points; Isolation Forest. Each alert has a plain-language message, a supporting chart and a supporting map. Explicitly **not a forecast** |
| **AOI Explorer** | Country, administrative region / place search (OSM Nominatim boundaries), lat/lon ± radius, bounding box, drawing, GeoJSON upload, then an auto-generated report |
| **Reports & Export** | PDF report, CSV (hotspots with harmonisation status, daily/monthly harmonised series), GeoJSON, PNG + CSV on every chart, shareable state link |
| **Data Sources** | API/key status, freshness, sync jobs with progress, upload validation report, coverage table, product reference, attribution |
| **Methodology** | Full description of assumptions, uncertainty and limitations |

---

## The harmonisation method (short version)

1. **Platform selection.** In *reference* mode one VIIRS satellite is used per day (S-NPP, else NOAA-20, else NOAA-21), so new satellites don't inflate activity.
2. **Common grid + day.** Detections are assigned to a 0.01° grid (≈ the MODIS nadir pixel; configurable) and to a UTC or local-solar day.
3. **Within-sensor de-duplication.** All of one sensor's detections in a cell-day count as **one active-fire cell-day**. This removes the 375 m multi-pixel effect and repeat overpasses.
4. **Cross-sensor matching.** MODIS and VIIRS cell-days within 2 km on the same day count as the same activity. **Union cell-days** = VIIRS cell-days + unmatched MODIS cell-days, so nothing is counted twice.
5. **Calibration for continuity.** Using the AOI's own 2012+ overlap, a seasonal ratio (with shrinkage) or a Theil–Sen log-linear model maps MODIS cell-days to union cell-days. This back-casts 2000–2011 into the same units. Uncertainty comes from leave-one-year-out cross-validation. A *MODIS-equivalent* output mode instead extends MODIS units forward, for after Terra/Aqua end.
6. **Fire Activity Index.** Confidence-weighted (optionally FRP-weighted) harmonised cell-days. VIIRS FRP is rescaled to MODIS-equivalent using co-located cell-days.
7. **Estimated events.** Space-time connected components of union cell-days. These are labelled everywhere as estimates, never as confirmed fires.

On the demo data, the raw detection count jumps **×4.6** when VIIRS starts in 2012. The harmonised series steps **×1.23**, the same as MODIS's own continuous record (×1.23). The leave-one-year-out annual error is about 2%. The unit test `test_matching_avoids_double_counting_and_calibration_recovers_ratio` checks that a known 3× ratio is recovered with no step.

**Validation status:** the statistics shown are internal consistency checks on satellite data. The method has **not** been validated against independent fire inventories or burned-area products. That is the recommended next step.

---

## Architecture

```
frontend/  React 18 + TypeScript + Vite + Tailwind + Recharts + MapLibre GL
backend/   FastAPI + pandas/NumPy + DuckDB + Shapely + SciPy + scikit-learn + ReportLab
  app/schema.py      ingestion, validation, canonical schema
  app/firms.py       NASA FIRMS client (area API, availability, key status, country CSVs), background jobs
  app/store.py       DuckDB store, server-side filtering, provenance, sync log
  app/geo.py         countries, AOI parsing, point-in-polygon
  app/harmonize.py   harmonisation engine, validation, sensitivity analysis
  app/analytics.py   dashboard, calendar, history, anomalies
  app/reports.py     PDF report
  app/demo.py        synthetic demo generator (labelled)
  tests/             pytest (normalisation, harmonisation, API smoke)
```

* **Performance:** filtering, aggregation and harmonisation run server-side. The map receives at most 25k points: a random sample, with the true count shown. Gridded density and recurrence layers are aggregated on the server. Results are cached per AOI and parameter set, responses are gzipped, and syncs run as background jobs.
* **Security:** the FIRMS MAP_KEY is read only from backend environment variables. The browser never sees it.
* **Deviations from the suggested stack:** **DuckDB** instead of PostgreSQL/PostGIS gives zero-dependency deployment and fast columnar scans over millions of rows; all database access sits in `store.py`, so moving to PostGIS later is contained. UI components are hand-built with Tailwind rather than shadcn/ui.

### Main API endpoints
`GET /api/status` · `POST /api/summary` · `/api/harmonization` · `/api/harmonization/sensitivity` · `/api/calendar` · `/api/calendar/day` · `/api/history` · `/api/recurrence` · `/api/anomalies` · `/api/points` · `/api/density` · `/api/export/csv` · `/api/export/geojson` · `/api/report/pdf` · `/api/ingest/upload` · `/api/upload/aoi` · `/api/sync/firms` · `/api/jobs/{id}` · `GET /api/geocode`. Interactive docs: `http://localhost:8000/docs`.

All POST endpoints take `{"filters": {...}, "params": {...}}`, with `filters` = dataset, start, end, sensors, product, min_conf, aoi, exclude_static and `params` = the harmonisation parameters.

---

## Acceptance criteria → where to see them

| # | Criterion | Where |
|---|---|---|
| 1 | Any area & historical period | Filter bar, AOI Explorer, map drawing |
| 2 | Retrieve / import MODIS & VIIRS | Data Sources (FIRMS API, country CSVs, upload) |
| 3 | Raw vs harmonised distinguished | KPIs, Lab "raw / normalised / harmonised", map views, per-detection status |
| 4 | Spatial & temporal sensor differences processed | Lab parameters and pipeline funnel |
| 5 | Meaningful burning calendar | Burning Calendar (multi-year, daily … seasonal) |
| 6 | Calendar date updates map & charts | Click a month (focuses the platform) or a day (detail panel, mini-map, map page, chart marker) |
| 7 | Compare years | Calendar multi-year comparison, History period comparison |
| 8 | Unusual activity vs baseline | Anomaly Detection |
| 9 | Every metric defined & traceable | ⓘ tooltips, Methodology, source/product on every record, exports embed parameters |
| 10 | No fabricated data or forecasts | Demo is labelled synthetic everywhere; anomalies say "not a forecast"; events say "estimated" |

## Known limitations
See the in-app **Methodology** page. In brief: overpass sampling, cloud and smoke; the assumption that the post-2012 MODIS/VIIRS relationship also held before 2012; noisy ratios in small AOIs (shrinkage helps and uncertainty is shown); approximate FRP comparability; simplified boundaries. The yearly country-CSV URL pattern is FIRMS' public archive path and may change; if it fails, download the files manually and upload them.

## Attribution
We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS). Basemap © OpenStreetMap contributors © CARTO. Boundaries: Natural Earth (public domain) via world-atlas. Geocoding: OpenStreetMap Nominatim.
