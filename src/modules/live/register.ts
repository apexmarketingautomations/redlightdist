import "server-only";
import { getLiveProvider, registerLiveProvider } from "./provider";
import { livekitProvider } from "./livekit";
let initialized=false;
export function ensureLiveProvidersRegistered(){
  if(initialized)return;
  try{getLiveProvider("livekit");}catch{registerLiveProvider(livekitProvider);}
  initialized=true;
}
