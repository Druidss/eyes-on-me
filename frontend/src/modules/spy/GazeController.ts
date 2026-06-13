import { BACKGROUND_ZONE, GAZE_ZONES } from "./gazeZones.js";
import type { GazeState } from "../gaze/GazeAwarenessMachine.js";
import type {
  ActiveSpyZone,
  RectGazeZone,
  SuspicionState,
  SpyZoneId,
  SpyZoneKind,
} from "./types.js";

//optional settings you can pass when rendering the controller
export interface GazeControllerOptions {
  title?: string;
  backgroundUrl?: string;
  zones?: RectGazeZone[];
  showOverlay?: boolean;
}




// controller
export class GazeController {
  private overlay: HTMLDivElement | null = null;
  private suspicionVignette: HTMLDivElement | null = null;
  private hud: HTMLDivElement | null = null;
  private zoneElements = new Map<SpyZoneId, HTMLDivElement>();
  private zones: RectGazeZone[] = GAZE_ZONES;
  private currentActiveZoneId: SpyZoneId = BACKGROUND_ZONE.id;


  // ConversationStepController calls this to attach the overlay to the existing scene
  attachToScene(scene: HTMLElement, options: GazeControllerOptions = {}): void {
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

    // suspicion vignette
    const suspicionVignette = document.createElement("div");
    suspicionVignette.style.position = "absolute";
    suspicionVignette.style.inset = "0";
    suspicionVignette.style.pointerEvents = "none";
    suspicionVignette.style.opacity = "0";
    suspicionVignette.style.zIndex = "2";
    suspicionVignette.style.transition = "opacity 180ms ease-out, background 220ms ease-out";
    suspicionVignette.style.background = "radial-gradient(circle at center, rgba(0, 0, 0, 0) 42%, rgba(140, 0, 0, 0.18) 68%, rgba(125, 0, 0, 0.48) 84%, rgba(125, 0, 0, 0.82) 100%)";
    scene.appendChild(suspicionVignette);

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
    this.suspicionVignette = suspicionVignette;
    this.hud = hud;

    this.setActiveZone(BACKGROUND_ZONE.id);
    this.setSuspicionVignette({
      intensity: 0,
      color: "rgba(140, 0, 0, 1)",
    });
    this.setHudLines([
      `Zones: ${this.zones.length} evidence`,
      `Active: ${BACKGROUND_ZONE.label}`,
      "Dwell: -",
      "Fixations: -",
      "Per-zone: -",
      "Eye-contact: -",
      "Suspicion: -",
      "Rapport: -",
      "Rapport x Suspicion: -",
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
    eyeContactState?: GazeState | string;
    suspicionValue?: number;
    suspicionState?: string;
    rapportValue?: number;
    rapportBand?: string;
    rapportSuspicionMultiplier?: number;
  }): void {
    const activeZone = snapshot.activeZone;
    if (activeZone) {
      this.setActiveZone(activeZone.id);
    }

    const zoneLabel = activeZone?.label ?? labelForZoneId(this.zones, this.currentActiveZoneId);
    const dwellText = snapshot.dwellMs !== undefined ? `${Math.round(snapshot.dwellMs)} ms` : "-";
    const fixationsText = snapshot.fixationCount !== undefined ? String(snapshot.fixationCount) : "-";
    const perZoneText = formatPerZoneCounts(snapshot.perZoneCounts, this.zones);
    const eyeContactText = snapshot.eyeContactState ?? "-";
    const suspicionText =
      snapshot.suspicionValue !== undefined
        ? `${snapshot.suspicionValue.toFixed(1)}${snapshot.suspicionState ? ` (${snapshot.suspicionState})` : ""}`
        : "-";
    const rapportText =
      snapshot.rapportValue !== undefined
        ? `${snapshot.rapportValue.toFixed(1)}${snapshot.rapportBand ? ` (${snapshot.rapportBand})` : ""}`
        : "-";
    const rapportMultiplierText =
      snapshot.rapportSuspicionMultiplier !== undefined
        ? `${snapshot.rapportSuspicionMultiplier.toFixed(2)}x`
        : "-";

    this.setSuspicionVignette(
      mapSuspicionToVignette(snapshot.suspicionValue, snapshot.suspicionState),
    );

    this.setHudLines([
      `Zones: ${this.zones.length} evidence`,
      `Active: ${zoneLabel}`,
      `Dwell: ${dwellText}`,
      `Fixations: ${fixationsText}`,
      `Per-zone: ${perZoneText}`,
      `Eye-contact: ${eyeContactText}`,
      `Suspicion: ${suspicionText}`,
      `Rapport: ${rapportText}`,
      `Rapport x Suspicion: ${rapportMultiplierText}`,
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
      //zoneEl.style.backdropFilter = "blur(1px)";

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
    this.suspicionVignette?.remove();
    this.hud?.remove();
    this.overlay = null;
    this.suspicionVignette = null;
    this.hud = null;
  }

  private setSuspicionVignette(vignette: SuspicionVignette): void {
    if (!this.suspicionVignette) return;

    const clamped = Math.min(1, Math.max(0, vignette.intensity));
    this.suspicionVignette.style.opacity = clamped.toFixed(3);
    this.suspicionVignette.style.background = [
      "radial-gradient(",
      "circle at center, ",
      "rgba(0, 0, 0, 0) 42%, ",
      `${withAlpha(vignette.color, clamped * 0.18)} 68%, `,
      `${withAlpha(vignette.color, clamped * 0.48)} 84%, `,
      `${withAlpha(vignette.color, clamped * 0.82)} 100%`,
      ")",
    ].join("");
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

interface SuspicionVignette {
  intensity: number;
  color: string;
}

function mapSuspicionToVignette(
  value: number | undefined,
  state: SuspicionState | string | undefined,
): SuspicionVignette {
  if (value === undefined) {
    return {
      intensity: 0,
      color: "rgba(140, 0, 0, 1)",
    };
  }

  switch (state) {
    case "alert":
      return {
        intensity: remapSuspicion(value, 45, 65, 0.45, 0.65),
        color: blendColor(value, 45, 65, [245, 191, 24], [220, 38, 38]),
      };
    case "suspicious":
      return {
        intensity: remapSuspicion(value, 65, 85, 0.72, 0.88),
        color: blendColor(value, 65, 85, [220, 38, 38], [153, 27, 27]),
      };
    case "confrontational":
      return {
        intensity: remapSuspicion(value, 85, 100, 0.92, 1),
        color: blendColor(value, 85, 100, [153, 27, 27], [127, 29, 29]),
      };
    case "relaxed":
    case "neutral":
    default:
      return {
        intensity: 0,
        color: "rgba(140, 0, 0, 1)",
      };
  }
}

function remapSuspicion(
  value: number,
  start: number,
  end: number,
  minIntensity: number,
  maxIntensity: number,
): number {
  if (value <= start) return minIntensity;
  if (value >= end) return maxIntensity;

  const normalized = (value - start) / (end - start);
  return minIntensity + normalized * (maxIntensity - minIntensity);
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/,\s*1\)$/, `, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`);
}

function blendColor(
  value: number,
  start: number,
  end: number,
  from: [number, number, number],
  to: [number, number, number],
): string {
  const t = Math.min(1, Math.max(0, (value - start) / Math.max(1, end - start)));
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgba(${r}, ${g}, ${b}, 1)`;
}
