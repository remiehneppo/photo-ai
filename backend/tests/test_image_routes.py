from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.routers import images


def session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_get_image_requires_owner(tmp_path):
    factory = session_factory()
    db = factory()
    owner = User(id="owner", email="owner@example.com", username="owner", hashed_password="hash")
    other = User(id="other", email="other@example.com", username="other", hashed_password="hash")
    file_path = tmp_path / "output.png"
    file_path.write_bytes(b"png")
    db.add_all([
        owner,
        other,
        Job(id="job-1", user_id=owner.id, feature="txt2img", status="done"),
        Image(id="image-1", job_id="job-1", user_id=owner.id, type="output", file_path=str(file_path), filename="output.png"),
    ])
    db.commit()

    response = images.get_image("output", "output.png", db=db, current_user=owner)
    assert Path(response.path) == file_path

    with pytest.raises(HTTPException) as exc:
        images.get_image("output", "output.png", db=db, current_user=other)
    assert exc.value.status_code == 404


def test_get_image_rejects_path_traversal(tmp_path):
    factory = session_factory()
    db = factory()
    user = User(id="owner", email="owner@example.com", username="owner", hashed_password="hash")
    db.add(user)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        images.get_image("output", "../secret.png", db=db, current_user=user)
    assert exc.value.status_code == 404
