import "server-only";

export type CCBillConfig={flexFormId:string;clientSubacc:string;encryptionKey:string;currencyCodes?:Record<string,string>};
export type SegpayConfig={merchantId:string;srsUserId:string;srsAccessKey:string;eticketId:string;joinBaseUrl?:string;dynamicPricingBaseUrl?:string};
export type PaymentAccountConfig={ccbill?:CCBillConfig;segpay?:SegpayConfig};

let cache:Record<string,PaymentAccountConfig>|null=null;
function load():Record<string,PaymentAccountConfig>{
  if(cache)return cache;
  const raw=process.env.PAYMENT_ACCOUNT_CONFIG_JSON;
  if(!raw){cache={};return cache;}
  try{const parsed=JSON.parse(raw) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("not object");cache=parsed as Record<string,PaymentAccountConfig>;return cache;}
  catch{throw new Error("PAYMENT_ACCOUNT_CONFIG_JSON is invalid JSON");}
}

export function paymentAccountConfig(accountId:string,merchantReference?:string|null):PaymentAccountConfig{
  const all=load();
  return all[accountId]??(merchantReference?all[merchantReference]:undefined)??{};
}
