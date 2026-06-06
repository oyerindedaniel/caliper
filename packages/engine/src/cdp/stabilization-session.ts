import type { CdpSendClient } from "./cdp-page-session.js";
import type { AnimationGetPlaybackRateResponse } from "./cdp-protocol.js";

export class StabilizationSession {
  private savedPlaybackRate: number | null = null;

  constructor(private readonly client: CdpSendClient) {}

  async pauseAnimations(): Promise<{ playbackRate: number }> {
    await this.client.send("Animation.enable");

    const currentRate = await this.client.send<AnimationGetPlaybackRateResponse>(
      "Animation.getPlaybackRate"
    );
    this.savedPlaybackRate = currentRate.playbackRate;

    await this.client.send("Animation.setPlaybackRate", { playbackRate: 0 });

    return { playbackRate: 0 };
  }

  async resumeAnimations(): Promise<{ playbackRate: number }> {
    const playbackRate = this.savedPlaybackRate ?? 1;
    await this.client.send("Animation.setPlaybackRate", { playbackRate });
    this.savedPlaybackRate = null;
    return { playbackRate };
  }
}
