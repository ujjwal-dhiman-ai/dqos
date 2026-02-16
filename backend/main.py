from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Json
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, text, desc, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship
from sqlalchemy.exc import NoSuchModuleError, OperationalError, ArgumentError
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional, Any, Dict
import json

# NEW (Dynamic)
import os

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


class DQSource(Base):  # <--- NEW TABLE
    __tablename__ = "dq_data_sources"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    connection_url = Column(Text)  # e.g. "postgresql://user:pass@host/db"
    type = Column(String)


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
    

class ConnectionTest(BaseModel):
    connection_url: str


# Try to create tables, but don't fail if database is unavailable
try:
    Base.metadata.create_all(bind=engine_metadata)
except Exception as e:
    print(f"Warning: Could not create database tables - {e}")
    print("Database will be initialized on first endpoint call")

app = FastAPI()

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
    
    
# --- HELPER: Dynamic Execution ---
def execute_on_source(source_url: str, sql: str, params: dict):
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


@app.post("/test-connection")
def test_connection(conn: ConnectionTest):
    """
    Tries to connect to the DB without saving.
    Returns success or a human-readable error.
    """
    engine = create_engine(conn.connection_url)
    try:
        with engine.connect() as connection:
            # Run a lightweight query valid in almost all SQL dialects
            connection.execute(text("SELECT 1"))
        return {"status": "success", "message": "Connection Successful!"}

    except NoSuchModuleError as e:
        # This catches missing drivers (e.g., missing pyodbc or pymysql)
        return {
            "status": "error",
            "message": f"Missing Driver Error: {str(e)}. Try installing the driver (e.g., 'pip install pyodbc')."
        }
    except ArgumentError:
        return {
            "status": "error",
            "message": "Invalid URL Format. Ensure it follows: dialect+driver://user:pass@host/db"
        }
    except OperationalError as e:
        return {
            "status": "error",
            "message": f"Connection Failed: Could not reach server. Check host/password. Details: {str(e.orig)}"
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
        rows = execute_on_source(source.connection_url, check.sql, check.params)
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/run-rule/{rule_id}")
def execute_saved_rule(rule_id: int, run_params: dict = {}, db: Session = Depends(get_db)):
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
        output_data = execute_on_source(source.connection_url, rule.sql_query, final_params)
        status = "PASS" if len(output_data) == 0 else "FAIL"
    except Exception as e:
        status = "ERROR"
        output_data = [{"error": str(e)}]

    # 4. Save Log
    new_run = DQRun(
        rule_id=rule.id,
        status=status,
        result_json=json.dumps(output_data, default=str)
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
            "result": run.result_json
        })
    return history


