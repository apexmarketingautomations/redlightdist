import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encryptionKey(){
  const raw=process.env.MFA_ENCRYPTION_KEY;if(!raw)throw new Error("MFA_NOT_CONFIGURED");
  let key:Buffer;try{key=Buffer.from(raw,"base64");}catch{throw new Error("MFA_ENCRYPTION_KEY_INVALID");}
  if(key.length!==32)throw new Error("MFA_ENCRYPTION_KEY_INVALID");return key;
}
export function base32Encode(input:Buffer){let bits=0,value=0,out="";for(const byte of input){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=alphabet[(value<<(5-bits))&31];return out;}
function base32Decode(value:string){let bits=0,current=0;const bytes:number[]=[];for(const char of value.toUpperCase().replace(/=|\s|-/g,"")){const index=alphabet.indexOf(char);if(index<0)throw new Error("INVALID_BASE32");current=(current<<5)|index;bits+=5;if(bits>=8){bytes.push((current>>>(bits-8))&255);bits-=8;}}return Buffer.from(bytes);}
export function newTotpSecret(){return base32Encode(randomBytes(20));}
export function encryptMfaSecret(secret:string){const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);const ciphertext=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);return{ciphertext:ciphertext.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};}
export function decryptMfaSecret(input:{ciphertext:string;iv:string;tag:string}){const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(input.iv,"base64"));decipher.setAuthTag(Buffer.from(input.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(input.ciphertext,"base64")),decipher.final()]).toString("utf8");}
function hotp(secret:string,counter:number){const key=base32Decode(secret);const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const digest=createHmac("sha1",key).update(buf).digest();const offset=digest[digest.length-1]!&15;const value=((digest[offset]!&127)<<24)|(digest[offset+1]!<<16)|(digest[offset+2]!<<8)|digest[offset+3]!;return String(value%1_000_000).padStart(6,"0");}
export function verifyTotp(secret:string,code:string,nowMs=Date.now()){if(!/^\d{6}$/.test(code))return false;const counter=Math.floor(nowMs/30000);for(const delta of [-1,0,1]){const expected=hotp(secret,counter+delta);const a=Buffer.from(code),b=Buffer.from(expected);if(a.length===b.length&&timingSafeEqual(a,b))return true;}return false;}
export function totpUri(input:{secret:string;email:string;issuer?:string}){const issuer=input.issuer??"Redlight";return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(input.email)}?secret=${encodeURIComponent(input.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;}
