from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, text, desc
from sqlalchemy.exc import NoSuchModuleError, OperationalError, ArgumentError
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import json

from database import engine, Base, get_db, get_db_session
from models import DQSource, DQRule, DQRun, DQSchedule
from schemas import (
    SourceCreate, CredentialSource, ConnectionTest,
    RuleCreate, RuleUpdate, AdHocCheck, ScheduleCreate
)
from utils import encrypt_data, normalize_connection_url, execute_on_source
from execution import run_rule_logic


# --- INIT DB ---
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Could not create database tables - {e}")

app = FastAPI()

# --- SCHEDULER SETUP ---
scheduler = BackgroundScheduler()
scheduler.start()

origins = [
    "http://localhost:5173",
    "http://localhost:5174",
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


# --- BACKGROUND JOB ---
def run_scheduled_rule(rule_id: int, schedule_name: str):
    with get_db_session() as db:
        try:
            run_rule_logic(rule_id, db, run_params={},
                           triggered_by=schedule_name)
            print(f"Rule {rule_id} executed via trigger: {schedule_name}.")
        except Exception as e:
            print(f"Error executing scheduled rule {rule_id}: {e}")


@app.on_event("startup")
def load_schedules():
    with get_db_session() as db:
        schedules = db.query(DQSchedule).filter(
            DQSchedule.is_active == True).all()
        for sched in schedules:
            scheduler.add_job(
                run_scheduled_rule,
                CronTrigger.from_crontab(sched.cron_expression),
                args=[sched.rule_id, sched.name],
                id=f"rule_{sched.rule_id}",
                replace_existing=True
            )


# --- SCHEDULE ENDPOINTS ---

@app.get("/schedules/")
def get_schedules(db: Session = Depends(get_db)):
    schedules = db.query(DQSchedule, DQRule.name.label(
        "rule_name")).join(DQRule).all()
    return [{
        "id": s.DQSchedule.id,
        "rule_id": s.DQSchedule.rule_id,
        "name": s.DQSchedule.name,
        "cron": s.DQSchedule.cron_expression,
        "rule_name": s.rule_name,
        "is_active": s.DQSchedule.is_active
    } for s in schedules]


@app.post("/schedules/")
def create_schedule(sched: ScheduleCreate, db: Session = Depends(get_db)):
    new_schedule = DQSchedule(
        rule_id=sched.rule_id,
        name=sched.name,
        cron_expression=sched.cron_expression,
        is_active=True
    )
    db.add(new_schedule)
    db.commit()

    scheduler.add_job(
        run_scheduled_rule,
        CronTrigger.from_crontab(sched.cron_expression),
        args=[sched.rule_id, sched.name],
        id=f"rule_{sched.rule_id}",
        replace_existing=True
    )
    return {"message": "Schedule created"}


@app.delete("/schedules/{rule_id}")
def delete_schedule(rule_id: int, db: Session = Depends(get_db)):
    db.query(DQSchedule).filter(DQSchedule.rule_id == rule_id).delete()
    db.commit()
    try:
        scheduler.remove_job(f"rule_{rule_id}")
    except:
        pass
    return {"message": "Schedule removed"}


@app.put("/schedules/{rule_id}/toggle")
def toggle_schedule(rule_id: int, db: Session = Depends(get_db)):
    sched = db.query(DQSchedule).filter(DQSchedule.rule_id == rule_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")

    sched.is_active = not sched.is_active
    db.commit()

    if sched.is_active:
        scheduler.add_job(
            run_scheduled_rule,
            CronTrigger.from_crontab(sched.cron_expression),
            args=[sched.rule_id, sched.name],
            id=f"rule_{sched.rule_id}",
            replace_existing=True
        )
    else:
        try:
            scheduler.remove_job(f"rule_{sched.rule_id}")
        except:
            pass

    return {"message": "Toggled", "is_active": sched.is_active}


# --- SOURCE ENDPOINTS ---

@app.post("/sources/credentials")
def create_source_via_creds(src: CredentialSource, db: Session = Depends(get_db)):
    if src.db_type == 'postgres':
        url = f"postgresql://{src.username}:{src.password}@{src.host}:{src.port}/{src.database}"
    elif src.db_type == 'mysql':
        url = f"mysql+pymysql://{src.username}:{src.password}@{src.host}:{src.port}/{src.database}"
    elif src.db_type == 'mssql':
        url = f"mssql+pymssql://{src.username}:{src.password}@{src.host}/{src.database}"
    else:
        raise HTTPException(
            status_code=400, detail="Unsupported DB type for credential form")

    encrypted_pw = encrypt_data(src.password)

    new_source = DQSource(
        name=src.name,
        type=src.db_type,
        host=src.host,
        port=src.port,
        username=src.username,
        password=encrypted_pw,
        database=src.database,
        connection_url=url
    )

    db.add(new_source)
    db.commit()
    return {"message": "Source secured and saved"}


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


@app.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    source = db.query(DQSource).filter(DQSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    try:
        db.delete(source)
        db.commit()
        return {"message": "Source deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Cannot delete: This source is currently used by saved Rules.")


@app.post("/test-connection")
def test_connection(conn: ConnectionTest):
    try:
        engine = create_engine(normalize_connection_url(conn.connection_url))
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "success", "message": "Connection Successful!"}
    except ValueError as e:
        return {"status": "error", "message": f"Invalid connection URL. Detail: {str(e)}"}
    except NoSuchModuleError as e:
        return {"status": "error", "message": f"Missing Driver: {str(e)}"}
    except ArgumentError:
        return {"status": "error", "message": "Invalid URL Format."}
    except OperationalError as e:
        return {"status": "error", "message": f"Connection Failed: {str(e.orig)}"}
    except Exception as e:
        return {"status": "error", "message": f"Unexpected Error: {str(e)}"}
    finally:
        try:
            engine.dispose()
        except:
            pass


# --- RULE ENDPOINTS ---

@app.post("/rules/")
def create_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    new_rule = DQRule(
        name=rule.name,
        sql_query=rule.sql,
        params_json=json.dumps(rule.params),
        description=rule.description,
        source_id=rule.source_id
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
    db_rule.params_json = json.dumps(rule.params)
    db_rule.description = rule.description
    db_rule.source_id = rule.source_id

    try:
        db.commit()
        db.refresh(db_rule)
        return db_rule
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(DQRule).filter(DQRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    try:
        db.query(DQSchedule).filter(DQSchedule.rule_id == rule_id).delete()
        try:
            scheduler.remove_job(f"rule_{rule_id}")
        except:
            pass

        db.delete(rule)
        db.commit()
        return {"message": "Rule deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"Error deleting rule: {str(e)}")


@app.get("/rules/")
def list_rules(db: Session = Depends(get_db)):
    rules = db.query(DQRule).order_by(DQRule.id).all()
    for r in rules:
        try:
            r.params = json.loads(r.params_json)
        except:
            r.params = {}
    return rules


# --- EXECUTION ENDPOINTS ---

@app.post("/run-adhoc")
def run_adhoc(check: AdHocCheck, db: Session = Depends(get_db)):
    source = db.query(DQSource).filter(DQSource.id == check.source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        # Pass params from request
        rows = execute_on_source(
            source.connection_url, check.sql, check.params)
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/run-rule/{rule_id}")
def execute_saved_rule(rule_id: int, run_params: dict = {}, triggered_by: str = "Manual", db: Session = Depends(get_db)):
    try:
        return run_rule_logic(rule_id, db, run_params, triggered_by)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
