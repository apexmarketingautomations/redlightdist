"use client";
import { useState } from "react";

export function MediaUploader({creatorId}:{creatorId:string}){
  const [status,setStatus]=useState("");const [progress,setProgress]=useState(0);
  const upload=async(file:File)=>{
    setStatus("Preparing secure upload…");setProgress(0);
    const init=await fetch(`/api/creator/${creatorId}/media/upload`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({filename:file.name,contentType:file.type,byteSize:file.size})});
    const spec=await init.json() as {assetId?:string;uploadUrl?:string;headers?:Record<string,string>;error?:string};
    if(!init.ok||!spec.assetId||!spec.uploadUrl)throw new Error(spec.error||"Upload could not be initialized");
    await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open("PUT",spec.uploadUrl!);for(const [k,v] of Object.entries(spec.headers??{}))xhr.setRequestHeader(k,v);xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round((e.loaded/e.total)*100));};xhr.onerror=()=>reject(new Error("Upload transfer failed"));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error(`Storage rejected upload (${xhr.status})`));xhr.send(file);});
    setStatus("Verifying uploaded object…");
    const done=await fetch(`/api/creator/${creatorId}/media/${spec.assetId}/finalize`,{method:"POST"});const result=await done.json() as {ok?:boolean;error?:string};if(!done.ok||!result.ok)throw new Error(result.error||"Upload verification failed");
    setProgress(100);setStatus("Upload verified and ready.");
  };
  return <section className="creator-card"><div className="creator-card-head"><div><small>SECURE MEDIA</small><h2>Upload image, video or audio</h2></div></div><p>Files upload directly to private object storage. The platform verifies size and media type before the asset becomes usable.</p><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{await upload(file);}catch(error){setStatus(error instanceof Error?error.message:"Upload failed");}}}/>{progress>0&&<progress max={100} value={progress}>{progress}%</progress>}{status&&<p role="status">{status}</p>}</section>;
}
