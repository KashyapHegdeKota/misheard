import { Reveal } from "./Motion";
import { MapExplorer } from "./MapExplorer";

/** Section 4: the map. Header is static; the explorer is the interactive part. */
export function MapSection() {
  return (
    <section id="map" className="section" aria-labelledby="map-title" style={{ paddingBottom: "clamp(56px, 8vw, 104px)" }}>
      <div className="container">
        <Reveal>
          <p className="eyebrow">03 — The map</p>
          <h2 id="map-title" className="h2">
            Every clip, on one map
          </h2>
          <p className="lead">
            Each dot is one clip, laid out with UMAP so similar clips sit close together and colored by how badly the model misheard it. Filter by condition, switch models, and click a dot to hear it.
          </p>
        </Reveal>
      </div>
      <MapExplorer />
    </section>
  );
}
