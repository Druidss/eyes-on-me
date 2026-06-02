import { BACKGROUND_ZONE, GAZE_ZONES } from "./gazeZones.js";
import type {
  ActiveSpyZone,
  RectGazeZone,
  SpyZoneId,
  SpyZoneKind,
} from "./types.js";

//optional settings you can pass when rendering the controller
export interface DemoControllerP1Options {
  title?: string;
  backgroundUrl?: string;
  zones?: RectGazeZone[];
  showOverlay?: boolean;
}




// controller
export class DemoControllerP1 {
  private overlay: HTMLDivElement | null = null;
  private hud: HTMLDivElement | null = null;
  private zoneElements = new Map<SpyZoneId, HTMLDivElement>();
  private zones: RectGazeZone[] = GAZE_ZONES;
  private currentActiveZoneId: SpyZoneId = BACKGROUND_ZONE.id;


  // ConversationStepController calls this to attach the overlay to the existing scene
  attachToScene(scene: HTMLElement, options: DemoControllerP1Options = {}): void {
    this.detachSceneArtifacts();

    this.zones = options.zones ?? this.zones ?? GAZE_ZONES;

    // overlay for zones
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.display = options.showOverlay === false ? "none" : "block";
    overlay.style.zIndex = "2";
    scene.appendChild(overlay);
    this.renderZones(overlay, this.zones);

    // HUD
    const hud = document.createElement("div");
    hud.style.position = "absolute";
    hud.style.left = "12px";
    hud.style.top = "12px";
    hud.style.padding = "10px 12px";
    hud.style.borderRadius = "8px";
    hud.style.background = "rgba(0, 0, 0, 0.62)";
    hud.style.color = "rgba(255, 255, 255, 0.9)";
    hud.style.fontSize = "12px";
    hud.style.lineHeight = "1.45";
    hud.style.fontFamily = "'IBM Plex Sans', system-ui, sans-serif";
    hud.style.minWidth = "220px";
    hud.style.zIndex = "3";
    scene.appendChild(hud);

    this.overlay = overlay;
    this.hud = hud;

    this.setActiveZone(BACKGROUND_ZONE.id);
    this.setHudLines([
      `Zones: ${this.zones.length} evidence`,
      `Active: ${BACKGROUND_ZONE.label}`,
      "Dwell: -",
      "Fixations: -",
      "Per-zone: -",
      "Suspicion: -",
      "Rapport: -",
    ]);
  }

  // remove overlay and HUD from scene and reset state
  destroy(): void {
    this.detachSceneArtifacts();
    this.zoneElements.clear();
    this.currentActiveZoneId = BACKGROUND_ZONE.id;
  }

  // visually highlight active zone
  setActiveZone(zoneId: SpyZoneId): void {
    this.currentActiveZoneId = zoneId;

    for (const [id, element] of this.zoneElements) {
      const active = id === zoneId;
      element.style.borderColor = active ? "#f59e0b" : "rgba(34, 197, 94, 0.9)";
      element.style.background = active ? "rgba(245, 158, 11, 0.16)" : "rgba(34, 197, 94, 0.12)";
      element.style.boxShadow = active ? "0 0 0 2px rgba(245, 158, 11, 0.2)" : "none";
    }
  }

  // update text in HUD
  setHudLines(lines: string[]): void {
    if (!this.hud) return;
    this.hud.innerHTML = lines
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("");
  }


  // update the overlay UI and HUD
  updateDebugSnapshot(snapshot: {
    activeZone?: ActiveSpyZone;
    dwellMs?: number;
    fixationCount?: number;
    perZoneCounts?: Partial<Record<SpyZoneId, number>>;
    suspicionValue?: number;
    suspicionState?: string;
    rapportValue?: number;
    rapportBand?: string;
  }): void {
    const activeZone = snapshot.activeZone;
    if (activeZone) {
      this.setActiveZone(activeZone.id);
    }

    const zoneLabel = activeZone?.label ?? labelForZoneId(this.zones, this.currentActiveZoneId);
    const dwellText = snapshot.dwellMs !== undefined ? `${Math.round(snapshot.dwellMs)} ms` : "-";
    const fixationsText = snapshot.fixationCount !== undefined ? String(snapshot.fixationCount) : "-";
    const perZoneText = formatPerZoneCounts(snapshot.perZoneCounts, this.zones);
    const suspicionText =
      snapshot.suspicionValue !== undefined
        ? `${snapshot.suspicionValue.toFixed(1)}${snapshot.suspicionState ? ` (${snapshot.suspicionState})` : ""}`
        : "-";
    const rapportText =
      snapshot.rapportValue !== undefined
        ? `${snapshot.rapportValue.toFixed(1)}${snapshot.rapportBand ? ` (${snapshot.rapportBand})` : ""}`
        : "-";

    this.setHudLines([
      `Zones: ${this.zones.length} evidence`,
      `Active: ${zoneLabel}`,
      `Dwell: ${dwellText}`,
      `Fixations: ${fixationsText}`,
      `Per-zone: ${perZoneText}`,
      `Suspicion: ${suspicionText}`,
      `Rapport: ${rapportText}`,
    ]);
  }



  // create visible rectangles
  private renderZones(overlay: HTMLDivElement, zones: RectGazeZone[]): void {
    overlay.replaceChildren();
    this.zoneElements.clear();

    for (const zone of zones) {
      if (zone.kind !== "evidence") continue;

      const zoneEl = document.createElement("div");
      zoneEl.style.position = "absolute";
      zoneEl.style.left = `${zone.x * 100}%`;
      zoneEl.style.top = `${zone.y * 100}%`;
      zoneEl.style.width = `${zone.width * 100}%`;
      zoneEl.style.height = `${zone.height * 100}%`;
      zoneEl.style.border = `2px solid ${colorForZoneKind(zone.kind)}`;
      zoneEl.style.background = "rgba(34, 197, 94, 0.12)";
      zoneEl.style.borderRadius = "8px";
      zoneEl.style.backdropFilter = "blur(1px)";

      const label = document.createElement("div");
      label.textContent = zone.label;
      label.style.position = "absolute";
      label.style.left = "6px";
      label.style.top = "6px";
      label.style.padding = "2px 6px";
      label.style.borderRadius = "999px";
      label.style.background = "rgba(0, 0, 0, 0.68)";
      label.style.color = "rgba(255, 255, 255, 0.92)";
      label.style.fontSize = "11px";
      label.style.fontWeight = "600";
      label.style.fontFamily = "'IBM Plex Sans', system-ui, sans-serif";
      zoneEl.appendChild(label);

      overlay.appendChild(zoneEl);
      this.zoneElements.set(zone.id, zoneEl);
    }
  }

  private detachSceneArtifacts(): void {
    this.overlay?.remove();
    this.hud?.remove();
    this.overlay = null;
    this.hud = null;
  }
}

// color of zone kind
function colorForZoneKind(kind: SpyZoneKind): string {
  switch (kind) {
    case "officer_face":
      return "rgba(37, 99, 235, 0.9)";
    case "evidence":
      return "rgba(34, 197, 94, 0.9)";
    case "background":
      return "rgba(156, 163, 175, 0.9)";
  }
}

// convert zone ID into readable label for HUD
function labelForZoneId(zones: RectGazeZone[], zoneId: SpyZoneId): string {
  if (zoneId === BACKGROUND_ZONE.id) return BACKGROUND_ZONE.label;
  return zones.find((zone) => zone.id === zoneId)?.label ?? zoneId;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatPerZoneCounts(
  counts: Partial<Record<SpyZoneId, number>> | undefined,
  zones: RectGazeZone[],
): string {
  if (!counts) return "-";

  const parts = zones
    .map((zone) => {
      const count = counts[zone.id];
      if (!count) return null;
      return `${zone.label} ${count}`;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" | ") : "-";
}
