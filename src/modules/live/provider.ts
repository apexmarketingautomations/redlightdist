export type StreamAccess = "public" | "subscriber" | "membership" | "ppv";
export interface LiveStreamSpec {
  creatorId: string;
  streamId: string;
  title: string;
  scheduledFor?: Date | null;
  recordingEnabled: boolean;
}
export interface LiveStreamHandle { providerStreamId: string; ingestUrl?: string; streamKey?: string; }
export interface PlaybackGrant { token: string; expiresAt: Date; playbackUrl?: string; }
export interface LiveStreamAnalytics { currentViewers: number; uniqueViewers: number; durationSeconds?: number; }

export interface LiveStreamingProvider {
  readonly name: string;
  createStream(spec: LiveStreamSpec): Promise<LiveStreamHandle>;
  startStream(providerStreamId: string): Promise<void>;
  endStream(providerStreamId: string): Promise<void>;
  getStreamStatus(providerStreamId: string): Promise<"created"|"live"|"ended"|"failed">;
  createPlaybackToken(input: {providerStreamId:string; viewerId:string; canPublish:boolean; ttlSeconds:number}): Promise<PlaybackGrant>;
  revokeViewer?(input: {providerStreamId:string; viewerId:string}): Promise<void>;
  getViewerCount(providerStreamId: string): Promise<number>;
  getStreamAnalytics(providerStreamId: string): Promise<LiveStreamAnalytics>;
  createRecording(providerStreamId: string): Promise<{providerRecordingId:string}>;
  deleteRecording(providerRecordingId: string): Promise<void>;
}

export class LiveProviderNotConfiguredError extends Error {
  constructor(provider: string) { super(`${provider} livestream provider is not configured.`); this.name="LiveProviderNotConfiguredError"; }
}
const providers = new Map<string,LiveStreamingProvider>();
export function registerLiveProvider(provider: LiveStreamingProvider): void { providers.set(provider.name,provider); }
export function getLiveProvider(name:string): LiveStreamingProvider {
  const provider=providers.get(name); if(!provider) throw new LiveProviderNotConfiguredError(name); return provider;
}
