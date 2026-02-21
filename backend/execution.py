from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from models import DQRule, DQRun, DQSource
from utils import execute_on_source
import json


def run_rule_logic(rule_id: int, db: Session, run_params: dict = {}, triggered_by: str = "Manual"):
    # 1. Fetch Rule
    rule = db.query(DQRule).filter(DQRule.id == rule_id).first()
    if not rule:
        raise ValueError("Rule not found")

    if not rule.source_id:
        raise ValueError("Rule has no Data Source assigned")

    source = db.query(DQSource).filter(DQSource.id == rule.source_id).first()
    if not source:
        raise ValueError("Source not found")

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
        triggered_by=triggered_by
    )
    db.add(new_run)
    db.commit()

    return {"rule": rule.name, "status": status, "data": output_data}
