# DQ OS (Data Quality Operating System)

## Problem

- Teams needed a lightweight way to define, test, schedule, and audit data quality rules without skirting validation, visual feedback, or execution history.
- Ad-hoc SQL checks were running without guardrails, history was limited, and operators lacked visibility into why runs failed or how many datasets remained healthy.
- Monitoring relied on manual spreadsheets, so stats were stale, filters were limited, and long-running rule repositories were hard to manage.

## Solution

- Built a dual‑pane system: a FastAPI/SQLAlchemy backend that tracks sources, rules, schedules, executions, and aggregates pass/fail metrics, and a React + Vite frontend that lets teams inspect, validate, and paginate through every run.
- Enforced strict schema validation on the backend (required fields, duration tuning, paginated history/stats endpoints) and immediate inline validation on the playground so only well-formed inputs reach the warehouse.
- Gave operators an end-to-end experience: spinning up sources, authoring rules, executing them (with pass/fail heuristics), and scheduling recurring checks, all while monitoring live stats and filtering history.

## Implementation

### Backend

- FastAPI serves sources, rules, ad-hoc execution, scheduled jobs (APS-Cron), and statistical endpoints via SQLAlchemy models (sources/rules/runs/schedules). All writes are transaction-safe and protected with Pydantic schemas.
- History queries are paginated, sortable, and filterable (search, status, triggered_by), and a dedicated `/history/stats` endpoint returns cumulative totals for pass/fail/overall runs so the UI can preload accurate metrics.
- Scheduling runs through APScheduler keeps recurring rules in sync; toggling/creation/deletion update both the DB and job store to avoid orphaned triggers.

### Frontend

- React + Vite consumes the API with Axios, memoizes filtered rule/schedule lists, and lights up five tabs: Data Hub (source CRUD), Playground (SQL editor + validation), Rule Library, Automations, and Run History.
- Inline `validateSourceForm`/`validatePlayground` helpers highlight missing fields, JSON typos, or unselected sources before requests go out. Successful run results populate tables with dynamic columns plus PASS/FAIL badges.
- History tab now supports pagination controls, multi-field filters (search, status, trigger, sort), and a Clear Filters action. Stat cards on the playground preload totals and refresh after every run so teams see live reliability data immediately.

### Infrastructure

- Backend: `backend/requirements.txt` (FastAPI, SQLAlchemy, APScheduler). Start with `python -m uvicorn backend.main:app --reload` in a virtualenv.
- Frontend: `frontend/package.json` + Vite config. Run `npm install` and `npm run dev` for the SPA; configure `VITE_API_URL` if the backend is hosted elsewhere.

## Delivery

1. Create a Python virtual environment inside `backend/` (e.g., `python -m venv venv && venv\Scripts\Activate.ps1` on Windows).
2. Install backend dependencies: `pip install -r requirements.txt` and start FastAPI with `uvicorn backend.main:app --reload`.
3. Switch to the `frontend/` directory, install Node packages (`npm install`), then run `npm run dev` to spin up Vite (the UI proxies to the API via `VITE_API_URL`).
4. Use the side nav to register data sources, write playground rules, and inspect history—filters/pagination and stats are all wired to the backend endpoints.

## Impact

- Operators now have end-to-end trust: every data source, rule, and scheduled check lives in one workspace with validation preventing malformed submissions.
- History is no longer a capped list; pagination, filters, and stats help teams triage anomalies, surface flaky rules, and track all-time pass/fail counts instantly.
- Delivery speed improved because Playground stats load immediately (no need to visit history first), schedules are toggleable, and inline errors reduce iteration time on rule creation.
