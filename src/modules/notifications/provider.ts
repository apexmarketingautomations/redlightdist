export interface EmailMessage { to:string; subject:string; text:string; html?:string; replyTo?:string; }
export interface SmsMessage { to:string; body:string; }
export interface DeliveryResult { providerMessageId:string; accepted:boolean; }

export interface EmailProvider { readonly name:string; send(message:EmailMessage):Promise<DeliveryResult>; }
export interface SmsProvider { readonly name:string; send(message:SmsMessage):Promise<DeliveryResult>; }

class HttpEmailProvider implements EmailProvider {
  readonly name="http-email";
  constructor(private endpoint:string,private token:string){}
  async send(message:EmailMessage):Promise<DeliveryResult>{
    const response=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`},body:JSON.stringify(message),cache:"no-store"});
    if(!response.ok) throw new Error(`EMAIL_PROVIDER_ERROR:${response.status}`);
    const data=await response.json().catch(()=>({})) as {id?:string;accepted?:boolean};
    return {providerMessageId:data.id??crypto.randomUUID(),accepted:data.accepted!==false};
  }
}
class HttpSmsProvider implements SmsProvider {
  readonly name="http-sms";
  constructor(private endpoint:string,private token:string){}
  async send(message:SmsMessage):Promise<DeliveryResult>{
    const response=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`},body:JSON.stringify(message),cache:"no-store"});
    if(!response.ok) throw new Error(`SMS_PROVIDER_ERROR:${response.status}`);
    const data=await response.json().catch(()=>({})) as {id?:string;accepted?:boolean};
    return {providerMessageId:data.id??crypto.randomUUID(),accepted:data.accepted!==false};
  }
}

export function configuredEmailProvider():EmailProvider|null{
  const endpoint=process.env.EMAIL_PROVIDER_ENDPOINT?.trim(); const token=process.env.EMAIL_PROVIDER_TOKEN?.trim();
  return endpoint&&token?new HttpEmailProvider(endpoint,token):null;
}
export function configuredSmsProvider():SmsProvider|null{
  const endpoint=process.env.SMS_PROVIDER_ENDPOINT?.trim(); const token=process.env.SMS_PROVIDER_TOKEN?.trim();
  return endpoint&&token?new HttpSmsProvider(endpoint,token):null;
}

export async function requireEmailDelivery(message:EmailMessage):Promise<DeliveryResult>{
  const provider=configuredEmailProvider(); if(!provider) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const result=await provider.send(message); if(!result.accepted) throw new Error("EMAIL_PROVIDER_REJECTED"); return result;
}
