import "server-only";
import { hasPaymentProvider, registerPaymentProvider } from "../provider";
import { ccbillProvider } from "./ccbill";
import { segpayProvider } from "./segpay";

let initialized=false;
export function ensurePaymentProvidersRegistered(){
  if(initialized)return;
  if(!hasPaymentProvider(ccbillProvider.name))registerPaymentProvider(ccbillProvider);
  if(!hasPaymentProvider(segpayProvider.name))registerPaymentProvider(segpayProvider);
  initialized=true;
}
