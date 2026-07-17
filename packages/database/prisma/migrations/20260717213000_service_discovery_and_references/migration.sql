CREATE TYPE "ServiceSource" AS ENUM ('manual', 'kubernetes', 'github', 'alert');
CREATE TYPE "ServiceVerificationStatus" AS ENUM ('unverified', 'verified');

ALTER TABLE "services"
    ADD COLUMN "source" "ServiceSource" NOT NULL DEFAULT 'manual',
    ADD COLUMN "verification_status" "ServiceVerificationStatus" NOT NULL DEFAULT 'verified';

CREATE SEQUENCE "incident_reference_seq" START WITH 1000 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
GRANT USAGE, SELECT ON SEQUENCE "incident_reference_seq" TO incident_app;
