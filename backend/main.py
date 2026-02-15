from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Json
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, text, desc
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional, Any, Dict
import json

# --- DATABASE CONFIG ---
METADATA_DB_URL = "postgresql://postgres:mitthu@localhost:5432/postgres"
TARGET_DB_URL = "postgresql://postgres:mitthu@localhost:5432/postgres"

engine_metadata = create_engine(METADATA_DB_URL)
engine_target = create_engine(TARGET_DB_URL)
SessionLocal = sessionmaker(bind=engine_metadata)
Base = declarative_base()

# --- MODELS ---


class DQRule(Base):
    __tablename__ = "dq_rules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    sql_query = Column(Text)
    params_json = Column(Text, default="{}")  # <--- NEW COLUMN
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DQRun(Base):
    __tablename__ = "dq_runs"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer)
    status = Column(String)
    result_json = Column(Text)
    executed_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine_metadata)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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


class RuleCreate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}  # <--- NEW
    description: Optional[str] = None


class RuleUpdate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}  # <--- NEW
    description: Optional[str] = None


class AdHocCheck(BaseModel):
    sql: str
    params: dict = {}

# --- ENDPOINTS ---


@app.post("/rules/")
def create_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    new_rule = DQRule(
        name=rule.name,
        sql_query=rule.sql,
        params_json=json.dumps(rule.params),  # Save params as JSON string
        description=rule.description
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
def run_adhoc(check: AdHocCheck):
    try:
        with engine_target.connect() as connection:
            result = connection.execute(text(check.sql), check.params)
            keys = result.keys()
            rows = [dict(zip(keys, row)) for row in result.fetchall()]
            return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/run-rule/{rule_id}")
def execute_saved_rule(rule_id: int, run_params: dict = {}, db: Session = Depends(get_db)):
    # 1. Fetch Rule
    rule = db.query(DQRule).filter(DQRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

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
        with engine_target.connect() as conn:
            # 3. Execute with FINAL params
            result = conn.execute(text(rule.sql_query), final_params)
            keys = result.keys()
            output_data = [dict(zip(keys, row)) for row in result.fetchall()]
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
