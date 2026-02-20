from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Json
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, text, desc, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship
from sqlalchemy.exc import NoSuchModuleError, OperationalError, ArgumentError
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional, Any, Dict
import json
from cryptography.fernet import Fernet
import os
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from contextlib import contextmanager

# Generate or load a key
# In production, use: ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
ENCRYPTION_KEY = Fernet.generate_key()
cipher_suite = Fernet(ENCRYPTION_KEY)


def encrypt_data(data: str) -> str:
    return cipher_suite.encrypt(data.encode()).decode()


def decrypt_data(data: str) -> str:
    return cipher_suite.decrypt(data.encode()).decode()


# 1. Get URL from Environment, or fallback to localhost for testing
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:mitthu@localhost:5432/postgres")


# 2. Fix for Render (Render uses 'postgres://' but SQLAlchemy needs 'postgresql://')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

METADATA_DB_URL = DATABASE_URL
TARGET_DB_URL = DATABASE_URL  # For now, we test against the same DB

# --- DATABASE CONFIG ---
# METADATA_DB_URL = "postgresql://postgres:mitthu@localhost:5432/postgres"
# TARGET_DB_URL = "postgresql://postgres:mitthu@localhost:5432/postgres"

engine_metadata = create_engine(METADATA_DB_URL)
engine_target = create_engine(TARGET_DB_URL)
SessionLocal = sessionmaker(bind=engine_metadata)
Base = declarative_base()

# --- MODELS ---


class DQSource(Base):
    __tablename__ = "dq_data_sources"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    type = Column(String)  # postgres, mysql, etc.
    host = Column(String)
    port = Column(Integer)
    username = Column(String)
    password = Column(Text)  # This will be the encrypted string
    database = Column(String)
    # connection_url becomes a computed property or remains for legacy
    connection_url = Column(Text, nullable=True)


class DQRule(Base):
    __tablename__ = "dq_rules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    sql_query = Column(Text)
    params_json = Column(Text, default="{}")
    description = Column(String, nullable=True)

    # --- THIS LINE IS MISSING OR BROKEN IN YOUR CODE ---
    source_id = Column(Integer, ForeignKey(
        'dq_data_sources.id'), nullable=True)
    # --------------------------------------------------

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship (Optional but good)
    source = relationship("DQSource")


class DQRun(Base):
    __tablename__ = "dq_runs"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer)
    status = Column(String)
    result_json = Column(Text)
    executed_at = Column(DateTime, default=datetime.utcnow)
    triggered_by = Column(String, default="Manual")  # NEW FIELD


class DQSchedule(Base):
    __tablename__ = "dq_schedules"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("dq_rules.id"))
    cron_expression = Column(String)  # e.g., "0 0 * * *" for daily
    name = Column(String)             # e.g., "Daily User Check"
    is_active = Column(Boolean, default=True)


# Try to create tables, but don't fail if database is unavailable
try:
    Base.metadata.create_all(bind=engine_metadata)
except Exception as e:
    print(f"Warning: Could not create database tables - {e}")
    print("Database will be initialized on first endpoint call")

app = FastAPI()

# --- 1. SCHEDULER SETUP ---
scheduler = BackgroundScheduler()
scheduler.start()

origins = [
    "http://localhost:5173",
    # <--- Add your Render/Domain URL here
    "https://dqos-1.onrender.com",
    "http://your-vps-ip-address"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to get a fresh DB session for background threads


@contextmanager
def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# The function that actually runs in the background


# 1. Add schedule_name to the arguments
def run_scheduled_rule(rule_id: int, schedule_name: str):
    with get_db_session() as db:
        # 2. Pass the schedule_name as the triggered_by parameter
        execute_saved_rule(rule_id=rule_id, run_params={},
                           triggered_by=schedule_name, db=db)
        print(f"Rule {rule_id} executed via trigger: {schedule_name}.")

# Load existing schedules on startup


@app.on_event("startup")
def load_schedules():
    with get_db_session() as db:
        schedules = db.query(DQSchedule).filter(
            DQSchedule.is_active == True).all()
        for sched in schedules:
            scheduler.add_job(
                run_scheduled_rule,
                CronTrigger.from_crontab(sched.cron_expression),
                # Add sched.name to the args list!
                args=[sched.rule_id, sched.name],
                id=f"rule_{sched.rule_id}",
                replace_existing=True
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- PYDANTIC SCHEMAS ---


class SourceCreate(BaseModel):
    name: str
    connection_url: str
    type: str


class RuleCreate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}  # <--- NEW
    description: Optional[str] = None
    source_id: Optional[int] = None  # <--- NEW


class RuleUpdate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}  # <--- NEW
    description: Optional[str] = None
    source_id: Optional[int] = None  # <--- NEW


class AdHocCheck(BaseModel):
    sql: str
    params: dict = {}
    source_id: int  # <--- REQUIRED NOW


class ConnectionTest(BaseModel):
    connection_url: str


class CredentialSource(BaseModel):
    name: str
    db_type: str  # 'postgres', 'mysql', 'mssql', 'snowflake'
    host: str
    port: int
    username: str
    password: str
    database: str

# --- 2. SCHEDULE ENDPOINTS ---


class ScheduleCreate(BaseModel):
    rule_id: int
    name: str
    cron_expression: str


@app.get("/schedules/")
def get_schedules(db: Session = Depends(get_db)):
    # Join with DQRule to get the rule name
    schedules = db.query(DQSchedule, DQRule.name.label(
        "rule_name")).join(DQRule).all()
    return [{"id": s.DQSchedule.id, "rule_id": s.DQSchedule.rule_id, "name": s.DQSchedule.name, "cron": s.DQSchedule.cron_expression, "rule_name": s.rule_name, "is_active": s.DQSchedule.is_active} for s in schedules]


@app.post("/schedules/")
def create_schedule(sched: ScheduleCreate, db: Session = Depends(get_db)):
    # 1. Save to DB
    new_schedule = DQSchedule(
        rule_id=sched.rule_id,
        name=sched.name,
        cron_expression=sched.cron_expression,
        is_active=True
    )
    db.add(new_schedule)
    db.commit()

    # Add to active background scheduler
    scheduler.add_job(
        run_scheduled_rule,
        CronTrigger.from_crontab(sched.cron_expression),
        # Add sched.name to the args list!
        args=[sched.rule_id, sched.name],
        id=f"rule_{sched.rule_id}",
        replace_existing=True
    )
    return {"message": "Schedule created"}


@app.delete("/schedules/{rule_id}")
def delete_schedule(rule_id: int, db: Session = Depends(get_db)):
    # 1. Remove from DB
    db.query(DQSchedule).filter(DQSchedule.rule_id == rule_id).delete()
    db.commit()

    # 2. Remove from active scheduler
    try:
        scheduler.remove_job(f"rule_{rule_id}")
    except:
        pass  # Job might not be actively loaded
    return {"message": "Schedule removed"}


@app.put("/schedules/{rule_id}/toggle")
def toggle_schedule(rule_id: int, db: Session = Depends(get_db)):
    # 1. Find the schedule
    sched = db.query(DQSchedule).filter(DQSchedule.rule_id == rule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # 2. Toggle the boolean
    sched.is_active = not sched.is_active
    db.commit()

    # 3. Update the Background Scheduler
    if sched.is_active:
        # Turn it back on
        scheduler.add_job(
            run_scheduled_rule,
            CronTrigger.from_crontab(sched.cron_expression),
            args=[sched.rule_id, sched.name],
            id=f"rule_{sched.rule_id}",
            replace_existing=True
        )
    else:
        # Turn it off
        try:
            scheduler.remove_job(f"rule_{sched.rule_id}")
        except:
            pass  # Ignore if job wasn't actively in memory

    return {"message": "Toggled", "is_active": sched.is_active}

# --- HELPER: Normalize connection URL ---


def normalize_connection_url(url: str) -> str:
    """
    Replaces mssql+pyodbc (requires system ODBC driver) with mssql+pymssql
    (pure-Python, works on Linux/Render without extra system packages).
    Strips the ?driver=... query string that pyodbc needs but pymssql rejects.
    """
    if url and 'mssql+pyodbc' in url:
        url = url.replace('mssql+pyodbc', 'mssql+pymssql')
        # Remove ?driver=... and any trailing params pyodbc added
        if '?driver=' in url:
            url = url.split('?driver=')[0]
        elif '?Driver=' in url:
            url = url.split('?Driver=')[0]
    return url


# --- HELPER: Dynamic Execution ---


def execute_on_source(source_url: str, sql: str, params: dict):
    source_url = normalize_connection_url(source_url)
    try:
        temp_engine = create_engine(source_url)
        with temp_engine.connect() as conn:
            result = conn.execute(text(sql), params)
            keys = result.keys()
            return [dict(zip(keys, row)) for row in result.fetchall()]
    except NoSuchModuleError as e:
        # Graceful failure for missing drivers
        raise Exception(f"Driver missing. Backend needs: {str(e)}")
    except Exception as e:
        # Re-raise other errors so they appear in the UI
        raise e
    finally:
        # Ensure connection is closed
        try:
            temp_engine.dispose()
        except:
            pass

# --- ENDPOINTS ---


@app.post("/sources/credentials")
def create_source_via_creds(src: CredentialSource, db: Session = Depends(get_db)):
    # 1. Build the dialect-specific URL
    if src.db_type == 'postgres':
        url = f"postgresql://{src.username}:{src.password}@{src.host}:{src.port}/{src.database}"
    elif src.db_type == 'mysql':
        url = f"mysql+pymysql://{src.username}:{src.password}@{src.host}:{src.port}/{src.database}"
    elif src.db_type == 'mssql':
        url = f"mssql+pymssql://{src.username}:{src.password}@{src.host}/{src.database}"
    else:
        raise HTTPException(
            status_code=400, detail="Unsupported DB type for credential form")

    # 2. Encrypt the password before saving
    encrypted_pw = encrypt_data(src.password)

    new_source = DQSource(
        name=src.name,
        type=src.db_type,
        host=src.host,
        port=src.port,
        username=src.username,
        password=encrypted_pw,
        database=src.database,
        # Stored for execution, but password inside is raw (temp)
        connection_url=url
    )

    db.add(new_source)
    db.commit()
    return {"message": "Source secured and saved"}

# 1. DATA SOURCES


@app.post("/sources/")
def create_source(source: SourceCreate, db: Session = Depends(get_db)):
    new_source = DQSource(
        name=source.name, connection_url=source.connection_url, type=source.type)
    try:
        db.add(new_source)
        db.commit()
        db.refresh(new_source)
        return new_source
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/sources/")
def list_sources(db: Session = Depends(get_db)):
    return db.query(DQSource).all()

# --- UPDATE SOURCE ---


@app.put("/sources/{source_id}")
def update_source(source_id: int, source: SourceCreate, db: Session = Depends(get_db)):
    db_source = db.query(DQSource).filter(DQSource.id == source_id).first()
    if not db_source:
        raise HTTPException(status_code=404, detail="Source not found")

    db_source.name = source.name
    db_source.connection_url = source.connection_url
    db_source.type = source.type

    try:
        db.commit()
        db.refresh(db_source)
        return db_source
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

# --- DELETE SOURCE ---


@app.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    # Check if used in rules first (Optional check, or let DB foreign key handle it)
    source = db.query(DQSource).filter(DQSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    try:
        db.delete(source)
        db.commit()
        return {"message": "Source deleted successfully"}
    except Exception as e:
        db.rollback()
        # This catches Foreign Key violations (e.g. if a Rule is using this source)
        raise HTTPException(
            status_code=400, detail="Cannot delete: This source is currently used by saved Rules.")


@app.post("/test-connection")
def test_connection(conn: ConnectionTest):
    """
    Tries to connect to the DB without saving.
    Returns success or a human-readable error.
    """
    try:
        engine = create_engine(normalize_connection_url(conn.connection_url))
        with engine.connect() as connection:
            # Run a lightweight query valid in almost all SQL dialects
            connection.execute(text("SELECT 1"))
        return {"status": "success", "message": "Connection Successful!"}

    except ValueError as e:
        # Catches empty/invalid port (e.g. port="") or other URL component issues
        return {
            "status": "error",
            "message": f"Invalid connection URL — check that all fields (host, port, database) are filled in correctly. Detail: {str(e)}"
        }
    except NoSuchModuleError as e:
        # This catches missing drivers (e.g., missing pyodbc or pymysql)
        return {
            "status": "error",
            "message": f"Missing Driver: {str(e)}. Install the required driver (e.g. 'pip install pyodbc' for SQL Server)."
        }
    except ArgumentError:
        return {
            "status": "error",
            "message": "Invalid URL Format. Ensure it follows: dialect+driver://user:pass@host/db"
        }
    except OperationalError as e:
        return {
            "status": "error",
            "message": f"Connection Failed: Could not reach the server. Check host/port/credentials. Details: {str(e.orig)}"
        }
    except Exception as e:
        return {"status": "error", "message": f"Unexpected Error: {str(e)}"}
    finally:
        engine.dispose()


@app.post("/rules/")
def create_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    new_rule = DQRule(
        name=rule.name,
        sql_query=rule.sql,
        params_json=json.dumps(rule.params),  # Save params as JSON string
        description=rule.description,
        source_id=rule.source_id  # Save the link
    )
    try:
        db.add(new_rule)
        db.commit()
        db.refresh(new_rule)
        return new_rule
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"Error creating rule: {str(e)}")


@app.put("/rules/{rule_id}")
def update_rule(rule_id: int, rule: RuleUpdate, db: Session = Depends(get_db)):
    db_rule = db.query(DQRule).filter(DQRule.id == rule_id).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    db_rule.name = rule.name
    db_rule.sql_query = rule.sql
    db_rule.params_json = json.dumps(rule.params)  # Update params
    db_rule.description = rule.description
    db_rule.source_id = rule.source_id

    try:
        db.commit()
        db.refresh(db_rule)
        return db_rule
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/rules/")
def list_rules(db: Session = Depends(get_db)):
    rules = db.query(DQRule).order_by(DQRule.id).all()
    # Parse the JSON string back to a Dict for the frontend
    for r in rules:
        try:
            r.params = json.loads(r.params_json)
        except:
            r.params = {}
    return rules


@app.post("/run-adhoc")
def run_adhoc(check: AdHocCheck, db: Session = Depends(get_db)):
    # Look up the source URL
    source = db.query(DQSource).filter(DQSource.id == check.source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        rows = execute_on_source(
            source.connection_url, check.sql, check.params)
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/run-rule/{rule_id}")
def execute_saved_rule(rule_id: int, run_params: dict = {}, triggered_by: str = "Manual", db: Session = Depends(get_db)):
    # 1. Fetch Rule
    rule = db.query(DQRule).filter(DQRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    if not rule.source_id:
        raise HTTPException(
            status_code=400, detail="Rule has no Data Source assigned")

    source = db.query(DQSource).filter(DQSource.id == rule.source_id).first()

    # 2. Merge Parameters (Saved Defaults + Runtime Overrides)
    try:
        saved_params = json.loads(rule.params_json)
    except:
        saved_params = {}

    # Final params = Saved Defaults updated with any new runtime params
    final_params = {**saved_params, **run_params}

    status = "FAIL"
    output_data = []

    try:
        # 3. Dynamic Execution
        output_data = execute_on_source(
            source.connection_url, rule.sql_query, final_params)
        status = "PASS" if len(output_data) == 0 else "FAIL"
    except Exception as e:
        status = "ERROR"
        output_data = [{"error": str(e)}]

    # 4. Save Log
    new_run = DQRun(
        rule_id=rule.id,
        status=status,
        result_json=json.dumps(output_data, default=str),
        triggered_by=triggered_by  # <--- Add this line
    )
    db.add(new_run)
    db.commit()

    return {"rule": rule.name, "status": status, "data": output_data}


@app.get("/history/")
def get_run_history(limit: int = 50, db: Session = Depends(get_db)):
    runs = db.query(DQRun, DQRule.name)\
        .join(DQRule, DQRun.rule_id == DQRule.id)\
        .order_by(desc(DQRun.executed_at))\
        .limit(limit)\
        .all()

    history = []
    for run, rule_name in runs:
        history.append({
            "id": run.id,
            "rule": rule_name,
            "status": run.status,
            "executed_at": run.executed_at.strftime("%Y-%m-%d %H:%M:%S"),
            "result": run.result_json,
            "triggered_by": run.triggered_by  # <--- Add this line
        })
    return history
