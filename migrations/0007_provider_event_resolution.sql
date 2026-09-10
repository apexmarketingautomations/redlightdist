-- Narrow SECURITY DEFINER helpers used before a tenant context can be established.
-- They reveal only identifiers needed to verify provider-originated callbacks.
CREATE OR REPLACE FUNCTION resolve_payment_account_for_webhook(p_provider text,p_creator_id uuid)
RETURNS TABLE(account_id uuid,merchant_reference text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT p.id,p.merchant_reference
  FROM payment_provider_accounts p
  JOIN creators c ON c.id=p.creator_id
  WHERE p.creator_id=p_creator_id
    AND p.provider=p_provider
    AND p.status='active'
    AND c.status IN ('active','suspended')
    AND c.deleted_at IS NULL
  ORDER BY p.is_default DESC,p.created_at ASC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_payment_account_for_webhook(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_payment_account_for_webhook(text,uuid) TO redlight_runtime;

GRANT SELECT,INSERT,UPDATE ON webhook_events TO redlight_runtime;
