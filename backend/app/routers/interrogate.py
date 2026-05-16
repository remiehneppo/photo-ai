from fastapi import APIRouter, Depends, File, UploadFile

from app.models.user import User
from app.services.a1111_client import a1111
from app.services.auth_service import get_current_user
from app.services.upload_service import read_image_upload

router = APIRouter(prefix="/api/interrogate", tags=["interrogate"])


@router.post("")
async def interrogate_image(
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    image_bytes = await read_image_upload(image)
    b64 = a1111.encode_image(image_bytes)
    prompt = await a1111.interrogate(b64)
    return {"prompt": prompt}
