-- UI v3 data migration. Additive and idempotent: only INSERTs of new rows, UPDATEs of NEW columns, and a permission append.
-- Nothing is deleted, no existing value of header / panels / shares / photos is rewritten.

-- 1. System calculation methods, one pair per organisation (the historical behaviour, locked)
INSERT INTO "calc_methods" ("org_id", "name", "engine", "country", "is_system", "current_version")
SELECT o."id", 'BVAT 2025 (System)', 'aw', 'DE', true, 1 FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "calc_methods" m WHERE m."org_id" = o."id" AND m."is_system" AND m."country" = 'DE');
--> statement-breakpoint
INSERT INTO "calc_methods" ("org_id", "name", "engine", "country", "is_system", "current_version")
SELECT o."id", 'PDR Team Matrix (System)', 'matrix', 'ES', true, 1 FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "calc_methods" m WHERE m."org_id" = o."id" AND m."is_system" AND m."country" = 'ES');
--> statement-breakpoint

-- 2. Version 1 of each system method. DE = the built-in BVAT 2025 constants. ES = a COPY of the matrix the organisation uses today
--    (org_settings.esMatrix; JSON null = the built-in matrix).
INSERT INTO "calc_method_versions" ("method_id", "version", "params")
SELECT m."id", 1, '{"vat":0.19,"aluFactor":1.25,"kleberFactor":1.3,"ptpFactor":0.6,"extras":{"10":{"ruest":6,"greif":9,"finishPer":2.5,"finishCap":13,"hohl":4,"verbr":15},"12":{"ruest":7,"greif":11,"finishPer":3.5,"finishCap":16,"hohl":5,"verbr":18}},"kleberMaterial":{"upTo2":10,"upTo5":15,"more":20},"hohlraumMaterial":15}'::jsonb
FROM "calc_methods" m
WHERE m."is_system" AND m."engine" = 'aw'
  AND NOT EXISTS (SELECT 1 FROM "calc_method_versions" v WHERE v."method_id" = m."id" AND v."version" = 1);
--> statement-breakpoint
INSERT INTO "calc_method_versions" ("method_id", "version", "params")
SELECT m."id", 1, jsonb_build_object('esMatrix', (SELECT s."settings" -> 'esMatrix' FROM "org_settings" s WHERE s."org_id" = m."org_id"))
FROM "calc_methods" m
WHERE m."is_system" AND m."engine" = 'matrix'
  AND NOT EXISTS (SELECT 1 FROM "calc_method_versions" v WHERE v."method_id" = m."id" AND v."version" = 1);
--> statement-breakpoint

-- 3. Existing vehicles are frozen on version 1 of the system method of their country: their amounts can never change again
UPDATE "vehicles" v SET "method_id" = m."id", "method_version" = 1
FROM "calc_methods" m
WHERE v."method_id" IS NULL AND m."org_id" = v."org_id" AND m."is_system"
  AND m."country" = COALESCE(NULLIF(v."header" ->> 'land', ''), 'DE');
--> statement-breakpoint

-- 4. Repair board column of the vehicles already in the repair flow (everything starts in "Bereit"; the technician moves it on)
UPDATE "vehicles" SET "repair_stage" = 'bereit'
WHERE "repair_stage" IS NULL AND ("statut" = 'reparatur' OR ("statut" = 'attente' AND "statut_avant" = 'reparatur'));
--> statement-breakpoint
UPDATE "vehicles" SET "repair_stage" = 'finish'
WHERE "repair_stage" IS NULL AND ("statut" = 'fertig' OR ("statut" = 'attente' AND "statut_avant" = 'fertig'));
--> statement-breakpoint

-- 5. New permissions: appended to the roles that have the nearest existing permission, so nobody loses access
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['reparatur.board']::text[]
WHERE 'vehicules.changer_statut' = ANY("permissions") AND NOT ('reparatur.board' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['termine.buchen']::text[]
WHERE 'vehicules.changer_statut' = ANY("permissions") AND NOT ('termine.buchen' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['kommentare.schreiben']::text[]
WHERE 'vehicules.modifier' = ANY("permissions") AND NOT ('kommentare.schreiben' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['methoden.gerer']::text[]
WHERE 'parametres.gerer' = ANY("permissions") AND NOT ('methoden.gerer' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['wochenbericht.voir']::text[]
WHERE ('parametres.gerer' = ANY("permissions") OR ('export.excel' = ANY("permissions") AND 'repartition_interne.voir' = ANY("permissions")))
  AND NOT ('wochenbericht.voir' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['reparatur.endabnahme']::text[]
WHERE ("key" IN ('org_admin', 'chef_site') OR ('vehicules.assigner' = ANY("permissions") AND 'prix.voir' = ANY("permissions")))
  AND NOT ('reparatur.endabnahme' = ANY("permissions"));
--> statement-breakpoint

-- 6. "Chef de station" wording of the default role (only if nobody renamed it)
UPDATE "roles" SET "name" = 'Chef de station (Stationsleiter)'
WHERE "key" = 'chef_site' AND "is_system" AND "name" = 'Chef de site (Werkstattleiter)';
