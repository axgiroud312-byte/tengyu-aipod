DROP TABLE IF EXISTS "device_activations";
DROP TABLE IF EXISTS "activation_codes";

ALTER TABLE "telemetry_errors" DROP COLUMN IF EXISTS "device_fingerprint";
ALTER TABLE "telemetry_errors" ADD COLUMN IF NOT EXISTS "client_id" TEXT;
