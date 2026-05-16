import os
from dotenv import load_dotenv

load_dotenv()

ENVIRONMENT = os.getenv("ENVIRONMENT", os.getenv("APP_ENV", "development")).lower()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://photoai:photoai123@localhost:5432/photoai")
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if ENVIRONMENT in {"development", "dev", "test", "testing"}:
        SECRET_KEY = "dev-secret-key"
    else:
        raise RuntimeError("SECRET_KEY must be set outside development/test environments")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))
A1111_BASE_URL = os.getenv("A1111_BASE_URL", "http://localhost:7860")
A1111_TIMEOUT_SECONDS = float(os.getenv("A1111_TIMEOUT_SECONDS", "600"))
A1111_OFFLOAD_BEFORE_JOB = os.getenv("A1111_OFFLOAD_BEFORE_JOB", "true").lower() not in {"0", "false", "no"}
STORAGE_PATH = os.getenv("STORAGE_PATH", "../storage")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", str(16_000_000)))
OUTPAINT_MAX_PIXELS = int(os.getenv("OUTPAINT_MAX_PIXELS", str(786_432)))
