from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


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
    source_id = Column(Integer, ForeignKey(
        'dq_data_sources.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    source = relationship("DQSource")


class DQRun(Base):
    __tablename__ = "dq_runs"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer)
    status = Column(String)
    result_json = Column(Text)
    executed_at = Column(DateTime, default=datetime.utcnow)
    triggered_by = Column(String, default="Manual")


class DQSchedule(Base):
    __tablename__ = "dq_schedules"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("dq_rules.id"))
    cron_expression = Column(String)  # e.g., "0 0 * * *" for daily
    name = Column(String)             # e.g., "Daily User Check"
    is_active = Column(Boolean, default=True)
