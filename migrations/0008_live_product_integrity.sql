CREATE OR REPLACE FUNCTION sync_livestream_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE existing_id uuid;
BEGIN
  IF NEW.access_type='ppv' THEN
    SELECT id INTO existing_id FROM products
      WHERE creator_id=NEW.creator_id AND product_type='livestream' AND metadata->>'streamId'=NEW.id::text
      ORDER BY created_at LIMIT 1;
    IF existing_id IS NULL THEN
      INSERT INTO products(creator_id,name,description,product_type,price_minor,currency,active,metadata)
      VALUES(NEW.creator_id,NEW.title,NEW.description,'livestream',coalesce(NEW.ppv_price_minor,0),NEW.currency,true,jsonb_build_object('streamId',NEW.id::text));
    ELSE
      UPDATE products SET name=NEW.title,description=NEW.description,price_minor=coalesce(NEW.ppv_price_minor,0),currency=NEW.currency,active=NEW.status<>'cancelled',updated_at=now()
      WHERE creator_id=NEW.creator_id AND id=existing_id;
    END IF;
  ELSE
    UPDATE products SET active=false,updated_at=now()
      WHERE creator_id=NEW.creator_id AND product_type='livestream' AND metadata->>'streamId'=NEW.id::text;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS live_stream_product_sync ON live_streams;
CREATE TRIGGER live_stream_product_sync AFTER INSERT OR UPDATE OF title,description,access_type,ppv_price_minor,currency,status
ON live_streams FOR EACH ROW EXECUTE FUNCTION sync_livestream_product();
