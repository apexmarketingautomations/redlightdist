import "server-only";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { LiveStreamingProvider } from "./provider";

function cfg(){
  const url=process.env.LIVEKIT_URL,apiKey=process.env.LIVEKIT_API_KEY,apiSecret=process.env.LIVEKIT_API_SECRET;
  if(!url||!apiKey||!apiSecret)throw new Error("LIVEKIT_NOT_CONFIGURED");
  return{url,apiKey,apiSecret};
}
const roomName=(providerStreamId:string)=>providerStreamId;
const client=()=>{const c=cfg();return new RoomServiceClient(c.url,c.apiKey,c.apiSecret);};

export const livekitProvider:LiveStreamingProvider={
  name:"livekit",
  async createStream(spec){
    const name=`creator-${spec.creatorId}-stream-${spec.streamId}`;
    await client().createRoom({name,emptyTimeout:20*60,maxParticipants:Number(process.env.LIVEKIT_MAX_PARTICIPANTS||500)});
    return{providerStreamId:name};
  },
  async startStream(providerStreamId){await client().createRoom({name:roomName(providerStreamId),emptyTimeout:20*60,maxParticipants:Number(process.env.LIVEKIT_MAX_PARTICIPANTS||500)});},
  async endStream(providerStreamId){await client().deleteRoom(roomName(providerStreamId));},
  async getStreamStatus(providerStreamId){
    const rooms=await client().listRooms([roomName(providerStreamId)]);
    return rooms.length?"live":"ended";
  },
  async createPlaybackToken(input){
    const c=cfg();
    const token=new AccessToken(c.apiKey,c.apiSecret,{identity:input.viewerId,ttl:Math.max(60,Math.min(3600,input.ttlSeconds))});
    token.addGrant({roomJoin:true,room:roomName(input.providerStreamId),canPublish:input.canPublish,canSubscribe:true,canPublishData:input.canPublish});
    return{token:await token.toJwt(),expiresAt:new Date(Date.now()+Math.max(60,Math.min(3600,input.ttlSeconds))*1000),playbackUrl:c.url};
  },
  async revokeViewer(input){await client().removeParticipant(roomName(input.providerStreamId),input.viewerId);},
  async getViewerCount(providerStreamId){return (await client().listParticipants(roomName(providerStreamId))).length;},
  async getStreamAnalytics(providerStreamId){const current=(await client().listParticipants(roomName(providerStreamId))).length;return{currentViewers:current,uniqueViewers:current};},
  async createRecording(){throw new Error("LIVEKIT_EGRESS_RECORDING_NOT_CONFIGURED");},
  async deleteRecording(){throw new Error("LIVEKIT_EGRESS_RECORDING_NOT_CONFIGURED");},
};
