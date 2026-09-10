import "server-only";
import { hasStorageProvider, registerStorageProvider } from "./provider";
import { s3StorageProvider } from "./s3";
let initialized=false;
export function ensureStorageProvidersRegistered(){if(initialized)return;if(!hasStorageProvider("s3"))registerStorageProvider(s3StorageProvider);initialized=true;}
