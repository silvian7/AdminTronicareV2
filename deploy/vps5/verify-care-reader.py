"""Run inside the caregiver image/config; report only value-free verification."""

import asyncio
import sys

from sqlalchemy import text
from tronicare_core.settings import load_settings
from tronicare_core.adapters.postgres.database import create_database_engine

SQL = """
SELECT current_database()='care_core'
 AND current_user='care_reader'
 AND current_setting('transaction_read_only')='on'
 AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())
 AND NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit FROM pg_roles WHERE rolname=current_user)
 AND NOT pg_has_role(current_user,'care_owner','MEMBER')
 AND NOT has_schema_privilege(current_user,'core','CREATE')
 AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relkind IN ('r','p') AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_table_privilege(current_user,c.oid,'REFERENCES') OR has_table_privilege(current_user,c.oid,'TRIGGER')))
 AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relkind='S' AND (has_sequence_privilege(current_user,c.oid,'USAGE') OR has_sequence_privilege(current_user,c.oid,'UPDATE')))
 AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND has_function_privilege(current_user,p.oid,'EXECUTE'))
 AND has_table_privilege(current_user,'core.core_api_authority_epoch','SELECT')
 AND has_table_privilege(current_user,'core.device','SELECT')
 AND has_table_privilege(current_user,'core.sensor','SELECT')
 AND has_table_privilege(current_user,'core.sensor_type','SELECT')
"""


async def main():
    settings = load_settings()
    settings.validate_api()
    engine = create_database_engine(settings.credentials.api_database_url)
    try:
        async with engine.connect() as connection:
            if (await connection.execute(text(SQL))).scalar_one() is not True:
                raise RuntimeError("Reader privilege verification failed")
    finally:
        await engine.dispose()
    reports = create_database_engine(settings.credentials.care_reports_database_url)
    try:
        async with reports.connect() as connection:
            verified = await connection.execute(text("""
                SELECT current_database()='sensors_history'
                 AND current_user='care_portal_reader'
                 AND current_setting('transaction_read_only')='on'
                 AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())
                 AND NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
            """))
            if verified.scalar_one() is not True:
                raise RuntimeError("Reports connection verification failed")
    finally:
        await reports.dispose()
    print("Caregiver reader privileges and both TLS/read-only database connections verified.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        print("Caregiver reader verification failed.", file=sys.stderr)
        sys.exit(1)
