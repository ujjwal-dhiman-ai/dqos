from pydantic import BaseModel
from typing import Optional, Any, Dict


class SourceCreate(BaseModel):
    name: str
    connection_url: str
    type: str


class CredentialSource(BaseModel):
    name: str
    db_type: str  # 'postgres', 'mysql', 'mssql', 'snowflake'
    host: str
    port: int
    username: str
    password: str
    database: str


class RuleCreate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}
    description: Optional[str] = None
    source_id: Optional[int] = None


class RuleUpdate(BaseModel):
    name: str
    sql: str
    params: Optional[Dict[str, Any]] = {}
    description: Optional[str] = None
    source_id: Optional[int] = None


class AdHocCheck(BaseModel):
    sql: str
    params: dict = {}
    source_id: int


class ConnectionTest(BaseModel):
    connection_url: str


class ScheduleCreate(BaseModel):
    rule_id: int
    name: str
    cron_expression: str
