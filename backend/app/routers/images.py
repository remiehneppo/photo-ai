from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.image import Image
from app.models.user import User
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{image_type}/{filename}")
def get_image(
    image_type: str,
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if image_type not in {"input", "output"} or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=404, detail="Image not found")

    image = db.query(Image).filter(
        Image.user_id == current_user.id,
        Image.type == image_type,
        Image.filename == filename,
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    path = Path(image.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)
