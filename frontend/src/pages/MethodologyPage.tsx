import React from "react";
import { PageHeader } from "../components/ui";

const Row = ({ a, b, c }: { a: string; b: string; c: string }) => <tr><td className="font-medium text-slate-200">{a}</td><td>{b}</td><td>{c}</td></tr>;

export default function MethodologyPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Methodology, assumptions & limitations" desc="How FireScope turns two heterogeneous satellite records into one consistent burning-activity calendar — and where it can be wrong." />
      <div className="card prose-sci p-6">
        <h3>1. Why MODIS and VIIRS cannot be compared directly</h3>
        <table className="data mb-4"><thead><tr><th>Property</th><th>MODIS (Terra / Aqua), C6.1</th><th>VIIRS 375 m (S-NPP / NOAA-20 / NOAA-21)</th></tr></thead><tbody>
          <Row a="Pixel size" b="1 km at nadir, growing to ~2 × 4.8 km at swath edge" c="375 m at nadir, ~0.8 km at swath edge" />
          <Row a="Swath" b="~2330 km — gaps between orbits near the equator" c="~3040 km — near-complete daily coverage" />
          <Row a="Local overpass" b="Terra ~10:30 / 22:30; Aqua ~13:30 / 01:30" c="~13:30 / 01:30 (NOAA-20 and NOAA-21 offset by ~½ orbit)" />
          <Row a="Record" b="Nov 2000 (Terra), Jul 2002 (Aqua) — both near end of life" c="Jan 2012 (S-NPP), 2018 (NOAA-20), 2023 (NOAA-21)" />
          <Row a="Sensitivity" b="Needs a larger/hotter fire to trigger detection" c="Detects much smaller and cooler fires; several pixels per fire" />
          <Row a="Confidence" b="Numeric 0–100 %" c="Categorical low / nominal / high" />
          <Row a="FRP" b="Per 1 km pixel" c="Per 375 m pixel; I4 saturates (~367 K), FRP from M13" />
        </tbody></table>
        <p>Consequences: adding MODIS and VIIRS counts double-counts fires both sensors see; VIIRS produces roughly three times more detections for the same fires; and every new VIIRS satellite adds observation opportunities. A naive hotspot calendar therefore shows artificial jumps in 2012, 2018 and 2023. The Harmonization Lab's transition diagnostic quantifies this for any area.</p>

        <h3>2. Ingestion & preprocessing</h3>
        <ul className="list-disc pl-5">
          <li>Sources: NASA FIRMS area API (standard SP products where available, NRT afterwards), FIRMS yearly country archives, and user uploads (CSV / GeoJSON). Original source, product and file name are kept on every record.</li>
          <li>Validation: coordinates in range, parsable UTC timestamps (acq_date + acq_time HHMM), recognisable platform. Rejected rows are counted in a validation report.</li>
          <li>Standardisation: UTC timestamps, decimal degrees, FRP in MW, brightness in K, field names unified across products.</li>
          <li>Confidence: MODIS low &lt; 30, nominal 30–79, high ≥ 80 (MODIS C6.1 user guide); VIIRS classes used as given. A minimum-confidence filter is applied identically to both sensors. The classes are not strictly equivalent between sensors.</li>
          <li>Duplicates (same platform, position to 1e-4°, time) are removed; standard products supersede NRT for the same detection.</li>
          <li>Persistent non-vegetation hotspots: when the MODIS/VIIRS <code>type</code> field is present, volcanoes, static land sources (e.g. gas flares) and offshore detections are excluded by default.</li>
        </ul>

        <h3>3. Spatial & temporal harmonisation</h3>
        <p><b>Activity unit — the active-fire cell-day.</b> Each detection is assigned to a regular latitude/longitude grid cell (default 0.01° ≈ 1.1 km, the MODIS nadir footprint; configurable from 0.005° to 0.25°) and to a UTC or local-solar day. All detections of one sensor in one cell on one day collapse to a single cell-day. This removes the multi-pixel effect of the 375 m sensor and repeated overpasses (Terra+Aqua, several VIIRS satellites) from the unit of activity.</p>
        <p><b>Cross-sensor matching.</b> A MODIS cell-day and a VIIRS cell-day within the match radius (default 2 km, to absorb MODIS off-nadir pixel growth and geolocation differences) and the match window (same day by default) are treated as observations of the same burning. The union of cell-days — every VIIRS cell-day plus every MODIS cell-day with no VIIRS match — counts each burning location-day once, no matter how many satellites saw it.</p>
        <p><b>Observation opportunities.</b> In <i>reference</i> mode a single VIIRS platform is used per day (S-NPP, falling back to NOAA-20 then NOAA-21), so the launch of additional satellites does not inflate activity. Terra-only (2000–2002) versus Terra+Aqua sampling can be controlled with the MODIS platform option.</p>
        <p><b>Temporal aggregation.</b> Daily cell-day tables are aggregated to weekly (ISO), monthly, seasonal (DJF/MAM/JJA/SON) and annual sums.</p>

        <h3>4. Cross-sensor calibration (continuity 2000 → present)</h3>
        <p>In the overlap era (2012 onward) both sensors observe the same fires, so for the selected area we fit how many union cell-days correspond to each MODIS cell-day:</p>
        <ul className="list-disc pl-5">
          <li><b>Seasonal ratio (default):</b> r<sub>m</sub> = (ΣU<sub>m</sub> + κ·r·M̄) / (ΣM<sub>m</sub> + κ·M̄) for each calendar month m, shrinking month-specific ratios toward the global ratio r = ΣU/ΣM with κ pseudo-months. Seasonality in the ratio captures fire-size regimes (seasons dominated by small fires that MODIS misses have higher ratios).</li>
          <li><b>Log-linear:</b> robust Theil–Sen fit of log(1+U) on log(1+M) for non-proportional relationships.</li>
        </ul>
        <p>Harmonised activity H is the observed union where VIIRS is available and r<sub>m</sub> × MODIS cell-days before. Alternatively the series can be expressed in MODIS-equivalent units, which converts post-MODIS periods from VIIRS — relevant as Terra and Aqua are decommissioned.</p>
        <p><b>Uncertainty.</b> Calibration is cross-validated leave-one-year-out across overlap years: each year is predicted from MODIS alone using a model fitted on the others. The P10–P90 range of the hold-out ratio observed/predicted defines the uncertainty band of calibrated values; observed values carry a Poisson (±√n) band.</p>

        <h3>5. Fire Activity Index (FAI)</h3>
        <p>FAI = Σ<sub>cell-days</sub> w<sub>conf</sub> × (1 + β·log<sub>10</sub>(1 + FRP<sub>cd</sub>/10)), where w<sub>conf</sub> is the weight of the highest confidence class in the cell-day and FRP<sub>cd</sub> is the summed FRP of the cell-day. VIIRS FRP is rescaled to MODIS-equivalent with the median MODIS/VIIRS FRP ratio of exactly co-located cell-days. With β = 0 (default) FAI is a confidence-weighted harmonised count. Calibrated periods are scaled with the same r<sub>m</sub>.</p>

        <h3>6. Raw detections, matched observations, events</h3>
        <p>The platform keeps every level separate: <b>raw detections</b> (pixels), <b>sensor cell-days</b> (normalised), <b>matched observations</b> (co-detections), <b>union cell-days</b> and <b>harmonised activity</b>. <b>Estimated fire events</b> are connected components of union cell-days that touch in space (8-neighbourhood) and time (≤ 1 day gap). They are statistical clusters: one large fire can split into several clusters and several nearby fires can merge. They are never presented as confirmed individual fires.</p>

        <h3>7. Burning calendar classes</h3>
        <p>Colour classes are relative to the selected area's own record: no activity (0), then very low / low / moderate / high / extremely high at the P25, P50, P75 and P90 of non-zero values at the same aggregation level. This makes small and large areas equally readable. The ramp (inferno) is perceptually uniform and colour-vision-deficiency friendly; numbers are always available on hover or in exports.</p>

        <h3>8. Anomaly detection</h3>
        <p>For every month, the baseline is the same calendar month in other years (or the previous 5/10 years). Scores: z-score (mean/σ), robust z (median/MAD, default — insensitive to past extreme years) or IQR distance above Q3. Severity: moderate ≥ 2, high ≥ 3, extreme ≥ 4. Out-of-season burning is flagged where the baseline median is near zero. Daily indicators compare rolling 7-day activity with the same window in other years. Change points (binary segmentation on annual log totals) and an Isolation Forest on activity, intensity and season complement these. <b>All anomalies are retrospective departures from history, not forecasts.</b> Hotspot history alone cannot predict wildfire occurrence.</p>

        <h3>9. Historical analysis</h3>
        <p>Trend significance uses the Mann–Kendall test with Sen's slope on complete years (also run on the MODIS-only series as a single-sensor check). Decomposition is additive on log(1+monthly activity) with a centred 12-month moving average. Fire-season timing uses the months containing the 10th and 90th percentiles of cumulative annual activity. The burn-event structure (small/short vs large/persistent clusters) is a heuristic indicator of agricultural vs wildfire activity, not a land-cover attribution.</p>

        <h3>10. Validation & what has not been validated</h3>
        <p>The validation module reports cross-sensor detection consistency (P(VIIRS|MODIS), P(MODIS|VIIRS)), correlations in the overlap era, leave-one-year-out errors, a sensor-transition step test and a 15-configuration sensitivity analysis. These are <b>internal consistency checks</b> on the same satellite data. The method has <b>not</b> been validated against independent fire inventories or burned-area products; this is the natural next step (e.g. MCD64A1 burned area or national fire records).</p>

        <h3>11. Known limitations</h3>
        <ul className="list-disc pl-5">
          <li>Hotspots record fires burning at overpass time under clear-enough skies; cloud, smoke, short-lived burns and fires between overpasses are missed.</li>
          <li>The calibration assumes the MODIS–VIIRS relationship observed after 2012 also held before 2012 in the same area. Changes in fire regime (e.g. a shift from large to small fires) violate this.</li>
          <li>Small areas with few fires produce noisy ratios; shrinkage helps, uncertainty bands widen, and a note is shown when overlap is insufficient.</li>
          <li>MODIS orbital drift in its final years changes overpass times and can bias detections.</li>
          <li>FRP comparability across sensors is approximate; FRP-weighted indices should be interpreted with care.</li>
          <li>Country boundaries are simplified Natural Earth 1:50m polygons; coastal detections are assigned to the nearest country within ~10 km.</li>
          <li>The demo dataset is synthetic and exists only to demonstrate the method when FIRMS access is unavailable.</li>
        </ul>
      </div>
    </div>
  );
}
