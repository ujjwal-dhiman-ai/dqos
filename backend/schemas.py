from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, Dict


class SourceCreate(BaseModel):
    name: str = Field(min_length=1)
    connection_url: str = Field(min_length=1)
    type: str = Field(min_length=1)

    @field_validator("name", "connection_url", "type")
    @classmethod
    def validate_non_empty_str(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value


class CredentialSource(BaseModel):
    name: str = Field(min_length=1)
    db_type: str  # 'postgres', 'mysql', 'mssql', 'snowflake'
    host: str = Field(min_length=1)
    port: int = Field(gt=0)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    database: str = Field(min_length=1)

    @field_validator("name", "db_type", "host", "username", "password", "database")
    @classmethod
    def validate_credential_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value


class RuleCreate(BaseModel):
    name: str = Field(min_length=1)
    sql: str = Field(min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = None
    source_id: int = Field(gt=0)

    @field_validator("name", "sql")
    @classmethod
    def validate_rule_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value


class RuleUpdate(BaseModel):
    name: str = Field(min_length=1)
    sql: str = Field(min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = None
    source_id: int = Field(gt=0)

    @field_validator("name", "sql")
    @classmethod
    def validate_rule_update_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value


class AdHocCheck(BaseModel):
    sql: str = Field(min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)
    source_id: int = Field(gt=0)

    @field_validator("sql")
    @classmethod
    def validate_adhoc_sql(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("SQL cannot be empty")
        return value


class ConnectionTest(BaseModel):
    connection_url: str = Field(min_length=1)

    @field_validator("connection_url")
    @classmethod
    def validate_connection_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Connection URL is required")
        return value


class ScheduleCreate(BaseModel):
    rule_id: int = Field(gt=0)
    name: str = Field(min_length=1)
    cron_expression: str = Field(min_length=1)

    @field_validator("name", "cron_expression")
    @classmethod
    def validate_schedule_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value
