CREATE OR REPLACE FUNCTION resolve_platform_subscription(p_provider text,p_subscription_id text)
RETURNS TABLE(creator_id uuid,plan_code text,billing_interval text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT s.creator_id,p.code,s.billing_interval
  FROM platform_billing_subscriptions s JOIN plans p ON p.id=s.plan_id
  WHERE s.provider=p_provider AND s.provider_subscription_id=p_subscription_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_platform_subscription(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_platform_subscription(text,text) TO redlight_runtime;
