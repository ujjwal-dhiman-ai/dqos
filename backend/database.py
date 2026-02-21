from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from contextlib import contextmanager
import os

# 1. Get URL from Environment, or fallback to localhost for testing
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:mitthu@localhost:5432/postgres")

# 2. Fix for Render (Render uses 'postgres://' but SQLAlchemy needs 'postgresql://')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

METADATA_DB_URL = DATABASE_URL
# TARGET_DB_URL = DATABASE_URL  # Not effectively used separately in current main.py

engine = create_engine(METADATA_DB_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
