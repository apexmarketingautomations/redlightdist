import "server-only";
import type { PoolClient } from "pg";

export async function accrueReferralCommission(client:PoolClient,input:{creatorId:string;transactionId:string;fanId:string|null;grossMinor:number;currency:string}){
  if(!input.fanId||input.grossMinor<=0)return null;
  const attribution=(await client.query<{code:string|null;referral_id:string|null;referrer_fan_id:string|null;reward_minor:number|null;affiliate_id:string|null;commission_bps:number|null}>(`SELECT fp.referral_source code,r.id referral_id,r.referrer_fan_id,r.reward_minor,a.id affiliate_id,a.commission_bps
    FROM fan_profiles fp
    LEFT JOIN referrals r ON r.creator_id=fp.creator_id AND r.code=fp.referral_source AND r.status<>'void'
    LEFT JOIN affiliates a ON a.creator_id=fp.creator_id AND a.code=fp.referral_source AND a.status='active'
    WHERE fp.creator_id=$1 AND fp.fan_id=$2 AND fp.referral_source IS NOT NULL LIMIT 1`,[input.creatorId,input.fanId])).rows[0];
  if(!attribution||(!attribution.referral_id&&!attribution.affiliate_id))return null;
  const commission=attribution.affiliate_id?Math.floor(input.grossMinor*Math.max(0,Math.min(10000,attribution.commission_bps??0))/10000):Math.max(0,attribution.reward_minor??0);
  if(commission<=0)return null;
  const row=(await client.query<{id:string}>(`INSERT INTO referral_commissions(creator_id,referral_id,affiliate_id,transaction_id,beneficiary_fan_id,basis_minor,commission_minor,currency,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'accrued') ON CONFLICT DO NOTHING RETURNING id`,[input.creatorId,attribution.referral_id,attribution.affiliate_id,input.transactionId,attribution.referrer_fan_id,input.grossMinor,commission,input.currency])).rows[0];
  if(attribution.referral_id)await client.query("UPDATE referrals SET status=CASE WHEN status='pending' THEN 'qualified' ELSE status END WHERE creator_id=$1 AND id=$2",[input.creatorId,attribution.referral_id]);
  return row?.id??null;
}

export async function reverseReferralCommission(client:PoolClient,input:{creatorId:string;transactionId:string}){
  const rows=(await client.query<{id:string;referral_id:string|null}>("UPDATE referral_commissions SET status='reversed',reversed_at=coalesce(reversed_at,now()) WHERE creator_id=$1 AND transaction_id=$2 AND status IN ('accrued','approved','payable') RETURNING id,referral_id",[input.creatorId,input.transactionId])).rows;
  for(const row of rows)if(row.referral_id)await client.query("UPDATE referrals SET status='void' WHERE creator_id=$1 AND id=$2 AND status IN ('qualified','rewarded')",[input.creatorId,row.referral_id]);
  return rows.length;
}

export async function approveReferralCommission(client:PoolClient,input:{creatorId:string;commissionId:string}){
  const row=(await client.query<{referral_id:string|null}>("UPDATE referral_commissions SET status='payable',approved_at=coalesce(approved_at,now()) WHERE creator_id=$1 AND id=$2 AND status IN ('accrued','approved') RETURNING referral_id",[input.creatorId,input.commissionId])).rows[0];
  if(row?.referral_id)await client.query("UPDATE referrals SET status='rewarded' WHERE creator_id=$1 AND id=$2 AND status='qualified'",[input.creatorId,row.referral_id]);
  return Boolean(row);
}

export async function markReferralCommissionPaid(client:PoolClient,input:{creatorId:string;commissionId:string;payoutReference:string}){
  const row=await client.query("UPDATE referral_commissions SET status='paid',paid_at=now(),payout_reference=$3 WHERE creator_id=$1 AND id=$2 AND status='payable'",[input.creatorId,input.commissionId,input.payoutReference]);
  return Boolean(row.rowCount);
}
