-- V5 dry run: READ-ONLY (SELECT only). Run it on the staging copy, and again on the real database right before the V5 migration.
-- Staging:  .\infra\scripts\render_query.ps1 -SqlFile infra\scripts\v5_dryrun.sql        (needs Docker Desktop)
-- Nothing in this file writes anything.

\echo '== 1. vehicles standing in a body shop (they are moved to Chapauto)'
select v.id, v.header->>'kennzeichen' plate, s.name old_station, v.statut, v.repair_stage, v.deleted_at is not null deleted
from vehicles v join stations s on s.id = v.station_id where s.type = 'carrosserie' order by s.name;

\echo '== 2. Chapauto candidates (must be exactly one, type hall or parc)'
select id, name, type, active, org_id from stations
where translate(lower(name), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') like '%chapauto%';

\echo '== 3. other things placed in a body shop (all must be empty, otherwise stop and ask)'
select 'role assignment as station' what, u.email, s.name from role_assignments ra join stations s on s.id = ra.station_id join users u on u.id = ra.user_id where s.type = 'carrosserie'
union all select 'pending invitation', i.email, s.name from invitations i join stations s on s.id = i.station_id where s.type = 'carrosserie' and i.used_at is null
union all select 'repair booking place/origin', v.header->>'kennzeichen', s.name from repair_bookings b join vehicles v on v.id = b.vehicle_id join stations s on s.id in (b.station_id, b.origin_station_id) where s.type = 'carrosserie'
union all select 'citas link', c.appointment_id, s.name from citas_links c join stations s on s.id = c.station_id where s.type = 'carrosserie'
union all select 'campaign station', cs.campaign_id::text, s.name from campaign_stations cs join stations s on s.id = cs.station_id where s.type = 'carrosserie';

\echo '== 4. customers that are not body shops (client_station_id pointing to a hall/parc)'
select s.name, s.type, count(*) from vehicles v join stations s on s.id = v.client_station_id where s.type <> 'carrosserie' group by 1,2;

\echo '== 5. scanners seen in scans, per tenant (S40 quick start)'
select tenant, colibri_number, count(*) scans, count(*) filter (where import_status = 'new' and not scan_failed) waiting,
       min(scan_date_time) first_scan, max(scan_date_time) last_scan, array_agg(distinct location) filter (where location <> '') locations
from colibri_scans group by 1,2 order by 1, 3 desc;

\echo '== 6. location aliases in use (kept in the data, removed from the UI)'
select name, type, azure_location_aliases from stations where array_length(azure_location_aliases, 1) > 0;

\echo '== 7. body shops: commission, insurers, vehicles'
select s.name, s.active, s.commission_pct, (select count(*) from station_insurers si where si.station_id = s.id) insurers,
       (select count(*) from vehicles v where v.client_station_id = s.id and v.statut <> 'rendu' and v.deleted_at is null) open_vehicles,
       (select count(*) from vehicles v where v.client_station_id = s.id and v.deleted_at is null) total_vehicles
from stations s where s.type = 'carrosserie' order by s.name;
