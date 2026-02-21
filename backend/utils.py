from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.exc import NoSuchModuleError
import os

# Generate or load a key
# In production, use: ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
ENCRYPTION_KEY = Fernet.generate_key()
cipher_suite = Fernet(ENCRYPTION_KEY)


def encrypt_data(data: str) -> str:
    return cipher_suite.encrypt(data.encode()).decode()


def decrypt_data(data: str) -> str:
    return cipher_suite.decrypt(data.encode()).decode()


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


def execute_on_source(source_url: str, sql: str, params: dict):
    source_url = normalize_connection_url(source_url)
    try:
        temp_engine = create_engine(source_url)
        with temp_engine.connect() as conn:
            result = conn.execute(text(sql), params)
            if result.returns_rows:
                keys = result.keys()
                return [dict(zip(keys, row)) for row in result.fetchall()]
            return []
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
