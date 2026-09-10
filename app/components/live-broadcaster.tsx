"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

export function LiveBroadcaster({creatorId,streamId}:{creatorId:string;streamId:string}){
  const roomRef=useRef<Room|null>(null);const previewRef=useRef<HTMLVideoElement>(null);
  const [state,setState]=useState<"idle"|"connecting"|"live"|"error">("idle");const [message,setMessage]=useState("");
  const connect=async()=>{
    setState("connecting");setMessage("");
    try{
      const response=await fetch(`/api/creator/${creatorId}/live/${streamId}/token`,{cache:"no-store"});const data=await response.json() as {token?:string;url?:string;error?:string};
      if(!response.ok||!data.token||!data.url)throw new Error(data.error||"Unable to get broadcast token");
      const room=new Room();roomRef.current=room;room.on(RoomEvent.Disconnected,()=>setState("idle"));await room.connect(data.url,data.token);
      await room.localParticipant.setCameraEnabled(true);await room.localParticipant.setMicrophoneEnabled(true);
      const publication=room.localParticipant.getTrackPublication(Track.Source.Camera);const track=publication?.track;if(track&&previewRef.current)track.attach(previewRef.current);
      setState("live");
    }catch(error){setState("error");setMessage(error instanceof Error?error.message:"Unable to start camera");}
  };
  const disconnect=async()=>{const room=roomRef.current;if(room){await room.localParticipant.setCameraEnabled(false);await room.localParticipant.setMicrophoneEnabled(false);await room.disconnect();roomRef.current=null;}setState("idle");};
  useEffect(()=>()=>{const room=roomRef.current;if(room)void room.disconnect();},[]);
  return <section className="creator-card live-studio"><div className="creator-card-head"><div><small>BROADCAST</small><h2>Creator studio</h2></div><span className={`creator-status ${state}`}>{state}</span></div><video ref={previewRef} autoPlay muted playsInline className="live-preview"/>{state!=="live"?<button className="creator-action" type="button" onClick={connect} disabled={state==="connecting"}>{state==="connecting"?"Connecting…":"Connect camera & microphone"}</button>:<button className="creator-action quiet" type="button" onClick={disconnect}>Disconnect preview</button>}{message&&<p className="creator-alert">{message}</p>}</section>;
}
