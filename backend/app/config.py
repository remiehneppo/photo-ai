import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://photoai:photoai123@localhost:5432/photoai")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))
A1111_BASE_URL = os.getenv("A1111_BASE_URL", "http://localhost:7860")
STORAGE_PATH = os.getenv("STORAGE_PATH", "../storage")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
