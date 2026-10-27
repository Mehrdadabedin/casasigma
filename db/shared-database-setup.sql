-- One-time setup for running CasaSigma inside another app's Postgres database
-- (for example the hosted ICMBOT database on Render).
--
-- Run it as that database's owner, from a terminal:
--
--   psql "<External Database URL>" -f db/shared-database-setup.sql
--
-- It creates a `casasigma` schema and a login `casasigma_app` that can only
-- create and use objects in that schema: it gets no rights on the other app's
-- tables. At the end psql asks for the new login's password twice; it is not
-- echoed, and it never appears in a file or the shell history. Then set on the
-- CasaSigma service:
--
--   DATABASE_URL=postgres://casasigma_app:<password>@<host>/<database>
--   DATABASE_SCHEMA=casasigma
--
-- Safe to run again: it only creates what is missing, and asks for a new
-- password each time (press Ctrl+C at the prompt to keep the current one).
\set ON_ERROR_STOP on

-- Ten connections at most, so CasaSigma cannot use up the plan's shared limit.
select 'create role casasigma_app login connection limit 10'
where not exists (select 1 from pg_roles where rolname = 'casasigma_app')
\gexec

-- Unqualified table names resolve to the casasigma schema, even for a client
-- that does not set DATABASE_SCHEMA.
alter role casasigma_app set search_path = casasigma;

create schema if not exists casasigma;
grant usage, create on schema casasigma to casasigma_app;

select format('grant connect on database %I to casasigma_app', current_database())
\gexec

\password casasigma_app
