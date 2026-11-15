import React from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "../components/ui";

const Row = ({ a, b, c }: { a: string; b: string; c: string }) => <tr><td className="font-medium text-slate-200">{a}</td><td>{b}</td><td>{c}</td></tr>;

const SECTIONS = [
  ["why", "Why the sensors differ"],
  ["data", "Data"],
  ["prep", "Preprocessing"],
  ["harm", "Harmonisation"],
  ["calib", "Calibration 2000–2011"],
  ["fai", "Fire Activity Index"],
  ["levels", "Detections vs events"],
  ["calendar", "Calendar colours"],
  ["anom", "Anomalies"],
  ["hist", "Historical analysis"],
  ["valid", "Validation"],
  ["limits", "Limitations"],
  ["refs", "References"],
] as const;

const STEPS = [
  { n: "1", t: "Raw detections", d: "MODIS 1 km and VIIRS 375 m hotspots from NASA FIRMS" },
  { n: "2", t: "Cell-days", d: "Each sensor's detections counted once per 1 km cell per day" },
  { n: "3", t: "Match sensors", d: "Same place (2 km) and day = one observation, never two" },
  { n: "4", t: "Calibrate", d: "2012+ overlap teaches how to scale MODIS-only 2000–2011" },
  { n: "5", t: "Harmonised calendar", d: "One consistent record, 2000 to today" },
];

const H = ({ id, n, children }: { id: string; n: number; children: React.ReactNode }) => <h3 id={id} className="scroll-mt-4">{n}. {children}</h3>;

export default function MethodologyPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Methodology, assumptions & limitations" desc="How FireScope turns two different satellite records into one consistent burning-activity calendar, and where it can be wrong." />

      {/* the method in one picture */}
      <div className="card mb-4 p-5">
        <div className="label mb-3">The method in five steps</div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.n}>
              <div className="flex-1 rounded-lg border border-ink-600 bg-ink-850 p-3">
                <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-harm/20 text-[11px] font-semibold text-orange-300">{s.n}</span><span className="text-[13px] font-semibold text-white">{s.t}</span></div>
                <div className="mt-1.5 text-[12px] leading-snug text-slate-400">{s.d}</div>
              </div>
              {i < STEPS.length - 1 && <ArrowRight size={16} className="hidden shrink-0 self-center text-slate-500 lg:block" />}
            </React.Fragment>
          ))}
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-slate-300">
          <b className="text-white">In short:</b> counting raw hotspots makes fire activity appear to jump in 2012, when the finer VIIRS sensor joined MODIS. FireScope counts burning per place and day instead of per pixel,
          merges what both sensors saw without double counting, and uses the years when both sensors were flying to put the MODIS-only years on the same scale.
          The result is a burning calendar where a change over time reflects fire on the ground, not a change of satellite.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          {SECTIONS.map(([id, label], i) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }} className="text-sky-300 hover:underline">{i + 1}. {label}</a>)}
        </div>
      </div>

      <div className="card prose-sci p-6">
        <H id="why" n={1}>Why MODIS and VIIRS cannot be compared directly</H>
        <table className="data mb-4"><thead><tr><th>Property</th><th>MODIS (Terra / Aqua), C6.1</th><th>VIIRS 375 m (S-NPP / NOAA-20 / NOAA-21)</th></tr></thead><tbody>
          <Row a="Pixel size" b="1 km at nadir, growing to about 2 × 4.8 km at the swath edge" c="375 m at nadir, about 0.8 km at the swath edge" />
          <Row a="Swath" b="About 2330 km, with gaps between orbits near the equator" c="About 3040 km, near-complete daily coverage" />
          <Row a="Local overpass" b="Terra about 10:30 / 22:30; Aqua about 13:30 / 01:30" c="About 13:30 / 01:30 (NOAA-20 and NOAA-21 offset by about half an orbit)" />
          <Row a="Record" b="Nov 2000 (Terra), Jul 2002 (Aqua); both near end of life" c="Jan 2012 (S-NPP), 2018 (NOAA-20), NOAA-21 launched 2022" />
          <Row a="Sensitivity" b="Needs a larger or hotter fire to trigger a detection" c="Detects much smaller and cooler fires; one fire often covers several pixels" />
          <Row a="Confidence" b="Numeric 0–100 %" c="Categories: low / nominal / high" />
          <Row a="FRP" b="Per 1 km pixel" c="Per 375 m pixel; the I4 band saturates (about 367 K), so FRP comes from M13" />
        </tbody></table>
        <p>Three consequences follow. Adding MODIS and VIIRS counts double-counts fires both sensors see. VIIRS produces roughly three times more detections for the same fires. And every new VIIRS satellite adds observation opportunities. A naive hotspot calendar therefore shows artificial jumps in 2012, 2018 and 2023. The Harmonization Lab's transition diagnostic measures this for any area.</p>

        <H id="data" n={2}>Data</H>
        <ul className="list-disc pl-5">
          <li>All fire data are real NASA FIRMS active-fire detections: MODIS Collection 6.1 (MOD14/MYD14) and VIIRS 375 m (VNP14IMG, VJ114IMG, VJ214IMG). No simulated data are used anywhere.</li>
          <li>Standard Processing (SP) archives provide the quality-controlled history; Near Real-Time (NRT) data, available within about 3 hours of an overpass, extend it to today.</li>
          <li>Data enter through FIRMS archive downloads, the FIRMS area API, or uploaded CSV/GeoJSON files. The server also tops up the newest NRT detections from the FIRMS API every 3 hours. Every record keeps its source, product and file name.</li>
          <li>The public deployment holds the full 2000–2026 record for Europe, North America and Argentina, and global coverage for 2026. Analyses of other regions cover only the period loaded, and the app warns when there is too little sensor overlap to calibrate.</li>
        </ul>

        <H id="prep" n={3}>Ingestion & preprocessing</H>
        <ul className="list-disc pl-5">
          <li>Validation: coordinates in range, parsable UTC timestamps (acq_date + acq_time HHMM), recognisable platform. Rejected rows are counted in a validation report.</li>
          <li>Standardisation: UTC timestamps, decimal degrees, FRP in MW, brightness in K, field names unified across products.</li>
          <li>Confidence: MODIS low &lt; 30, nominal 30–79, high ≥ 80 (MODIS C6.1 user guide); VIIRS classes used as given. The same minimum-confidence filter is applied to both sensors, although the classes are not strictly equivalent.</li>
          <li>Duplicates (same platform, position to 1e-4°, time) are removed; standard products replace NRT for the same detection.</li>
          <li>Persistent non-vegetation hotspots: when the FIRMS <code>type</code> field is present, volcanoes, static land sources (such as gas flares) and offshore detections are excluded by default.</li>
        </ul>

        <H id="harm" n={4}>Spatial & temporal harmonisation</H>
        <p><b>The unit of activity: the active-fire cell-day.</b> Each detection is assigned to a regular latitude/longitude grid cell (default 0.01°, about 1.1 km, the MODIS nadir footprint; configurable from 0.005° to 0.25°) and to a UTC or local-solar day. All detections of one sensor in one cell on one day count as a single cell-day. This removes the multi-pixel effect of the 375 m sensor and repeated overpasses (Terra + Aqua, several VIIRS satellites).</p>
        <p><b>Cross-sensor matching.</b> A MODIS cell-day and a VIIRS cell-day within the match radius (default 2 km, to absorb MODIS off-nadir pixel growth and geolocation differences) and the match window (same day by default) are treated as observations of the same burning. The union of cell-days, every VIIRS cell-day plus every MODIS cell-day with no VIIRS match, counts each burning location-day once, however many satellites saw it.</p>
        <p><b>Observation opportunities.</b> In <i>reference</i> mode a single VIIRS platform is used per day (S-NPP, falling back to NOAA-20 then NOAA-21), so new satellites do not inflate activity. Terra-only (2000–2002) versus Terra + Aqua sampling can be controlled with the MODIS platform option.</p>
        <p><b>Temporal aggregation.</b> Daily cell-day tables are summed to weekly (ISO), monthly, seasonal (DJF/MAM/JJA/SON) and annual totals.</p>

        <H id="calib" n={5}>Cross-sensor calibration (continuity from 2000 to today)</H>
        <p>Since 2012 both sensors observe the same fires, so for the selected area FireScope fits how many union cell-days correspond to each MODIS cell-day:</p>
        <ul className="list-disc pl-5">
          <li><b>Seasonal ratio (default):</b> r<sub>m</sub> = (ΣU<sub>m</sub> + κ·r·M̄) / (ΣM<sub>m</sub> + κ·M̄) for each calendar month m. Month-specific ratios are shrunk toward the overall ratio r = ΣU/ΣM with κ pseudo-months. Seasonal ratios capture fire-size regimes: seasons dominated by small fires, which MODIS misses, have higher ratios.</li>
          <li><b>Log-linear:</b> a robust Theil–Sen fit of log(1+U) on log(1+M) for non-proportional relationships.</li>
        </ul>
        <p>Harmonised activity is the observed union where VIIRS is available, and r<sub>m</sub> × MODIS cell-days before 2012. The series can instead be expressed in MODIS-equivalent units, which carries the long MODIS record forward after Terra and Aqua are retired.</p>
        <p><b>Uncertainty.</b> Calibration is cross-validated leave-one-year-out: each overlap year is predicted from MODIS alone, using a model fitted on the other years. The P10–P90 range of observed/predicted ratios sets the uncertainty band of calibrated values; observed values carry a Poisson (±√n) band. If an area has fewer than 12 overlap months or 20 MODIS cell-days, no ratio is applied and the app says so.</p>

        <H id="fai" n={6}>Fire Activity Index (FAI)</H>
        <p>FAI = Σ<sub>cell-days</sub> w<sub>conf</sub> × (1 + β·log<sub>10</sub>(1 + FRP<sub>cd</sub>/10)), where w<sub>conf</sub> is the weight of the highest confidence class in the cell-day and FRP<sub>cd</sub> is its summed FRP. VIIRS FRP is rescaled to MODIS-equivalent with the median MODIS/VIIRS FRP ratio of co-located cell-days. With β = 0 (default) FAI is a confidence-weighted harmonised count. Calibrated periods are scaled with the same r<sub>m</sub>.</p>

        <H id="levels" n={7}>Raw detections, matched observations and events</H>
        <p>FireScope keeps every level separate: <b>raw detections</b> (pixels), <b>sensor cell-days</b>, <b>matched observations</b> (co-detections), <b>union cell-days</b> and <b>harmonised activity</b>. <b>Estimated fire events</b> are clusters of union cell-days that touch in space (8-neighbourhood) and time (gap of 1 day at most). They are statistical clusters: one large fire can split into several, and nearby fires can merge. They are never presented as confirmed individual fires.</p>

        <H id="calendar" n={8}>Burning calendar colours</H>
        <p>Colour classes are relative to the selected area's own record: no activity, then very low / low / moderate / high / extremely high, split at the P25, P50, P75 and P90 of its non-zero values at the same aggregation level. This keeps small and large areas equally readable. The inferno colour scale is perceptually uniform and readable with colour-vision deficiencies, and exact numbers are always available on hover and in exports.</p>

        <H id="anom" n={9}>Anomaly detection</H>
        <p>For every month, the baseline is the same calendar month in other years (or the previous 5 or 10 years). Scores: z-score (mean/σ), robust z (median/MAD, the default, which is not distorted by past extreme years) or IQR distance above Q3. Severity: moderate ≥ 2, high ≥ 3, extreme ≥ 4. Out-of-season burning is flagged where the baseline median is near zero. Daily indicators compare rolling 7-day activity with the same window in other years. Change points (binary segmentation on annual log totals) and an Isolation Forest on activity, intensity and season complement these. <b>Anomalies are departures from history, not forecasts:</b> hotspot history alone cannot predict where the next fire will start.</p>

        <H id="hist" n={10}>Historical analysis</H>
        <p>Trends use the Mann–Kendall test with Sen's slope on complete years, also run on the MODIS-only series as a single-sensor check. Decomposition is additive on log(1 + monthly activity) with a centred 12-month moving average. Fire-season timing uses the months containing the 10th and 90th percentiles of cumulative annual activity. The burn-event structure (small and short vs large and persistent clusters) is a heuristic indicator of agricultural vs wildfire activity, not a land-cover attribution.</p>

        <H id="valid" n={11}>Validation, and what has not been validated</H>
        <p>The Harmonization Lab reports cross-sensor detection consistency (P(VIIRS|MODIS), P(MODIS|VIIRS)), correlations in the overlap years, leave-one-year-out errors, a step test at the sensor transition and a 15-configuration sensitivity analysis. A unit test checks that a known 3× sensor ratio is recovered with no step at the transition. These are <b>internal consistency checks</b> on the same satellite data. The method has <b>not</b> yet been validated against independent burned-area products or national fire records (for example MODIS MCD64A1 burned area or EFFIS); that is the next step.</p>

        <H id="limits" n={12}>Known limitations</H>
        <ul className="list-disc pl-5">
          <li>Hotspots record fires burning at overpass time under clear-enough skies. Cloud, smoke, short-lived burns and fires between overpasses are missed.</li>
          <li>Calibration assumes the MODIS/VIIRS relationship seen after 2012 also held before 2012 in the same area. A change in fire regime (for example from large to small fires) breaks this assumption.</li>
          <li>Small areas with few fires give noisy ratios. Shrinkage helps, uncertainty bands widen, and a note is shown when overlap is insufficient.</li>
          <li>MODIS orbital drift in its final years changes overpass times and can bias detections.</li>
          <li>FRP is only approximately comparable between sensors; FRP-weighted indices should be read with care.</li>
          <li>Country boundaries are simplified Natural Earth 1:50m polygons; coastal detections are assigned to the nearest country within about 10 km.</li>
        </ul>

        <H id="refs" n={13}>References</H>
        <ul className="list-disc pl-5">
          <li>Giglio, L., Schroeder, W. & Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. <i>Remote Sensing of Environment</i>, 178, 31–41.</li>
          <li>Schroeder, W., Oliva, P., Giglio, L. & Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product: Algorithm description and initial assessment. <i>Remote Sensing of Environment</i>, 143, 85–96.</li>
          <li>NASA FIRMS, Fire Information for Resource Management System: <a className="text-sky-300 hover:underline" href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">firms.modaps.eosdis.nasa.gov</a>. Data acknowledgement: NASA's Earth Science Data and Information System (ESDIS).</li>
          <li>Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. <i>Journal of the American Statistical Association</i>, 63, 1379–1389.</li>
        </ul>
      </div>
    </div>
  );
}
