from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from typing import List, Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import available_upscale_modes, get_upscale_preset
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from pydantic import BaseModel

router = APIRouter(prefix="/api/upscale", tags=["upscale"])


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def upscale_image(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mode: str = Form("default"),
    upscaler: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        preset = get_upscale_preset(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Choose from: {available_upscale_modes()}") from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="upscale",
        style=mode,
        estimated_seconds=30,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        payload = {
            "image": b64_input,
            "upscaler_1": upscaler if upscaler else preset["upscaler_1"],  # I4 override
            "upscaling_resize": preset["upscaling_resize"],
            "gfpgan_visibility": preset.get("gfpgan_visibility", 0.0),
            "codeformer_visibility": preset.get("codeformer_visibility", 0.0),
        }
        b64_result = await a1111.upscale(payload)
        img_bytes = a1111.decode_image(b64_result)
        await save_job_images(job_id, user_id, [img_bytes], input_file_path=file_path, input_filename=filename)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")


@router.post("/batch", response_model=JobResponse)
async def upscale_batch(
    background_tasks: BackgroundTasks,
    images: List[UploadFile] = File(...),
    mode: str = Form("default"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(images) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images per batch")

    try:
        preset = get_upscale_preset(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Choose from: {available_upscale_modes()}") from exc

    images_data = []
    for img_file in images:
        img_bytes = await read_image_upload(img_file)
        file_path, filename = await save_upload(img_bytes)
        images_data.append((img_bytes, file_path, filename))

    job = create_job(
        db,
        user_id=current_user.id,
        feature="upscale",
        style=f"{mode}_batch",
        estimated_seconds=30 * len(images_data),
    )
    job_id = job.id
    user_id = current_user.id

    async def task():
        batch_images = [
            {
                "data": a1111.encode_image(img_bytes),
                "name": filename,
            }
            for img_bytes, _, filename in images_data
        ]
        payload = {
            "imageList": batch_images,
            "upscaler_1": preset["upscaler_1"],
            "upscaling_resize": preset["upscaling_resize"],
            "gfpgan_visibility": preset.get("gfpgan_visibility", 0.0),
            "codeformer_visibility": preset.get("codeformer_visibility", 0.0),
        }
        b64_list = await a1111.upscale_batch(payload)
        output_bytes_list = [a1111.decode_image(b) for b in b64_list]
        # Use first input image for reference
        first_path, first_name = images_data[0][1], images_data[0][2]
        await save_job_images(job_id, user_id, output_bytes_list, input_file_path=first_path, input_filename=first_name)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
