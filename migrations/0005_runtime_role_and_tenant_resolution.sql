-- Enforce RLS even when the deployment connection uses a privileged migration/owner credential.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='redlight_runtime') THEN
    CREATE ROLE redlight_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO redlight_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO redlight_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO redlight_runtime;

-- Resolve only the minimum public routing fact (creator id). All data access after this re-enters creator-scoped RLS.
CREATE OR REPLACE FUNCTION resolve_creator_host(request_host text, platform_host text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
  prefix text;
BEGIN
  IF request_host IS NULL OR length(request_host)=0 THEN RETURN NULL; END IF;

  SELECT c.id INTO found_id
    FROM creator_domains d
    JOIN creators c ON c.id=d.creator_id
   WHERE lower(d.hostname)=lower(request_host)
     AND d.status='verified'
     AND c.status='active'
     AND c.deleted_at IS NULL
   LIMIT 1;
  IF found_id IS NOT NULL THEN RETURN found_id; END IF;

  IF platform_host IS NOT NULL AND request_host LIKE '%.' || platform_host THEN
    prefix := left(request_host,length(request_host)-length(platform_host)-1);
    IF prefix <> '' AND position('.' in prefix)=0 THEN
      SELECT c.id INTO found_id FROM creators c
       WHERE lower(c.slug)=lower(prefix) AND c.status='active' AND c.deleted_at IS NULL LIMIT 1;
      RETURN found_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION resolve_creator_host(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_creator_host(text,text) TO redlight_runtime;
