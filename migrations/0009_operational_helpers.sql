CREATE OR REPLACE FUNCTION raise_current_tenant_alert(p_severity text,p_alert_key text,p_title text,p_body text,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE tenant uuid; result uuid;
BEGIN
  tenant:=nullif(current_setting('app.creator_id',true),'')::uuid;
  IF tenant IS NULL THEN RAISE EXCEPTION 'tenant context required'; END IF;
  IF p_severity NOT IN ('info','warning','critical') THEN RAISE EXCEPTION 'invalid severity'; END IF;
  INSERT INTO platform_alerts(creator_id,severity,alert_key,title,body,metadata)
  VALUES(tenant,p_severity,p_alert_key,left(p_title,300),left(p_body,5000),coalesce(p_metadata,'{}'::jsonb)) RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION raise_current_tenant_alert(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raise_current_tenant_alert(text,text,text,text,jsonb) TO redlight_runtime;
