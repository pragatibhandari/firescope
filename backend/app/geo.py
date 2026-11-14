"""Geographic helpers: country boundaries, area-of-interest (AOI) parsing and point-in-polygon masks."""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import box, shape, mapping

from .config import COUNTRIES_PATH


@lru_cache(maxsize=1)
def countries():
    with open(COUNTRIES_PATH) as f:
        fc = json.load(f)
    names, geoms = [], []
    for feat in fc["features"]:
        g = shape(feat["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        names.append(feat["properties"]["name"])
        geoms.append(g)
    return names, geoms, shapely.STRtree(geoms)


@lru_cache(maxsize=1)
def country_index():
    names, geoms, _ = countries()
    out = []
    for n, g in zip(names, geoms):
        minx, miny, maxx, maxy = g.bounds
        out.append({"name": n, "bbox": [round(minx, 3), round(miny, 3), round(maxx, 3), round(maxy, 3)]})
    return sorted(out, key=lambda d: d["name"])


@lru_cache(maxsize=1)
def countries_geojson_simplified() -> dict:
    names, geoms, _ = countries()
    feats = []
    for n, g in zip(names, geoms):
        feats.append({"type": "Feature", "properties": {"name": n},
                      "geometry": mapping(shapely.simplify(g, 0.05, preserve_topology=True))})
    return {"type": "FeatureCollection", "features": feats}


def assign_country(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    names, geoms, tree = countries()
    lat = pd.to_numeric(pd.Series(np.asarray(lat, dtype=object)), errors="coerce").to_numpy(dtype="float64", na_value=np.nan)
    lon = pd.to_numeric(pd.Series(np.asarray(lon, dtype=object)), errors="coerce").to_numpy(dtype="float64", na_value=np.nan)
    pts = shapely.points(lon, lat)
    out = np.full(len(pts), "Ocean / unassigned", dtype=object)
    if len(pts) == 0:
        return out
    idx_pt, idx_geom = tree.query(pts, predicate="within")
    out[idx_pt] = np.asarray(names, dtype=object)[idx_geom]
    # coastal points just outside a coarse boundary: nearest country within ~0.1 deg
    miss = np.where((out == "Ocean / unassigned") & np.isfinite(lat) & np.isfinite(lon))[0]
    if len(miss):
        ip, ig = tree.query_nearest(pts[miss], max_distance=0.1, all_matches=False)
        out[miss[ip]] = np.asarray(names, dtype=object)[ig]
    return out


class AOI:
    """Area of interest. kind: world | bbox | polygon | country | geojson."""

    def __init__(self, spec: dict | None):
        spec = spec or {"kind": "world"}
        self.spec = spec
        self.kind = spec.get("kind", "world")
        self.name = spec.get("name") or self.kind
        self.geom = None
        if self.kind == "world":
            self.bbox = (-180.0, -90.0, 180.0, 90.0)
            self.name = spec.get("name") or "Global"
        elif self.kind == "bbox":
            w, s, e, n = [float(v) for v in spec["bbox"]]
            self.bbox = (w, s, e, n)
            self.geom = box(w, s, e, n)
            self.name = spec.get("name") or f"BBox [{w:.2f}, {s:.2f}, {e:.2f}, {n:.2f}]"
        elif self.kind == "country":
            names, geoms, _ = countries()
            nm = spec["country"]
            if nm not in names:
                raise ValueError(f"Unknown country: {nm}")
            self.geom = geoms[names.index(nm)]
            self.bbox = self.geom.bounds
            self.name = nm
        elif self.kind in ("polygon", "geojson"):
            g = spec.get("geometry")
            if g and g.get("type") == "FeatureCollection":
                g = shapely.union_all([shape(f["geometry"]) for f in g["features"]])
            elif g and g.get("type") == "Feature":
                g = shape(g["geometry"])
            else:
                g = shape(g)
            if not g.is_valid:
                g = g.buffer(0)
            self.geom = g
            self.bbox = g.bounds
            self.name = spec.get("name") or ("Custom polygon" if self.kind == "polygon" else "Uploaded boundary")
        else:
            raise ValueError(f"Unknown AOI kind {self.kind}")

    @property
    def area_km2(self) -> float:
        if self.geom is None:
            return 510_072_000.0
        # equal-area approx: scale by cos(lat) at centroid
        c = self.geom.centroid
        return float(self.geom.area * (111.32 ** 2) * np.cos(np.radians(c.y)))

    def key(self) -> str:
        return json.dumps(self.spec, sort_keys=True, default=str)

    def mask(self, df: pd.DataFrame) -> np.ndarray:
        if self.geom is None or self.kind == "bbox" or df.empty:
            return np.ones(len(df), dtype=bool)
        shapely.prepare(self.geom)
        return shapely.contains_xy(self.geom, df["lon"].to_numpy(dtype="float64", na_value=np.nan),
                                   df["lat"].to_numpy(dtype="float64", na_value=np.nan))

    def geojson(self):
        if self.geom is None:
            return None
        return mapping(self.geom)
