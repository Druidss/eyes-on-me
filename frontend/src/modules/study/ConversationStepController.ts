import type {
  StudyConfig,
  FlowStep,
  Avatar,
  RuntimeInfo,
} from "../../shared/types.js";
import { ViewerCore } from "../viewer/ViewerCore.js";
import { VRMLookAtSmoother, SACCADE_PROFILES } from "../viewer/chatvrm/VRMLookAtSmoother.js";
import type { GazeProvider } from "../gaze/GazeProvider.js";
import { MouseProvider } from "../gaze/MouseProvider.js";
import { BackendGazeProvider } from "../gaze/BackendGazeProvider.js";
import { apiBase } from "../../shared/apiBase.js";
import { IntersectionEngine } from "../gaze/IntersectionEngine.js";
import { GazeAwarenessMachine } from "../gaze/GazeAwarenessMachine.js";
import { MutualGazeTracker } from "../gaze/MutualGazeTracker.js";
import type { BackendReporter } from "../telemetry/BackendReporter.js";
import type { RealtimeClient } from "../realtime/RealtimeClient.js";
import { renderVoiceBar } from "./renderVoiceBar.js";
// P1 overlay controller for zone visualization during development.
import { DemoControllerP1 } from "../spy/DemoControllerP1.js";
// P1 zone-tracking logic, driven by the original gaze provider pipeline.
import { GazeZoneTracker } from "../spy/GazeZoneTracker.js";

/**
 * Manages the conversation step lifecycle: 3D viewer, gaze tracking,
 * voice bar, and cleanup. Extracted from StudyFlow to keep the
 * orchestrator small.
 */
export class ConversationStepController {
  private viewer: ViewerCore | null = null;
  private gazeProvider: GazeProvider | null = null;
  private gazeProviderType: "mouse" | "backend" = "mouse";
  private intersectionEngine: IntersectionEngine | null = null;
  private gazeFSM: GazeAwarenessMachine | null = null;
  private lookAtSmoother: VRMLookAtSmoother | null = null;
  private gazeLoopId: number | null = null;
  private realtimeClient: RealtimeClient | null = null;
  private remoteStream: MediaStream | null = null;
  private lipSyncAttached = false;
  // P1 demo overlay instance
  private p1DemoController: DemoControllerP1 | null = null;
  // P1 zone-tracking logic instance for zone, dwell, and fixation state.
  private p1ZoneTracker: GazeZoneTracker | null = null;

  private stepId: string | undefined;
  private condition: string | undefined;

  private readonly config: StudyConfig;
  private readonly runtime: RuntimeInfo;
  private readonly sessionId: string;
  private readonly reporter: BackendReporter;

  constructor(deps: {
    config: StudyConfig;
    runtime: RuntimeInfo;
    sessionId: string;
    reporter: BackendReporter;
  }) {
    this.config = deps.config;
    this.runtime = deps.runtime;
    this.sessionId = deps.sessionId;
    this.reporter = deps.reporter;
  }

  /** Render the conversation step into the wrapper. */
  render(
    wrapper: HTMLElement,
    step: FlowStep,
    selectedAvatar: Avatar | null,
    resolvedCondition?: string,
  ): void {
    this.stepId = step.id;
    this.condition = resolvedCondition ?? step.condition;

    // Debug overlays are visible in demo mode or with ?debug, hidden for real participants
    const showDebug = new URLSearchParams(window.location.search).has("demo")
      || new URLSearchParams(window.location.search).has("debug");

    const h = document.createElement("h2");
    h.textContent = step.title ?? (showDebug ? `Conversation (${this.condition ?? ""})` : "Conversation");
    wrapper.appendChild(h);

    // Canvas container for the 3D viewer
    const viewerContainer = document.createElement("div");
    viewerContainer.className = "viewer-container";

    const canvas = document.createElement("canvas");
    canvas.className = "viewer-canvas";
    viewerContainer.appendChild(canvas);

    // Gaze debug indicator (overlaid on viewer, bottom-left)
    const gazeDebug = document.createElement("div");
    gazeDebug.className = "gaze-debug";
    const dot = document.createElement("span");
    dot.className = "gaze-debug-dot";
    gazeDebug.appendChild(dot);
    const debugLabel = document.createElement("span");
    debugLabel.className = "gaze-debug-label";
    debugLabel.textContent = "User Gaze: waiting";
    gazeDebug.appendChild(debugLabel);
    if (!showDebug) gazeDebug.style.display = "none";
    viewerContainer.appendChild(gazeDebug);

    // FSM state indicator (top-right, only for gazeaware conditions)
    const fsmLabel = document.createElement("div");
    fsmLabel.className = "fsm-debug";
    fsmLabel.textContent = this.condition === "gazeaware" ? "FSM: –" : "FSM: off";
    if (!showDebug) fsmLabel.style.display = "none";
    viewerContainer.appendChild(fsmLabel);

    // Mutual gaze debug indicator (below FSM label)
    const mgLabel = document.createElement("div");
    mgLabel.className = "mg-debug";
    mgLabel.textContent = "Gaze State: –";
    if (!showDebug) mgLabel.style.display = "none";
    viewerContainer.appendChild(mgLabel);

    // Avatar eye yaw/pitch debug indicator
    const eyeLabel = document.createElement("div");
    eyeLabel.className = "eye-debug";
    eyeLabel.textContent = "Eye: –";
    if (!showDebug) eyeLabel.style.display = "none";
    viewerContainer.appendChild(eyeLabel);

    wrapper.appendChild(viewerContainer);

    // P1 integration:
    // when ?p1demo is present, keep the normal study conversation scene
    // but attach the P1 zone overlay on top of the existing viewer container.
    if (new URLSearchParams(window.location.search).has("p1demo")) {
      this.p1DemoController = new DemoControllerP1();
      this.p1ZoneTracker = new GazeZoneTracker();
      this.p1DemoController.attachToScene(viewerContainer, {
        title: "P1 Demo Controller",
        showOverlay: true,
      });
    }
    //_________________________________________________________________

    // Status element for loading feedback
    const status = document.createElement("p");
    status.className = "viewer-status";
    status.textContent = "Initializing viewer\u2026";
    if (!showDebug) status.style.display = "none";
    wrapper.appendChild(status);

    // Sync study context to backend for high-rate Tobii research logging
    this.syncGazeContext(step.id, this.condition ?? null);

    // Voice controls — auto-connect when Realtime is available.
    // When an avatar is selected, defer the first assistant response
    // until the avatar is loaded (signalReady) so the user does not
    // miss the first words.
    const autoConnect = this.runtime.capabilities.openai_realtime_enabled;
    this.realtimeClient = renderVoiceBar(
      wrapper,
      this.runtime,
      this.sessionId,
      this.reporter,
      this.config.meta.id,
      this.condition,
      step.id,
      selectedAvatar?.voice,
      {
        onRemoteStream: (stream) => {
          this.remoteStream = stream;
          this.tryAttachLipSync();
        },
        onDisconnect: () => {
          this.detachLipSync();
        },
        autoConnect,
        waitForReady: autoConnect && selectedAvatar !== null,
      },
    );

    if (!showDebug) {
      wrapper.querySelector(".voice-bar")?.setAttribute("style", "display:none");
    }

    // Full-slide loading overlay (covers entire step until avatar is ready)
    if (selectedAvatar) {
      const loadingOverlay = document.createElement("div");
      loadingOverlay.className = "viewer-loading";

      const spinner = document.createElement("div");
      spinner.className = "viewer-loading-spinner";
      loadingOverlay.appendChild(spinner);

      const loadingText = document.createElement("p");
      loadingText.className = "viewer-loading-text";
      loadingText.textContent = "Loading avatar\u2026";
      loadingOverlay.appendChild(loadingText);

      wrapper.appendChild(loadingOverlay);
    }

    // Initialize viewer after DOM attachment
    const condition = this.condition;
    requestAnimationFrame(() => {
      this.initViewer(
        canvas, status, viewerContainer,
        dot, debugLabel, fsmLabel, mgLabel, eyeLabel,
        condition, selectedAvatar,
      );
    });
  }

  /** Tear down viewer, gaze loop, and realtime client. Idempotent. */
  destroy(): void {
    this.syncGazeContext(null, null);
    this.detachLipSync();

    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
      this.realtimeClient = null;
    }

    // P1 temporary integration cleanup:
    // remove the development-only overlay when leaving the conversation step.
    this.p1DemoController?.destroy();
    this.p1DemoController = null;
    this.p1ZoneTracker = null;
    //_________________________________________________________________

    if (this.gazeLoopId !== null) {
      cancelAnimationFrame(this.gazeLoopId);
      this.gazeLoopId = null;
    }
    this.gazeProvider?.stop();
    this.gazeProvider = null;
    this.intersectionEngine = null;
    this.gazeFSM?.reset();
    this.gazeFSM = null;
    this.lookAtSmoother = null;

    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }

  // --- Internal ---

  private initViewer(
    canvas: HTMLCanvasElement,
    status: HTMLElement,
    container: HTMLElement,
    debugDot: HTMLElement,
    debugLabel: HTMLElement,
    fsmLabel: HTMLElement,
    mgLabel: HTMLElement,
    eyeLabel: HTMLElement,
    condition: string | undefined,
    selectedAvatar: Avatar | null,
  ): void {
    // Guard: render() may have already moved to a different step
    if (!canvas.isConnected) return;

    this.viewer = new ViewerCore();
    this.viewer.setup(canvas);

    if (!selectedAvatar) {
      status.textContent = "No avatar selected.";
      return;
    }

    const modelUrl = `${import.meta.env.BASE_URL}avatars/${selectedAvatar.model_file}`;
    status.textContent = "Loading avatar\u2026";

    this.viewer
      .loadAvatar(modelUrl)
      .then(() => {
        // Remove full-slide loading overlay
        container.closest(".study-screen")?.querySelector(".viewer-loading")?.remove();

        status.textContent = `Avatar loaded: ${selectedAvatar.label}`;

        // Cache VRMLookAtSmoother ref for direct FSM → saccade profile wiring.
        const lookAt = this.viewer?.avatar?.vrm?.lookAt;
        if (lookAt instanceof VRMLookAtSmoother) {
          this.lookAtSmoother = lookAt;
        }

        this.reporter.emit("avatar.loaded", {
          avatar_id: selectedAvatar.id,
          avatar_label: selectedAvatar.label,
          model_file: selectedAvatar.model_file,
          voice: selectedAvatar.voice,
          condition: this.condition ?? null,
          step_id: this.stepId ?? null,
        });

        // Attach lip sync if remote audio stream is already available
        this.tryAttachLipSync();

        // Signal avatar readiness — releases the deferred first assistant response
        this.realtimeClient?.signalReady();

        this.startGazeTracking(container, debugDot, debugLabel, fsmLabel, mgLabel, eyeLabel, condition);
      })
      .catch((err: unknown) => {
        // Remove full-slide loading overlay before showing fallback
        container.closest(".study-screen")?.querySelector(".viewer-loading")?.remove();

        // Disconnect and hide voice — no avatar means no conversation
        if (this.realtimeClient) {
          this.realtimeClient.disconnect();
          this.realtimeClient = null;
        }
        container.closest(".study-screen")
          ?.querySelector(".voice-bar")
          ?.classList.add("voice-bar-hidden");

        console.warn("Avatar not available:", err);
        this.renderAvatarFallback(container, status, debugDot, fsmLabel, mgLabel, eyeLabel);
      });
  }

  /**
   * Selects the appropriate gaze provider based on runtime capabilities.
   *
   * When Tobii is enabled and the adapter is running, probes
   * /api/gaze/latest to verify that gaze data is actually flowing
   * before committing to BackendGazeProvider. This avoids both the
   * bootstrap race (adapter running but no data yet at startup) and
   * the stale-adapter case (thread alive but TobiiStream crashed).
   *
   * Demo mode sets both tobii flags to false, so it always gets MouseProvider.
   */
  private async selectGazeProvider(
    container: HTMLElement,
  ): Promise<{ provider: GazeProvider; type: "mouse" | "backend" }> {
    const caps = this.runtime.capabilities;
    if (caps.tobii_enabled && caps.tobii_connected) {
      try {
        const res = await fetch(`${apiBase()}/api/gaze/latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            return { provider: new BackendGazeProvider(apiBase()), type: "backend" };
          }
        }
      } catch {
        // Network error — fall through to mouse
      }
      console.warn("[gaze] Tobii adapter running but no gaze data — falling back to mouse.");
    }
    return { provider: new MouseProvider(container), type: "mouse" };
  }

  private async startGazeTracking(
    container: HTMLElement,
    debugDot: HTMLElement,
    debugLabel: HTMLElement,
    fsmLabel: HTMLElement,
    mgLabel: HTMLElement,
    eyeLabel: HTMLElement,
    condition: string | undefined,
  ): Promise<void> {
    const selection = await this.selectGazeProvider(container);
    this.gazeProvider = selection.provider;
    this.gazeProviderType = selection.type;
    this.gazeProvider.start();
    const vrm = this.viewer?.avatar?.vrm;
    this.intersectionEngine = vrm
      ? IntersectionEngine.fromVRM(vrm)
      : new IntersectionEngine();

    const rootStyle = getComputedStyle(document.documentElement);
    const debugHitColor = rootStyle.getPropertyValue("--debug-hit").trim() || "#22c55e";
    const debugMissColor = rootStyle.getPropertyValue("--debug-miss").trim() || "#ef4444";
    const debugWarningColor = rootStyle.getPropertyValue("--debug-warning").trim() || "#f59e0b";

    const sourceLabel = this.gazeProviderType === "backend" ? "backend" : "mouse";
    debugLabel.textContent = `User Gaze: ${sourceLabel}`;

    // Live gaze cursor overlay
    const gazeCursor = document.createElement("div");
    gazeCursor.className = "gaze-cursor";
    container.appendChild(gazeCursor);

    // Only create FSM for gazeaware conditions
    if (condition === "gazeaware") {
      const profile = this.config.gaze_profiles.profiles["default"];
      if (profile) {
        this.gazeFSM = new GazeAwarenessMachine(profile);
      }
    }

    let prevHit: boolean | null = null;
    let prevFsmState: string | null = null;
    let prevBackendValid: boolean | null = null;

    // Mutual gaze tracking
    const mgTracker = new MutualGazeTracker();
    let prevAvatarEyeContact: boolean | null = null;
    let prevMutualGaze: boolean | null = null;

    // Research-mode gaze sampler: configurable Hz (default 90)
    const isResearch = this.runtime.log_mode === "research";
    const sampleHz = this.runtime.research_gaze_sample_hz ?? 90;
    const gazeSampleIntervalMs = sampleHz > 0 ? 1000 / sampleHz : 0;
    let lastSampleTime = 0;

    const loop = (): void => {
      this.gazeLoopId = requestAnimationFrame(loop);

      const now = performance.now();

      // VRMLookAtSmoother handles all gaze rendering (damping + saccades).

      const head =
        this.viewer?.avatar?.vrm?.humanoid?.getNormalizedBoneNode("head");
      const camera = this.viewer?.activeCamera;
      if (!head || !camera || !this.gazeProvider || !this.intersectionEngine)
        return;

      // Backend gaze stale-data check with transition logging
      if (
        this.gazeProviderType === "backend" &&
        this.gazeProvider instanceof BackendGazeProvider
      ) {
        const valid = this.gazeProvider.lastValid;
        if (prevBackendValid !== null && valid !== prevBackendValid) {
          this.reporter.emit("gaze.source_status_changed", {
            gaze_source: "backend",
            status: valid ? "valid" : "stale",
            condition: this.condition ?? null,
            step_id: this.stepId ?? null,
          });
        }
        prevBackendValid = valid;

        if (!valid) {
          debugDot.style.background = debugWarningColor;
          debugLabel.textContent = "User Gaze: backend (no data)";
          return;
        }
      }

      // BackendGazeProvider delivers [0,1] coordinates normalised to the
      // physical screen.  All browser geometry APIs (screen.width, screenX,
      // getBoundingClientRect) report CSS pixels = physical / dpr, so
      // gaze * screen.width already yields the correct CSS pixel position.
      let gaze = this.gazeProvider.current;
      if (this.gazeProviderType === "backend") {
        // Remap screen-normalised gaze [0,1] → container-relative [0,1]:
        //  1. gaze × screen size  → CSS-pixel position on the physical screen
        //  2. subtract window position + browser chrome (title bar, borders)
        //     to get viewport-relative pixel position
        //  3. subtract container rect offset and divide by container size
        //     to get the final [0,1] coordinate within the container
        const rect = container.getBoundingClientRect();
        const cssX = gaze.x * screen.width;
        const cssY = gaze.y * screen.height;
        const borderW = (window.outerWidth - window.innerWidth) / 2;
        const chromeH = window.outerHeight - window.innerHeight - borderW;
        gaze = {
          x: (cssX - window.screenX - borderW - rect.left) / rect.width,
          y: (cssY - window.screenY - chromeH - rect.top) / rect.height,
        };
      }

      // Move gaze cursor to remapped position
      gazeCursor.style.left = `${gaze.x * 100}%`;
      gazeCursor.style.top = `${gaze.y * 100}%`;

      const isHit = this.intersectionEngine.test(
        gaze,
        head,
        camera,
        container.clientWidth,
        container.clientHeight,
      );

      // P1: Zone-tracking integration
      // feed the original kit's gaze provider output + face-hit result into
      // the P1 tracker, then push the live snapshot into the P1 overlay HUD.
      const p1Snapshot = this.p1ZoneTracker?.update(gaze, now, isHit);
      if (p1Snapshot) {
        this.p1DemoController?.updateDebugSnapshot({
          activeZone: p1Snapshot.active_zone,
          dwellMs: p1Snapshot.active_zone.dwell_ms,
          fixationCount: p1Snapshot.fixation.total_count,
          perZoneCounts: p1Snapshot.fixation.per_zone_counts,
        });
      }
      //______________________________________________________________________

      // Gaze cursor intersection feedback
      gazeCursor.classList.toggle("intersecting", isHit);

      // Research-mode gaze sample (configurable Hz, default 10)
      if (isResearch && gazeSampleIntervalMs > 0 && now - lastSampleTime >= gazeSampleIntervalMs) {
        lastSampleTime = now;
        const vw = container.clientWidth;
        const vh = container.clientHeight;
        const xNorm = Math.round(gaze.x * 10000) / 10000;
        const yNorm = Math.round(gaze.y * 10000) / 10000;

        // Avatar applied eye direction including saccade offsets (T35a)
        let avatarLookatYawDeg: number | null = null;
        let avatarLookatPitchDeg: number | null = null;
        if (this.lookAtSmoother) {
          avatarLookatYawDeg = Math.round(this.lookAtSmoother.appliedYaw * 100) / 100;
          avatarLookatPitchDeg = Math.round(this.lookAtSmoother.appliedPitch * 100) / 100;
        }

        this.reporter.emit("gaze.sample", {
          x_norm: xNorm,
          y_norm: yNorm,
          x_px: Math.round(xNorm * vw * 10) / 10,
          y_px: Math.round(yNorm * vh * 10) / 10,
          viewer_width_px: vw,
          viewer_height_px: vh,
          gaze_source: this.gazeProviderType,
          intersecting: isHit,
          avatar_lookat_yaw_deg: avatarLookatYawDeg,
          avatar_lookat_pitch_deg: avatarLookatPitchDeg,
          condition: this.condition ?? null,
          step_id: this.stepId ?? null,
        });
      }

      // Intersection indicator with source label
      debugDot.style.background = isHit ? debugHitColor : debugMissColor;
      const raw = this.gazeProvider.current;
      debugLabel.textContent = isHit
        ? `User Gaze: looking at Avatar (${sourceLabel})`
        : `User Gaze: not looking at Avatar (${sourceLabel}) raw=${raw.x.toFixed(2)},${raw.y.toFixed(2)}`;

      // Telemetry: intersection change
      if (isHit !== prevHit) {
        this.reporter.emit("gaze.intersection_changed", {
          intersecting: isHit,
          gaze_source: this.gazeProviderType,
          condition: this.condition ?? null,
          step_id: this.stepId ?? null,
        });
        prevHit = isHit;
      }

      // FSM state indicator (top-right, gazeaware only)
      if (this.gazeFSM) {
        this.gazeFSM.update(isHit, now);
        const fsmState = this.gazeFSM.state;
        const fsmDisplayNames: Record<string, string> = {
          baseline: "random gaze",
          gazeaware_pending: "pending time",
          gazeaware: "mutual gaze",
          gaze_break: "gaze break",
        };
        fsmLabel.textContent = `FSM: ${fsmDisplayNames[fsmState] ?? fsmState}`;

        // Switch saccade profile per FSM state
        const profile = SACCADE_PROFILES[fsmState];
        if (profile) this.lookAtSmoother?.setProfile(profile);

        // Telemetry: FSM state change
        if (fsmState !== prevFsmState) {
          this.reporter.emit("fsm.state_changed", {
            from: prevFsmState,
            to: fsmState,
            condition: this.condition ?? null,
          });
          prevFsmState = fsmState;
        }
      }

      // Mutual gaze: derived from applied eye direction + intersection
      const eyeYaw = this.lookAtSmoother?.appliedYaw ?? 0;
      const eyePitch = this.lookAtSmoother?.appliedPitch ?? 0;
      const avatarEyeContact = mgTracker.isAvatarEyeContact(eyeYaw, eyePitch);
      const mutualGaze = mgTracker.isMutualGaze(avatarEyeContact, isHit);

      // Debug labels
      mgLabel.textContent = mutualGaze
        ? "Gaze State: mutual gaze"
        : avatarEyeContact
          ? "Gaze State: avatar looking at user"
          : "Gaze State: avatar looking away";
      eyeLabel.textContent = `Eye: yaw ${eyeYaw.toFixed(1)}° pitch ${eyePitch.toFixed(1)}°`;

      // Research-mode telemetry: avatar eye contact transition
      if (isResearch && avatarEyeContact !== prevAvatarEyeContact) {
        this.reporter.emit("gaze.avatar_eye_contact_changed", {
          avatar_eye_contact: avatarEyeContact,
          condition: this.condition ?? null,
          step_id: this.stepId ?? null,
        });
        prevAvatarEyeContact = avatarEyeContact;
      }

      // Research-mode telemetry: mutual gaze transition
      if (isResearch && mutualGaze !== prevMutualGaze) {
        this.reporter.emit("gaze.mutual_gaze_changed", {
          mutual_gaze: mutualGaze,
          avatar_eye_contact: avatarEyeContact,
          user_intersection: isHit,
          condition: this.condition ?? null,
          step_id: this.stepId ?? null,
        });
        prevMutualGaze = mutualGaze;
      }
    };

    this.gazeLoopId = requestAnimationFrame(loop);
  }

  /** Sync study context to backend for high-rate Tobii research logging. */
  private syncGazeContext(stepId: string | null, condition: string | null): void {
    if (this.runtime.log_mode !== "research") return;
    const caps = this.runtime.capabilities;
    if (!caps.tobii_enabled || !caps.tobii_connected) return;

    fetch(`${apiBase()}/api/gaze/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: this.sessionId,
        step_id: stepId,
        condition: condition,
      }),
    }).catch(() => {
      // Best-effort — gaze context sync failure should not block the study
    });
  }

  /**
   * Attaches lip sync when both the remote audio stream and a loaded
   * avatar are available. Called from onRemoteStream and after avatar load.
   */
  private tryAttachLipSync(): void {
    if (this.lipSyncAttached) return;
    if (!this.remoteStream || !this.viewer?.avatar?.vrm) return;
    this.viewer.attachLipSyncStream(this.remoteStream);
    this.lipSyncAttached = true;
  }

  /** Disconnects lip sync audio and clears the remote stream ref. */
  private detachLipSync(): void {
    this.viewer?.detachLipSync();
    this.lipSyncAttached = false;
    this.remoteStream = null;
  }

  private renderAvatarFallback(
    container: HTMLElement,
    status: HTMLElement,
    debugDot: HTMLElement,
    fsmLabel: HTMLElement,
    mgLabel: HTMLElement,
    eyeLabel: HTMLElement,
  ): void {
    const fallback = document.createElement("div");
    fallback.className = "viewer-fallback";

    const icon = document.createElement("div");
    icon.className = "viewer-fallback-icon";
    fallback.appendChild(icon);

    const title = document.createElement("p");
    title.className = "viewer-fallback-title";
    title.textContent = "Avatar unavailable";
    fallback.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "viewer-fallback-hint";
    hint.textContent =
      "The 3D avatar could not be loaded. You can continue through the study, but the avatar will not be shown for this round.";
    fallback.appendChild(hint);

    container.appendChild(fallback);

    // Hide gaze/FSM/MG indicators — no avatar to track against
    debugDot.parentElement!.style.display = "none";
    fsmLabel.style.display = "none";
    mgLabel.style.display = "none";
    eyeLabel.style.display = "none";

    status.textContent =
      "No avatar file found — the demo continues without a 3D model.";
  }
}
